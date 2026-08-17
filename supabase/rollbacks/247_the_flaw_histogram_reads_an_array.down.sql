-- 247 되돌리기: 246 의 (언제나 비어 있던) 텍스트 키 집계로 복원합니다.
--
-- 되돌리면 오답 유형 집계가 다시 항상 `{}` 가 됩니다 — 진단의 헤드라인 증거가 사라집니다.
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

COMMIT;
