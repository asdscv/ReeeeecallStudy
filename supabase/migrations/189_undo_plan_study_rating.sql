-- ============================================================================
-- 189: undoing a plan rating has to undo BOTH halves
--
-- ── The hole 187 left open ──────────────────────────────────────────────────
--
-- `apply_plan_study_rating` (mig 187) made one action move two things: the card's
-- SRS state and the plan item. `undo_study_rating` only knows about the first.
--
-- So in a plan session the 5-second 되돌리기 button produced exactly the split 187
-- exists to prevent, only backwards:
--
--   card   → rolled back to its previous schedule ✔
--   plan   → still says 'completed', completed_items still incremented ✘
--
-- The learner is then told the card is done for today while it is back on its old
-- due date; the item can never be completed again (`record_answer_attempt` only
-- acts on a 'pending' row), so re-rating the card studies it twice and the day's
-- count stays permanently one too high. Reproduced on a real database before this
-- was written: rate → completed_items 1→2, undo → SRS restored, completed_items
-- stayed 2.
--
-- ── What this does ──────────────────────────────────────────────────────────
--
-- Calls `undo_study_rating` for the schedule half — no copy of that logic exists
-- here, and its guards (only the latest applied event, PT409 on a concurrent
-- change, idempotent replay) are the ones that decide whether the undo happens at
-- all. Only if it succeeds does the plan half unwind.
--
-- The attempt row is DELETED rather than flagged, mirroring what
-- `undo_study_rating` does to the `study_logs` row. An attempt that survived a
-- retraction would still show in 최근 시도 and could ground a paid AI request about
-- a rating the learner took back. The rating EVENT is kept as `undone` — that is
-- the audit trail, and it already exists.
--
-- Idempotent by the same route: a replayed undo finds the event already 'undone'
-- and the plan item already 'pending', and returns without touching either.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.undo_plan_study_rating(
  p_event_id          uuid,
  p_client_attempt_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_undo      jsonb;
  v_attempt   answer_attempts%ROWTYPE;
  v_item      daily_plan_items%ROWTYPE;
  v_reopened  boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_event_id IS NULL OR p_client_attempt_id IS NULL THEN
    RAISE EXCEPTION 'event and client attempt ids are required' USING errcode = '22023';
  END IF;

  -- Schedule half first. It owns every reason an undo can be refused, and a refusal
  -- must leave the plan exactly as it was rather than half-unwound.
  v_undo := public.undo_study_rating(p_event_id);

  SELECT * INTO v_attempt
    FROM answer_attempts
   WHERE user_id = v_uid AND client_attempt_id = p_client_attempt_id
   FOR UPDATE;

  -- Already undone, or the rating never had a plan half. Both are fine: the caller
  -- retries undos, and `apply_plan_study_rating` is not the only writer of ratings.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'rating', v_undo, 'reopened', false);
  END IF;

  IF v_attempt.plan_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM daily_plan_items WHERE id = v_attempt.plan_item_id FOR UPDATE;

    -- Only unwind the item THIS attempt completed. If something else completed it
    -- since, decrementing the day's count would take away someone else's work.
    IF FOUND AND v_item.status = 'completed' AND v_item.completion_attempt_id = v_attempt.id THEN
      UPDATE daily_plan_items
         SET status = 'pending', completion_attempt_id = NULL
       WHERE id = v_item.id;

      -- The exact inverse of record_answer_attempt's aggregate update, floored at 0
      -- so a stray double-undo cannot drive a count negative.
      UPDATE daily_plans
         SET completed_items = GREATEST(0, completed_items - 1),
             completed_minutes = GREATEST(0, completed_minutes - COALESCE(v_attempt.duration_ms / 60000, 0)),
             status = CASE
               WHEN GREATEST(0, completed_items - 1) = 0 THEN 'pending'
               WHEN status = 'completed' THEN 'active'
               ELSE status
             END
       WHERE id = v_item.plan_id;

      v_reopened := true;
    END IF;
  END IF;

  -- Mirrors undo_study_rating deleting its study_logs row: the retracted answer
  -- leaves no record that could later be quoted back at the learner or paid to
  -- have explained.
  DELETE FROM answer_attempts WHERE id = v_attempt.id;

  RETURN jsonb_build_object('ok', true, 'rating', v_undo, 'reopened', v_reopened);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_plan_study_rating(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_plan_study_rating(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.undo_plan_study_rating(uuid, uuid) IS
  'Reverse one apply_plan_study_rating: undoes the SRS rating and reopens the plan item it completed, in a single transaction. Without it, undo left the plan claiming a card was done that had been put back on its old schedule.';
