-- 262: 서술형에 모범답안을 붙이고, 힌트를 없앱니다.
--
-- ── 모범답안 ────────────────────────────────────────────────────────────────
--
-- 서술형을 풀면 학습자가 받는 것은 점수와 지적뿐이었습니다. "그럼 뭐라고 썼어야 하나"에
-- 답할 것이 없고, 그 답을 다시 사게 만드는 것(오답 해설 $0.03)은 이미 값을 치른 문항이
-- 못 한 일을 또 파는 것입니다.
--
-- 문항을 만들 때 모범답안도 같이 씁니다 — 252 가 객관식 해설을 문항과 함께 만들게 한 것과
-- 같은 이유입니다. 따로 부르면 호출이 한 번 더 들고, 값이 한 번 더 들고, 무엇보다 학습자가
-- 그 버튼을 눌러야만 답을 봅니다.
--
-- **답한 뒤에만** 돌려줍니다. 답하기 전에 보이면 그건 문항이 아니라 정답지이고, 이미
-- `rubric` 과 `reference_answer` 가 같은 규칙 아래 있습니다(mig 252).
--
-- 없을 수 있습니다: 모델이 못 쓰거나 검사를 통과 못 하면 그 필드만 버리고 문항은 살립니다.
-- 모범답안 하나 때문에 문항을 떨어뜨리면 "검증이 너무 빡세서 아무것도 안 남는" 실패를 또
-- 만드는 것입니다.
--
-- ── 힌트 제거 ───────────────────────────────────────────────────────────────
--
-- `hint` 는 화면에 호출 지점이 한 번도 없었는데 인증된 호출자면 과금됐습니다. 261 이 값을
-- $0.02 로 내렸지만, 값이 얼마든 **누를 데가 없는 유료 액션**은 지갑에 난 구멍입니다.
-- 서버에서 받지 않습니다. 값 행도 지웁니다.
--
-- `compare` 는 남깁니다 — 역시 화면은 없지만 오답 비교는 붙일 자리가 분명하고, 힌트는
-- 모범답안이 생긴 지금 존재 이유가 겹칩니다.
BEGIN;

-- ── 1) 모범답안 열 ─────────────────────────────────────────────────────────
ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS model_answer text;

ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_model_answer_len;
ALTER TABLE public.quiz_questions
  ADD CONSTRAINT quiz_questions_model_answer_len
  CHECK (model_answer IS NULL OR char_length(model_answer) <= 600);

COMMENT ON COLUMN public.quiz_questions.model_answer IS
  '서술형 모범답안. 채점 뒤에만 학습자에게 보입니다(get_quiz_run_items). NULL 이 정상입니다 — 모델이 못 쓰면 이 필드만 비고 문항은 그대로 나갑니다.';

-- ── 2) 저장 (본문은 207 그대로, 열 하나 추가) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.persist_quiz_questions(
  p_set_id    uuid,
  p_questions jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_set quiz_sets%ROWTYPE;
  q     jsonb;
  v_pos smallint;
  v_n   integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;
  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'questions must be an array' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_set FROM quiz_sets WHERE id = p_set_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz set not found' USING errcode = 'P0003'; END IF;

  -- Continue where the last batch stopped. Restarting at 0 would put two questions at the
  -- same position, and `get_quiz_run_items` orders by it.
  SELECT COALESCE(max(position) + 1, 0) INTO v_pos
    FROM quiz_questions WHERE set_id = p_set_id;

  FOR q IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM cards WHERE id = (q->>'card_id')::uuid AND deck_id = v_set.deck_id
    ) THEN
      RAISE EXCEPTION 'Question card is not in this set''s deck' USING errcode = '42501';
    END IF;

    INSERT INTO quiz_questions (
      set_id, owner_user_id, card_id, question_type, position, stem,
      options, correct_index, reference_answer, reference_context,
      rubric, meta, source_fingerprint, model_answer)
    VALUES (
      p_set_id, v_set.owner_user_id, (q->>'card_id')::uuid, v_set.question_type, v_pos,
      q->>'stem',
      CASE WHEN v_set.question_type = 'mcq'
           THEN ARRAY(SELECT jsonb_array_elements_text(q->'options')) END,
      CASE WHEN v_set.question_type = 'mcq' THEN (q->>'correct_index')::smallint END,
      q->>'reference_answer',
      q->>'reference_context',
      CASE WHEN jsonb_typeof(q->'rubric') = 'array' THEN q->'rubric' END,
      COALESCE(q->'meta', '{}'::jsonb),
      q->>'source_fingerprint',
      -- 서술형만 씁니다. 다른 유형이 보내오면 열은 NULL 로 남습니다.
      CASE WHEN v_set.question_type = 'essay' THEN q->>'model_answer' END);
    v_pos := v_pos + 1;
    v_n := v_n + 1;
  END LOOP;

  -- ACCUMULATE. `= v_n` reported only the last batch, so a 30-question quiz built from
  -- three calls would have said it had 10.
  UPDATE quiz_sets
     SET generated_count = generated_count + v_n,
         updated_at = now()
   WHERE id = p_set_id;

  RETURN jsonb_build_object(
    'set_id', p_set_id,
    'persisted', v_n,
    'total', (SELECT generated_count FROM quiz_sets WHERE id = p_set_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.persist_quiz_questions(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.persist_quiz_questions(uuid, jsonb) TO service_role;

-- ── 3) 공개 (본문은 252 그대로, 필드 하나 추가) ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_quiz_run_items(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_run   quiz_runs%ROWTYPE;
  v_items jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  SELECT * INTO v_run FROM quiz_runs WHERE id = p_run_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz run not accessible' USING errcode = '42501'; END IF;

  SELECT jsonb_agg(x ORDER BY x->>'position') INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'item_id', i.id,
      'position', i.position,
      'status', i.status,
      'question_type', q.question_type,
      'stem', q.stem,
      'options', CASE WHEN q.question_type = 'mcq' AND i.option_order IS NOT NULL
                      THEN to_jsonb(ARRAY(SELECT q.options[i.option_order[k] + 1]
                                            FROM generate_subscripts(i.option_order, 1) k))
                 END,
      'answered', a.id IS NOT NULL,
      'score', a.normalized_score,
      'feedback', a.feedback,
      -- AFTER answering only. `meta.flaws` names why each wrong option is wrong, so it is
      -- an answer key until the learner has committed.
      --
      -- And permuted with the options. Stored order is canonical; served order is this
      -- sitting's shuffle. Returning the stored array beside the shuffled options made the
      -- payload claim two different correct answers.
      'meta', CASE WHEN a.id IS NULL THEN NULL
                   WHEN q.question_type = 'mcq' AND i.option_order IS NOT NULL
                        AND jsonb_typeof(q.meta -> 'flaws') = 'array'
                   THEN q.meta
                        || jsonb_build_object('flaws', (
                             SELECT COALESCE(jsonb_agg(q.meta -> 'flaws' -> i.option_order[k]
                                                       ORDER BY k), '[]'::jsonb)
                               FROM generate_subscripts(i.option_order, 1) k))
                        -- `axes` gets the SAME permutation, for the same reason: stored order is
                        -- canonical, served order is this sitting's shuffle, and an explanation
                        -- aligned to the wrong option explains the wrong mistake. Absent on
                        -- questions written before 252, and the client drops what is not there.
                        || CASE WHEN jsonb_typeof(q.meta -> 'axes') = 'array'
                                THEN jsonb_build_object('axes', (
                                       SELECT COALESCE(jsonb_agg(q.meta -> 'axes' -> i.option_order[k]
                                                                 ORDER BY k), '[]'::jsonb)
                                         FROM generate_subscripts(i.option_order, 1) k))
                                ELSE '{}'::jsonb END
                   ELSE q.meta END,
      -- The learner's OWN submission, back to them.
      --
      -- `QuizFeedback` renders character spans the grader returned — "this part of your sentence
      -- is the problem" — by slicing the text the client already holds. During the run that is
      -- the input box. On the result screen, and on every later visit to a finished run, the
      -- client had nothing, so `splitBySpan('')` produced an empty hit and every learner span
      -- was dropped. The spans were paid for and then thrown away, which is the exact defect
      -- that component was written to fix.
      'response', a.response,
      'rubric', CASE WHEN a.id IS NOT NULL THEN q.rubric END,
      'reference_answer', CASE WHEN a.id IS NOT NULL THEN q.reference_answer END,
      -- 모범답안도 답한 뒤에만. 답하기 전에 보이면 그건 문항이 아니라 정답지입니다 —
      -- `rubric` 과 `reference_answer` 가 이미 같은 규칙 아래 있습니다.
      'model_answer', CASE WHEN a.id IS NOT NULL THEN q.model_answer END
    ) AS x
    FROM quiz_run_items i
    LEFT JOIN quiz_questions q ON q.id = i.question_id
    LEFT JOIN answer_attempts a ON a.quiz_run_item_id = i.id
    WHERE i.run_id = p_run_id AND i.status <> 'void'
  ) s;

  RETURN jsonb_build_object(
    'run_id', p_run_id, 'set_id', v_run.set_id, 'status', v_run.status,
    'attempt_no', v_run.attempt_no, 'item_count', v_run.item_count,
    'answered_count', v_run.answered_count,
    'score_raw', v_run.score_raw, 'score_max', v_run.score_max,
    -- 208: what the SET is still aiming for. A long quiz opens on its first batch, so a
    -- screen needs the target to know whether more is coming — and to stop asking once it
    -- is not.
    'requested_count', (SELECT requested_count FROM quiz_sets WHERE id = v_run.set_id),
    'items', COALESCE(v_items, '[]'::jsonb));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_run_items(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_quiz_run_items(uuid) TO authenticated;

-- ── 4) 힌트를 없앱니다 ─────────────────────────────────────────────────────
DELETE FROM public.ai_action_prices WHERE action = 'remediation_hint';

-- ── 5) 예약이 힌트를 받지 않습니다 (본문은 246 + 261 그대로) ───────────────
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
  -- 262: `hint` 를 뺐습니다. 화면에 호출 지점이 없는데 과금되는 액션은 지갑에 난 구멍입니다.
  IF p_action NOT IN ('explain','compare','generate','evaluate','recommend','diagnose') THEN
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
