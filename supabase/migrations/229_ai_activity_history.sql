-- 229: 기록 only ever showed card study.
--
-- The history page reads `study_sessions` and `study_logs` and nothing else, so a learner who
-- spent an afternoon generating a deck, sitting three quizzes and paying for six gradings saw an
-- empty day. Everything they did through the part of the app that costs money was missing from
-- the only screen that answers "what have I been doing".
--
-- One read, one timeline, two sources:
--
--   quiz    a sitting, with the tally it came out with — counted by `_quiz_run_tally`, so the
--           history and the result screen cannot disagree about the same run
--   ai_gen  a generation job: cards, deck metadata, template, image, quiz or grading
--
-- Money is reported as it was CHARGED, from `price_micro_usd`, and refunded jobs say so rather
-- than vanishing — a learner looking for what they spent needs the refund to be visible, not the
-- row to be absent.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_ai_activity(
  p_limit integer DEFAULT 50,
  p_since timestamptz DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  -- The ORDER BY and LIMIT belong to the ROWS, inside the subquery. Outside they applied to the
  -- aggregate — which is one row — so `p_limit := 8` returned all 95 entries. Caught by asking
  -- production for eight and counting what came back.
  SELECT jsonb_agg(x ORDER BY at DESC) INTO v_out
  FROM (
    SELECT * FROM (
    SELECT jsonb_build_object(
      'kind', 'quiz',
      'id', r.id,
      'at', COALESCE(r.completed_at, r.started_at),
      'title', s.title,
      'deck_name', d.name,
      'question_type', s.question_type,
      'attempt_no', r.attempt_no,
      'status', r.status,
      'tally', public._quiz_run_tally(r.id),
      'price_micro', 0
    ) AS x, COALESCE(r.completed_at, r.started_at) AS at
    FROM quiz_runs r
    JOIN quiz_sets s ON s.id = r.set_id
    LEFT JOIN decks d ON d.id = s.deck_id
    WHERE r.user_id = v_uid
      AND (p_since IS NULL OR COALESCE(r.completed_at, r.started_at) >= p_since)

    UNION ALL

    SELECT jsonb_build_object(
      'kind', 'ai_gen',
      'id', j.id,
      'at', j.created_at,
      -- `job_kind` is null on the oldest rows, from before it existed. 'cards' is what they all
      -- were: the other kinds were added later, each with its own kind from the start.
      'job_kind', COALESCE(j.job_kind, 'cards'),
      'cards', j.free_cards + j.paid_cards,
      'images', j.image_jobs,
      'quiz_action', j.quiz_action,
      -- What was actually charged. A job inside the free allowance is 0, and that is worth
      -- showing: "free" is information, not an absence.
      'price_micro', CASE WHEN j.refunded THEN 0 ELSE COALESCE(j.price_micro_usd, 0) END,
      'refunded', j.refunded
    ) AS x, j.created_at AS at
    FROM ai_generation_jobs j
    WHERE j.user_id = v_uid
      AND (p_since IS NULL OR j.created_at >= p_since)
      -- A reservation that was never charged and never refunded is an abandoned request, not
      -- something the learner did. Charged OR refunded means it happened.
      AND (j.charged OR j.refunded)
    ) u
    WHERE at IS NOT NULL
    ORDER BY at DESC
    LIMIT p_limit
  ) t;

  RETURN COALESCE(v_out, '[]'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_ai_activity(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_activity(integer, timestamptz) TO authenticated;

COMMIT;
