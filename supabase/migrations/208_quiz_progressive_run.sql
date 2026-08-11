-- ============================================================================
-- 208: a long quiz starts before it is finished being written
--
-- ── The wait, and the bill ──────────────────────────────────────────────────
--
-- 207 made a quiz longer than one model call by generating in batches. That fixed
-- creation, but it left the learner watching a button: fifty multiple-choice questions
-- is seven batches at roughly fifteen seconds each, so the first question arrives about
-- a hundred seconds after the button is pressed.
--
-- The money argument is the stronger one. Each batch reserves and settles on its own, so
-- spending already tracks what was DELIVERED — but not what was USED. A learner who asks
-- for fifty and stops at question ten has paid for fifty questions they never saw. On a
-- product whose whole premise is selling AI usage, that is the wrong shape: it charges
-- for the intent rather than the act.
--
-- So the run opens as soon as the first batch lands, and the rest are written while the
-- learner works. Abandoning at question ten now costs roughly two batches, because
-- batches three onward are never requested.
--
-- ── Why a run has to be able to grow ────────────────────────────────────────
--
-- `start_quiz_run` SNAPSHOTS. It materialises `quiz_run_items` from the questions that
-- exist at that instant and fixes `item_count` and `score_max` from the same count. That
-- is correct and worth keeping: a sitting should not silently change shape underneath a
-- learner, and the score denominator must not move once answers are being graded against
-- it.
--
-- What it cannot express is a run that is still being written. `append_quiz_run_items`
-- adds only questions the run does not already hold, and moves both counters by the same
-- amount — so the denominator grows exactly as fast as the numerator can.
--
-- ── What it deliberately refuses ────────────────────────────────────────────
--
--   * a finished run — a completed sitting's score is a fact, and adding questions to it
--     would retroactively lower a percentage the learner has already been shown;
--   * someone else's run;
--   * a question already in the run — appending twice would serve one question twice and
--     count it twice.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.append_quiz_run_items(p_run_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_run  quiz_runs%ROWTYPE;
  v_set  quiz_sets%ROWTYPE;
  v_new  integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING errcode = '42501'; END IF;

  SELECT * INTO v_run FROM quiz_runs WHERE id = p_run_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiz run not accessible' USING errcode = '42501'; END IF;

  -- A finished sitting is a record. Its score_max is the denominator the learner was shown.
  IF v_run.status <> 'in_progress' THEN
    RETURN jsonb_build_object('run_id', p_run_id, 'added', 0,
                              'item_count', v_run.item_count, 'closed', true);
  END IF;

  SELECT * INTO v_set FROM quiz_sets WHERE id = v_run.set_id;

  WITH fresh AS (
    SELECT q.id, q.position, q.question_type
      FROM quiz_questions q
     WHERE q.set_id = v_run.set_id
       AND NOT EXISTS (
         SELECT 1 FROM quiz_run_items i
          WHERE i.run_id = p_run_id AND i.question_id = q.id)
  ), inserted AS (
    INSERT INTO quiz_run_items (run_id, question_id, position, option_order)
    SELECT p_run_id, f.id, f.position,
           -- Same per-sitting shuffle the run started with. Width comes from the stored
           -- options so a band wider than four is not silently truncated to four.
           CASE WHEN f.question_type = 'mcq'
                THEN ARRAY(SELECT i FROM generate_series(
                             0, COALESCE(array_length(
                               (SELECT options FROM quiz_questions WHERE id = f.id), 1), 4) - 1) i
                           ORDER BY random())::smallint[]
           END
      FROM fresh f ORDER BY f.position
    RETURNING 1
  )
  SELECT count(*) INTO v_new FROM inserted;

  IF v_new > 0 THEN
    -- Both counters move together: the denominator may only grow as fast as there are
    -- questions to answer, or a partly-written quiz would report a score out of a total
    -- that does not exist yet.
    UPDATE quiz_runs
       SET item_count = item_count + v_new,
           score_max  = score_max  + v_new
     WHERE id = p_run_id;
  END IF;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'added', v_new,
    'item_count', v_run.item_count + v_new,
    -- What the set is still aiming for, so a screen can say "12 / 50" while the rest is
    -- being written instead of showing a total that keeps changing.
    'requested', COALESCE(v_set.requested_count, v_run.item_count + v_new),
    'closed', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.append_quiz_run_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.append_quiz_run_items(uuid) TO authenticated;

COMMENT ON FUNCTION public.append_quiz_run_items(uuid) IS
  'Add questions written since a run started, moving item_count and score_max together. Lets a long quiz be answered while the rest of it is still being generated, so an abandoned quiz is not billed for questions nobody saw.';

-- ── The run payload carries the target ──────────────────────────────────────
--
-- Recreated from 203 with one field added. Without it a screen cannot tell "this quiz has
-- 8 questions" from "this quiz has 8 so far", so it either polls forever or stops early.
CREATE OR REPLACE FUNCTION public.get_quiz_run_items(p_run_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
                   THEN q.meta || jsonb_build_object('flaws', (
                          SELECT COALESCE(jsonb_agg(q.meta -> 'flaws' -> i.option_order[k]
                                                    ORDER BY k), '[]'::jsonb)
                            FROM generate_subscripts(i.option_order, 1) k))
                   ELSE q.meta END,
      'rubric', CASE WHEN a.id IS NOT NULL THEN q.rubric END,
      'reference_answer', CASE WHEN a.id IS NOT NULL THEN q.reference_answer END
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
$$;
REVOKE EXECUTE ON FUNCTION public.get_quiz_run_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_run_items(uuid) TO authenticated;

COMMIT;
