-- 246 되돌리기: AI 학습 진단을 없앱니다.
--
-- 값 행부터 지웁니다 — `_ai_action_price('diagnosis')` 가 NULL 이 되면 예약이 0원으로 통과할
-- 수 있으므로, 허용 목록에서 'diagnose' 를 빼는 것과 반드시 같은 트랜잭션이어야 합니다.
--
-- 이미 산 진단(`user_enrichments.action = 'diagnose'`)은 지우지 않습니다. 학습자가 값을 치른
-- 것이고, 되돌린다고 없던 일이 되지는 않습니다.
--
-- `remediation_goal_id` 컬럼도 남깁니다. 지우면 그 진단 작업들이 어느 목표에 대한 것이었는지
-- 원장에서 사라지고, 컬럼 하나가 비어 있는 것은 아무에게도 해가 되지 않습니다.
BEGIN;

DELETE FROM public.ai_action_prices WHERE action = 'diagnosis';
DELETE FROM public.ai_free_allowances WHERE tier = 'free' AND action_group = 'diagnosis';

DROP FUNCTION IF EXISTS public.get_learning_diagnosis_evidence(uuid, integer);

-- 216 의 본문 그대로.
CREATE OR REPLACE FUNCTION public.reserve_ai_remediation(
  p_action text,
  p_goal_id uuid DEFAULT NULL,
  p_activity_id uuid DEFAULT NULL,
  p_attempt_id uuid DEFAULT NULL,
  p_card_ids uuid[] DEFAULT '{}'::uuid[],
  p_concept_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_ref text := gen_random_uuid()::text;
  v_balance bigint;
  v_requests integer;
  v_id uuid;
  v_existing_id uuid;
  v_existing_content jsonb;
  v_price bigint;
  c_max_requests constant integer := 300;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF p_action NOT IN ('explain','compare','hint','generate','evaluate','recommend') THEN
    RAISE EXCEPTION 'Invalid remediation action' USING errcode = 'invalid_parameter_value';
  END IF;
  IF cardinality(COALESCE(p_card_ids, '{}'::uuid[])) > 50
     OR cardinality(COALESCE(p_concept_ids, '{}'::uuid[])) > 50 THEN
    RAISE EXCEPTION 'Too many remediation references' USING errcode = 'check_violation';
  END IF;
  IF p_goal_id IS NULL AND p_activity_id IS NULL AND p_attempt_id IS NULL
     AND cardinality(COALESCE(p_card_ids, '{}'::uuid[])) = 0
     AND cardinality(COALESCE(p_concept_ids, '{}'::uuid[])) = 0 THEN
    RAISE EXCEPTION 'Remediation requires a structured learning reference' USING errcode = 'invalid_parameter_value';
  END IF;

  IF p_goal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM learning_goals WHERE id = p_goal_id AND user_id = v_uid AND status <> 'archived'
  ) THEN RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501'; END IF;

  IF p_activity_id IS NOT NULL AND NOT public._check_activity_access(v_uid, p_activity_id) THEN
    RAISE EXCEPTION 'Activity not accessible' USING errcode = '42501';
  END IF;

  IF p_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM answer_attempts WHERE id = p_attempt_id AND user_id = v_uid
  ) THEN RAISE EXCEPTION 'Attempt not accessible' USING errcode = '42501'; END IF;

  FOREACH v_id IN ARRAY COALESCE(p_card_ids, '{}'::uuid[]) LOOP
    IF NOT public._check_card_access(v_uid, v_id) THEN
      RAISE EXCEPTION 'Card not accessible' USING errcode = '42501';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_concept_ids, '{}'::uuid[])) requested(id)
    LEFT JOIN learning_concepts c ON c.id = requested.id
    WHERE c.id IS NULL OR NOT (
      c.owner_user_id = v_uid OR (
        c.owner_user_id IS NULL AND (
          p_goal_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM learning_goal_concepts gc
            WHERE gc.goal_id = p_goal_id AND gc.concept_id = c.id
          )
        )
      )
    )
  ) THEN RAISE EXCEPTION 'Concept not accessible' USING errcode = '42501'; END IF;

  IF p_attempt_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_uid::text || '|' || p_attempt_id::text || '|' || p_action, 0));

    SELECT id, content INTO v_existing_id, v_existing_content
      FROM user_enrichments
     WHERE user_id = v_uid AND attempt_id = p_attempt_id AND action = p_action
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'replay', true,
        'enrichment_id', v_existing_id,
        'content', v_existing_content,
        'job_kind', 'remediation');
    END IF;

    IF EXISTS (
      SELECT 1 FROM ai_generation_jobs
       WHERE user_id = v_uid
         AND remediation_attempt_id = p_attempt_id
         AND job_kind = 'remediation'
         AND charged = false AND refunded = false
         AND created_at > now() - interval '2 minutes'
    ) THEN
      RAISE EXCEPTION 'Remediation already in flight' USING errcode = '55006';
    END IF;
  END IF;

  v_price := COALESCE(public._ai_action_price('remediation_explain'), 0);
  SELECT balance INTO v_balance FROM ai_credit_balance WHERE user_id = v_uid FOR UPDATE;
  IF COALESCE(v_balance, 0) < GREATEST(v_price, 1) THEN
    RAISE EXCEPTION 'Insufficient AI wallet balance' USING errcode = 'P0002';
  END IF;

  INSERT INTO ai_generation_usage (user_id, usage_date) VALUES (v_uid, v_today)
    ON CONFLICT (user_id, usage_date) DO NOTHING;
  SELECT req_count INTO v_requests FROM ai_generation_usage
    WHERE user_id = v_uid AND usage_date = v_today FOR UPDATE;
  IF v_requests + 1 > c_max_requests THEN
    RAISE EXCEPTION 'AI generation request cap exceeded' USING errcode = 'check_violation';
  END IF;
  UPDATE ai_generation_usage SET req_count = req_count + 1
    WHERE user_id = v_uid AND usage_date = v_today;

  INSERT INTO ai_generation_jobs
    (id, user_id, usage_date, free_cards, paid_cards, image_jobs, job_kind, billable_fraction,
     remediation_attempt_id, fixed_price_micro)
  VALUES (v_ref, v_uid, v_today, 0, 1, 0, 'remediation', 1.0, p_attempt_id, NULLIF(v_price, 0));

  RETURN jsonb_build_object(
    'job_ref', v_ref, 'billable_fraction', 1.0, 'job_kind', 'remediation', 'replay', false,
    'price_micro', v_price);
END;
$$;

COMMIT;
