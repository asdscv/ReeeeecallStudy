-- 247: 246 의 오답 유형 집계가 프로덕션에서 항상 비어 있었습니다.
--
-- `quiz_questions.meta->'flaws'` 는 **배열**입니다 — `options` 와 나란하고, 정답 자리에는
-- null 이 들어갑니다(`QuizItemMultipleChoice.flaws: ReadonlyArray<McqDistractorFlaw | null>`).
-- 246 은 그것을 객체처럼 텍스트 키로 읽었습니다:
--
--       q.meta -> 'flaws' ->> (ri.option_order[...])::text     -- 배열에 텍스트 키 → NULL
--
-- jsonb 배열에 `->>` 로 텍스트 키를 주면 조용히 NULL 입니다. 예외도, 경고도 없습니다. 그래서
-- 진단의 헤드라인 증거 — 어떤 종류의 오답 보기를 고르는가 — 가 언제나 `{}` 였습니다.
--
-- 프로덕션에서 확인: 이 계정의 30일 안 객관식 오답 10건이 전부 `choice` 를 담고 있고 전부
-- `meta.flaws` 를 갖고 있는데, 집계는 0건이었습니다.
--
-- 246 의 테스트가 이걸 못 잡은 이유가 더 중요합니다. 테스트가 `jsonb_build_object('1',...)`
-- 로 **객체**를 심었습니다. 실제로 쓰이지 않는 모양을 심어 놓고 통과한 것이라, 통과 자체가
-- 아무것도 보증하지 않았습니다. 같은 변경에서 테스트도 배열로 고칩니다.
--
-- 본문은 246 그대로이고 그 한 줄만 다릅니다.
BEGIN;

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
    SELECT a.*
      FROM answer_attempts a
     WHERE a.user_id = v_uid AND a.goal_id = p_goal_id AND a.created_at >= v_from
  ), scored AS (
    SELECT * FROM scoped WHERE normalized_score IS NOT NULL
  ), mcq_misses AS (
    -- 표시 index → 정규 index → 그 자리의 flaw. `flaws` 는 `options` 와 나란한 **배열**이고
    -- 정답 자리는 null 입니다. 정수 첨자여야 합니다 — 텍스트 키는 조용히 NULL 입니다.
    SELECT q.meta -> 'flaws' ->> (ri.option_order[(s.response ->> 'choice')::int + 1])::int AS flaw
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

COMMIT;
