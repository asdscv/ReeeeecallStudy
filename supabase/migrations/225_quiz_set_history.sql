-- 225: the quiz list said nothing about when a set was made or whether it had ever been taken.
--
-- Every row read `제목 / 객관식 · 10문항 / 풀기` and stopped. A learner with a dozen sets could not
-- tell yesterday's from March's, could not tell one they had sat three times from one they had
-- never opened, and could not see how it went. `created_at` was already being SELECTed by the
-- client and thrown away; the rest was in `quiz_runs` and `answer_attempts` and nobody asked.
--
-- Two reads.
--
-- `list_quiz_sets` replaces the client's raw table select so the aggregate arrives with the row
-- rather than as a second round trip per set — a list of fifty sets would otherwise be fifty
-- queries, and the aggregate is the reason the row is worth showing at all.
--
-- `get_quiz_set_history` is the per-set detail: one line per sitting, oldest attempt number first.
--
-- Both count the same way the screen does, and that is not incidental. `quiz_runs.score_raw /
-- score_max` is the arithmetic that read 17% — it divides by the question count, so an ungraded
-- answer scores zero — and a history that used it would contradict the result screen about the
-- same sitting. So the tally is built from `answer_attempts` with the grader's own KNOWN band,
-- 0.75, which is `CORRECT_AT` in `packages/shared/lib/quiz-outcome.ts`. Three counts, never a
-- ratio: an ungraded answer is not a wrong answer.
BEGIN;

-- The tally for one run. Extracted because two functions must not drift about what "correct"
-- means for the same sitting.
CREATE OR REPLACE FUNCTION public._quiz_run_tally(p_run_id uuid)
  RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',     count(*),
    'answered',  count(a.id),
    -- 0.75 is the grader's own KNOWN band, and the same constant the run and result screens
    -- use. A learner told 맞음 who then finds it counted as a miss here would trust neither.
    'correct',   count(*) FILTER (WHERE a.normalized_score >= 0.75),
    'wrong',     count(*) FILTER (WHERE a.normalized_score < 0.75),
    -- Answered but nobody has judged it: short answer and essay until the learner pays. NOT
    -- folded into wrong — that would charge them a mark for declining to spend.
    'ungraded',  count(*) FILTER (WHERE a.id IS NOT NULL AND a.normalized_score IS NULL))
  FROM quiz_run_items i
  LEFT JOIN answer_attempts a ON a.quiz_run_item_id = i.id
  WHERE i.run_id = p_run_id AND i.status <> 'void';
$$;

CREATE OR REPLACE FUNCTION public.list_quiz_sets(p_limit integer DEFAULT 50)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'id', s.id, 'deck_id', s.deck_id, 'title', s.title,
      'question_type', s.question_type, 'requested_count', s.requested_count,
      'generated_count', s.generated_count, 'status', s.status,
      'content_locale', s.content_locale, 'created_at', s.created_at,
      'deck_name', d.name,
      -- How many sittings, and when the last one was. Zero and null is a set never opened,
      -- which is a different thing from one taken and failed — the list could not tell them
      -- apart before, because it showed neither.
      'run_count', (SELECT count(*) FROM quiz_runs r WHERE r.set_id = s.id),
      'last_taken_at', (SELECT max(COALESCE(r.completed_at, r.started_at))
                          FROM quiz_runs r WHERE r.set_id = s.id),
      'last_tally', (SELECT public._quiz_run_tally(r.id)
                       FROM quiz_runs r WHERE r.set_id = s.id
                      ORDER BY r.attempt_no DESC LIMIT 1)
    ) AS x
    FROM quiz_sets s
    LEFT JOIN decks d ON d.id = s.deck_id
    WHERE s.owner_user_id = v_uid AND s.status = 'ready'
    ORDER BY s.created_at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.list_quiz_sets(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_quiz_sets(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_quiz_set_history(p_set_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_owner uuid; v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  SELECT owner_user_id INTO v_owner FROM quiz_sets WHERE id = p_set_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'Quiz set not accessible' USING errcode = '42501';
  END IF;

  SELECT jsonb_agg(x ORDER BY (x->>'attempt_no')::int DESC) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'run_id', r.id,
      'attempt_no', r.attempt_no,
      'status', r.status,
      'started_at', r.started_at,
      'completed_at', r.completed_at,
      'tally', public._quiz_run_tally(r.id)
    ) AS x
    FROM quiz_runs r
    WHERE r.set_id = p_set_id AND r.user_id = v_uid
  ) t;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_set_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_set_history(uuid) TO authenticated;

COMMIT;
