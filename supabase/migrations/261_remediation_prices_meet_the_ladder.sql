-- 261: 해설·힌트·진단이 원가의 590~860배였습니다.
--
-- ── 실측 ────────────────────────────────────────────────────────────────────
--
-- 프로덕션에서 실제 계정으로 세 경로를 눌러 보고, `ai_cost_ledger` 에 남은 토큰으로 계산한
-- 값입니다(모델 deepseek-v4-flash, in 270,000 / out 1,100,000 micro per Mtok):
--
--       오답 해설   in 1,168  out 419   원가 $0.000776   값 $0.50   644배
--       힌트        in   620  out 378   원가 $0.000583   값 $0.50   858배
--       학습 진단   in 1,348  out 133   원가 $0.000510   값 $0.30   588배
--
-- 같은 방식으로 잰 나머지 사다리는 29~143배입니다(퀴즈 생성 29~38, 채점 41, 카드 143,
-- 이미지 102). 세 개만 한 자릿수 배수만큼 위에 떠 있었습니다 — 230 이 값을 열 배로 올린
-- 뒤로 원가를 다시 잰 적이 없었기 때문입니다.
--
-- ── 새 값 ───────────────────────────────────────────────────────────────────
--
--       오답 해설   $0.50 → $0.03    39배
--       힌트        $0.50 → $0.02    34배
--       답안 비교   $0.50 → $0.03    (해설과 같은 모양의 출력)
--       학습 진단   $0.30 → $0.05    98배
--
-- `price-floor.test.ts` 가 요구하는 하한(체인에서 가장 비싼 모델 원가의 10배)은 각각
-- $0.014 / $0.011 / $0.0074 이고, 세 값 모두 그 위입니다.
--
-- ── 힌트와 비교가 왜 따로 생겼나 ────────────────────────────────────────────
--
-- 셋이 `remediation_explain` 한 줄을 같이 쓰고 있었습니다. 출력 길이가 다른데 값이 같으면
-- 259 에서 객관식과 주관식에 같은 값을 매기던 것과 같은 잘못입니다. 값 조회를 액션 이름에서
-- 만들고(`'remediation_' || p_action`), 행이 없는 액션은 해설 값으로 떨어지게 둡니다 —
-- 나중에 액션이 하나 늘어도 값 없이 팔리는 일은 없습니다.
--
-- ── 진단 프롬프트 상한은 코드 쪽에 있습니다 ─────────────────────────────────
--
-- `buildDiagnosisPrompt` 가 카드 목록을 그대로 직렬화했습니다. 그 목록은 50개까지 오고 카드
-- 한 장은 2,000자까지 되므로 한 번의 진단이 10만 자를 태울 수 있었습니다 — 실측의 70배가
-- 넘는데 값은 같습니다. 같은 커밋에서 16장 x 200자로 잘랐습니다. 값을 내리면서 상한을 안
-- 두면, 내린 값으로 훨씬 큰 요청을 파는 셈이 됩니다.
BEGIN;

UPDATE public.ai_action_prices
   SET price_micro = 30000,
       note = '해설 1건. 실측 원가 $0.000776(deepseek-v4-flash, in 1168 / out 419)의 39배. '
              '230 이 열 배로 올린 뒤 원가를 다시 잰 적이 없어 644배로 떠 있었습니다.',
       updated_at = now()
 WHERE action = 'remediation_explain' AND price_micro = 500000;

INSERT INTO public.ai_action_prices (action, price_micro, note)
VALUES
  ('remediation_hint', 20000,
   '힌트 1건. 실측 원가 $0.000583(in 620 / out 378)의 34배. 해설보다 짧은 출력이라 해설보다 쌉니다.'),
  ('remediation_compare', 30000,
   '답안 비교 1건. 해설과 같은 모양의 출력이라 같은 값.')
ON CONFLICT (action) DO NOTHING;

UPDATE public.ai_action_prices
   SET price_micro = 50000,
       note = '전체 목표 진단 1건. 실측 원가 $0.000510(in 1348 / out 133)의 98배. 프롬프트는 '
              '카드 16장 x 200자로 잘립니다 — 상한이 없으면 같은 값으로 10만 자를 태울 수 있었습니다.',
       updated_at = now()
 WHERE action = 'diagnosis' AND price_micro = 300000;

-- 값 조회를 액션 이름에서 만듭니다. 행이 없으면 해설 값으로 떨어집니다.
CREATE OR REPLACE FUNCTION public._ai_remediation_price(p_action text)
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    public._ai_action_price(CASE p_action WHEN 'diagnose' THEN 'diagnosis'
                                          ELSE 'remediation_' || p_action END),
    public._ai_action_price('remediation_explain'),
    0);
$$;


-- ── reserve 는 새 조회 함수를 씁니다 (본문은 246 그대로) ──────────────────
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
  IF p_action NOT IN ('explain','compare','hint','generate','evaluate','recommend','diagnose') THEN
    RAISE EXCEPTION 'Invalid remediation action' USING errcode = 'invalid_parameter_value';
  END IF;
  -- 진단은 목표에 대한 것입니다. 목표 없이 오면 무엇을 진단하라는 것인지 알 수 없습니다.
  IF p_action = 'diagnose' AND p_goal_id IS NULL THEN
    RAISE EXCEPTION 'Diagnosis requires a goal' USING errcode = 'invalid_parameter_value';
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

  -- ── Bought already? ────────────────────────────────────────────────────────
  --
  -- 시도가 있는 요청은 216 그대로 — 시도가 그 요청의 정체성입니다.
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

  ELSIF p_action = 'diagnose' THEN
    -- 진단의 정체성은 (학습자, 목표, 그 주)입니다. 진단은 한 답이 아니라 한 시기의 흐름을
    -- 읽는 것이라, 어제 산 진단이 오늘 답 하나 때문에 달라지지는 않습니다. 같은 주에 다시
    -- 누르면 산 것을 그대로 돌려줍니다 — 매번 새로 청구하면 새로고침이 곧 과금이 됩니다.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_uid::text || '|' || p_goal_id::text || '|diagnose', 0));

    SELECT id, content INTO v_existing_id, v_existing_content
      FROM user_enrichments
     WHERE user_id = v_uid AND goal_id = p_goal_id AND action = 'diagnose'
       AND created_at >= date_trunc('week', now())
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
         AND remediation_goal_id = p_goal_id
         AND job_kind = 'remediation'
         AND charged = false AND refunded = false
         AND created_at > now() - interval '2 minutes'
    ) THEN
      RAISE EXCEPTION 'Remediation already in flight' USING errcode = '55006';
    END IF;
  END IF;

  -- 값은 행동에서 나옵니다. 216 은 무슨 행동이든 'remediation_explain' 을 물었는데, 그것은
  -- 팔 것이 하나뿐이었기 때문입니다.
  -- 261: 값을 액션 이름에서 찾습니다. 힌트는 해설보다 짧은 출력이라 값도 따로입니다.
  v_price := public._ai_remediation_price(p_action);
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
     remediation_attempt_id, remediation_goal_id, fixed_price_micro)
  VALUES (v_ref, v_uid, v_today, 0, 1, 0, 'remediation', 1.0, p_attempt_id,
          CASE WHEN p_action = 'diagnose' THEN p_goal_id END, NULLIF(v_price, 0));

  RETURN jsonb_build_object(
    'job_ref', v_ref, 'billable_fraction', 1.0, 'job_kind', 'remediation', 'replay', false,
    'price_micro', v_price);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[])
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[])
  TO authenticated;

COMMIT;
