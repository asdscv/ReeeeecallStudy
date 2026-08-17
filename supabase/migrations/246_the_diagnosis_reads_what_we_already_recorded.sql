-- 246: 학습 진단이 정답률 한 줄이었습니다.
--
-- "최근 30일 62번 중 52번 맞혔어요 (84%)" — 이것이 학습 진단의 전부였습니다. 숫자는 맞습니다.
-- 문제는 그것이 한 컬럼(`normalized_score`)의 비율이고, 그 위에 '진단'이라는 말이 붙어 있다는
-- 것입니다. 무엇을 많이 틀리는지, 왜 틀리는지, 나아지고 있는지에 대해 앱은 한 마디도 하지
-- 않았습니다.
--
-- 그런데 그 라벨들은 **이미 다 기록되고 있었습니다.** 프로덕션에서 확인한 것:
--
--   * 오답 19개 전부에 어떤 오답 보기를 골랐는지의 라벨이 붙어 있습니다
--     (`quiz_questions.meta->'flaws'`): adjacent_sense 7, right_category_wrong_item 7,
--     plausible_form 3, opposite 1, unrelated 1. 뜻을 몰라서가 아니라 비슷한 것끼리 구별을
--     못 한다는 뜻이고, 앱은 이걸 한 번도 읽어본 적이 없습니다.
--   * 단답 채점마다 `evaluator_result` 에 verdict 와 gaps 가 들어 있습니다.
--   * 서술형 채점마다 루브릭 기준별 met/partial/not_met 가 들어 있습니다.
--
-- 193 §2 가 `quiz_questions` 에 RLS 를 켜고 authenticated 에 GRANT 를 주지 않았기 때문에
-- 클라이언트는 이것들을 읽을 수 없습니다. 그건 옳습니다 — 거기엔 정답과 오답 라벨이 들어
-- 있고, 아직 안 푼 문제의 라벨이 새어 나가면 다시 풀기가 공짜 정답이 됩니다.
--
-- 그래서 서버가 **센 것만** 돌려줍니다. 문항 단위 라벨은 절대 나가지 않고, 카운트만 나갑니다.
-- 그리고 `a.id IS NOT NULL` — 답한 문항만 셉니다.
--
-- ── 두 층 ───────────────────────────────────────────────────────────────────
--
--   1) 무료·결정적:  get_learning_diagnosis_evidence  ← 이 파일
--   2) 유료·AI:      remediation action 'diagnose'    ← 이 파일의 나머지 절반
--
-- 1층만으로도 지금 화면보다 훨씬 많은 것을 말합니다. 2층은 그 증거 위에서 **패턴**을 찾습니다:
-- 어떤 카드들이 왜 서로 헷갈리는지(`WEAK_THEMES`). 모델은 산문을 쓰지 않습니다 — 닫힌 집합의
-- 라벨과 카드 id 만 돌려주고, 화면의 모든 문장은 손으로 번역된 문자열입니다.
--
-- 값은 $1.00 입니다. 카드 한 장 설명이 $0.50 이고 이것은 목표 전체를 봅니다.
BEGIN;

-- ── 1) 값 ───────────────────────────────────────────────────────────────────
INSERT INTO public.ai_action_prices (action, price_micro, note)
VALUES ('diagnosis', 1000000,
        'One whole-goal diagnosis: 30 days of graded answers read back as counted labels, plus '
        'the model''s grouping of the failing cards. Twice an explanation, which covers one card.')
ON CONFLICT (action) DO NOTHING;

-- 무료 티어에는 주지 않습니다. 239 의 커널이 이걸 위해 만들어졌습니다 — 새 행동은 행 하나.
-- 나중에 하루 1회 무료로 열고 싶으면 `per_day` 를 1로 UPDATE 하면 끝입니다.
INSERT INTO public.ai_free_allowances (tier, action_group, per_day, unit_kind, trial_applies, note)
VALUES ('free', 'diagnosis', 0, 'item', false,
        '진단은 첫 호출부터 유료입니다. 하루 1회 무료로 열려면 per_day 를 1로.')
ON CONFLICT (tier, action_group) DO NOTHING;

-- ── 2) 진행 중인 진단을 알아볼 수 있게 ──────────────────────────────────────
--
-- `reserve_ai_remediation` 의 중복 방지는 전부 `remediation_attempt_id` 를 키로 씁니다. 진단은
-- 붙일 시도가 없습니다 — 목표 하나에 대한 것이지 답 하나에 대한 것이 아닙니다. 목표를 적어
-- 두면 같은 판단을 그대로 쓸 수 있습니다.
ALTER TABLE public.ai_generation_jobs
  ADD COLUMN IF NOT EXISTS remediation_goal_id uuid REFERENCES public.learning_goals(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ai_generation_jobs.remediation_goal_id IS
  'The goal a diagnosis job is about. Its dedupe key, the way remediation_attempt_id is one for a per-answer explanation.';

-- ── 3) 증거 — 센 것만, 답한 문항만 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_learning_diagnosis_evidence(
  p_goal_id uuid,
  p_days    integer DEFAULT 30
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_from  timestamptz;
  v_from7 timestamptz;
  r       jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM learning_goals WHERE id = p_goal_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Goal not accessible' USING errcode = '42501';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 120 THEN
    RAISE EXCEPTION 'days out of range' USING errcode = 'invalid_parameter_value';
  END IF;

  v_from  := now() - make_interval(days => p_days);
  v_from7 := now() - interval '7 days';

  WITH scoped AS (
    -- 이 목표의 답. `goal_id` 로 좁힙니다 — 226 이 덱이 정확히 한 목표에 속할 때만 목표를
    -- 붙이므로, 어느 목표의 증거인지 모르는 답은 여기 들어오지 않습니다. 엉뚱한 목표에
    -- 붙이느니 빠지는 편이 낫습니다.
    SELECT a.*
      FROM answer_attempts a
     WHERE a.user_id = v_uid AND a.goal_id = p_goal_id AND a.created_at >= v_from
  ), scored AS (
    SELECT * FROM scoped WHERE normalized_score IS NOT NULL
  ), mcq_misses AS (
    -- 학습자가 실제로 고른 오답 보기의 라벨. `option_order` 로 표시 index → 정규 index 를
    -- 되돌린 다음 그 자리의 flaw 를 읽습니다. 라벨 자체는 절대 나가지 않고 개수만 나갑니다.
    SELECT q.meta -> 'flaws' ->> (ri.option_order[(s.response ->> 'choice')::int + 1])::text AS flaw
      FROM scored s
      JOIN quiz_run_items ri ON ri.id = s.quiz_run_item_id
      JOIN quiz_questions q  ON q.id = ri.question_id
     WHERE s.normalized_score = 0
       AND q.question_type = 'mcq'
       AND q.owner_user_id = v_uid
       AND jsonb_typeof(s.response -> 'choice') = 'number'
       AND (s.response ->> 'choice')::int + 1 BETWEEN 1 AND cardinality(ri.option_order)
  ), short_gaps AS (
    SELECT jsonb_array_elements_text(s.evaluator_result -> 'gaps') AS gap
      FROM scored s
     WHERE jsonb_typeof(s.evaluator_result -> 'gaps') = 'array'
  ), short_verdicts AS (
    SELECT s.evaluator_result ->> 'verdict' AS verdict
      FROM scored s
     WHERE s.evaluator_result ? 'verdict'
  ), essay_criteria AS (
    -- 루브릭 기준을 다시 붙여 **국면별**로 셉니다. criterionId 자체는 의미가 없습니다 —
    -- 학습자에게 필요한 것은 "답은 아는데 이유를 못 쓴다"이지 "…:0:1 미충족"이 아닙니다.
    SELECT rb.value ->> 'aspect' AS aspect, c.value ->> 'level' AS level
      FROM scored s
      JOIN quiz_run_items ri ON ri.id = s.quiz_run_item_id
      JOIN quiz_questions q  ON q.id = ri.question_id AND q.owner_user_id = v_uid
      CROSS JOIN LATERAL jsonb_array_elements(s.evaluator_result -> 'criteria') c
      LEFT JOIN LATERAL jsonb_array_elements(q.rubric) rb
             ON rb.value ->> 'id' = c.value ->> 'criterionId'
     WHERE jsonb_typeof(s.evaluator_result -> 'criteria') = 'array'
       AND rb.value ->> 'aspect' IS NOT NULL
  ), by_deck AS (
    SELECT d.id AS deck_id, d.name AS deck_name,
           count(*) AS answers,
           count(*) FILTER (WHERE s.normalized_score >= 0.75) AS known
      FROM scored s
      JOIN cards c ON c.id = s.card_id
      JOIN decks d ON d.id = c.deck_id
     GROUP BY d.id, d.name
  ), by_tag AS (
    -- 태그별. 오답이 한 주제에 몰려 있다는 것은 카드 단위로는 절대 보이지 않는 사실이고,
    -- 학습자가 바로 행동할 수 있는 종류의 사실입니다.
    SELECT tag, count(*) AS answers,
           count(*) FILTER (WHERE s.normalized_score >= 0.75) AS known
      FROM scored s
      JOIN cards c ON c.id = s.card_id
      CROSS JOIN LATERAL unnest(COALESCE(c.tags, '{}'::text[])) AS tag
     GROUP BY tag
  )
  SELECT jsonb_build_object(
    'goal_id', p_goal_id,
    'days', p_days,
    'attempts', (SELECT count(*) FROM scoped),
    'scored', (SELECT count(*) FROM scored),
    'known', (SELECT count(*) FROM scored WHERE normalized_score >= 0.75),
    -- 최근 7일 대 전체 기간. "30일 84%인데 최근 7일은 61%"는 비율 하나가 절대 말할 수 없는
    -- 것이고, 학습자가 가장 먼저 알아야 하는 것입니다.
    'recent_scored', (SELECT count(*) FROM scored WHERE created_at >= v_from7),
    'recent_known', (SELECT count(*) FROM scored
                      WHERE created_at >= v_from7 AND normalized_score >= 0.75),
    'mcq_flaws', COALESCE((SELECT jsonb_object_agg(flaw, n) FROM (
        SELECT flaw, count(*) AS n FROM mcq_misses WHERE flaw IS NOT NULL GROUP BY flaw) f), '{}'::jsonb),
    'short_gaps', COALESCE((SELECT jsonb_object_agg(gap, n) FROM (
        SELECT gap, count(*) AS n FROM short_gaps GROUP BY gap) g), '{}'::jsonb),
    'short_verdicts', COALESCE((SELECT jsonb_object_agg(verdict, n) FROM (
        SELECT verdict, count(*) AS n FROM short_verdicts WHERE verdict IS NOT NULL GROUP BY verdict) v), '{}'::jsonb),
    'essay_aspects', COALESCE((SELECT jsonb_object_agg(aspect, counts) FROM (
        SELECT aspect, jsonb_build_object(
                 'met',     count(*) FILTER (WHERE level = 'met'),
                 'partial', count(*) FILTER (WHERE level = 'partial'),
                 'not_met', count(*) FILTER (WHERE level = 'not_met')) AS counts
          FROM essay_criteria GROUP BY aspect) e), '{}'::jsonb),
    'decks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'deck_id', deck_id, 'deck_name', deck_name, 'answers', answers, 'known', known)
        ORDER BY answers DESC) FROM by_deck), '[]'::jsonb),
    'tags', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'tag', tag, 'answers', answers, 'known', known)
        ORDER BY (answers - known) DESC, answers DESC)
        FROM (SELECT * FROM by_tag ORDER BY (answers - known) DESC LIMIT 10) t), '[]'::jsonb)
  ) INTO r;

  RETURN r;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_learning_diagnosis_evidence(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_learning_diagnosis_evidence(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.get_learning_diagnosis_evidence(uuid, integer) IS
  'Counted, closed-set evidence for one goal: which wrong option kinds, which answer gaps, which essay aspects, which decks and tags the misses cluster in, and the 7-day trend against the window. Reads quiz_questions, which the client may not — so it returns COUNTS ONLY, over answered items, and never a per-question label.';

-- ── 4) 진단을 예약할 수 있게 ────────────────────────────────────────────────
--
-- 216 그대로에서 세 군데만 다릅니다: 허용 목록에 'diagnose', 값을 행동별로 찾기, 그리고
-- 목표를 키로 한 재사용/진행중 판정.
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
  v_price := COALESCE(public._ai_action_price(
    CASE p_action WHEN 'diagnose' THEN 'diagnosis' ELSE 'remediation_explain' END), 0);
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
GRANT EXECUTE ON FUNCTION public.reserve_ai_remediation(text, uuid, uuid, uuid, uuid[], uuid[])
  TO authenticated;

COMMIT;
