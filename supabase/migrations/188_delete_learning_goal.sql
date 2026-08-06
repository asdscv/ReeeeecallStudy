-- ============================================================================
-- 188: deleting a plan, as opposed to hiding it
--
-- ── The problem ─────────────────────────────────────────────────────────────
--
-- `archive_learning_goal` is the only way to get a plan off the list, and it is a
-- status flip: the row stays, its decks stay linked, and every daily_plan it ever
-- produced stays. That is the right operation for "I finished this" — the history
-- is worth keeping — and the wrong one for "I made this by mistake" or "I do not
-- want this on your servers any more", which is a deletion in the ordinary sense
-- of the word and, under 개인정보보호법 §36 / GDPR art. 17, in the legal one too.
--
-- ── What cascades, and what deliberately does not ───────────────────────────
--
-- The foreign keys were already written for this (mig 165):
--
--   learning_goal_decks.goal_id      ON DELETE CASCADE   the deck links go
--   learning_goal_concepts.goal_id   ON DELETE CASCADE   ditto
--   daily_plans.goal_id              ON DELETE CASCADE   → daily_plan_items cascade in turn
--   answer_attempts.goal_id          ON DELETE SET NULL  the attempt SURVIVES
--   answer_attempts.plan_item_id     ON DELETE SET NULL  ditto, via the item
--   study_recommendations.goal_id    ON DELETE SET NULL
--   ai_enrichments.goal_id           ON DELETE SET NULL
--
-- So the plan and its schedule go; the record of what the learner actually
-- answered stays, detached. That asymmetry is on purpose. An attempt also carries
-- `card_id`, and it is the evidence behind the card's SRS state — the card was
-- genuinely reviewed, and deleting a plan is not a claim that it was not. Erasing
-- them would silently rewrite the learner's own study history to tidy up a list.
--
-- The CARDS and DECKS are untouched. A goal links decks; it does not own them.
--
-- ── Why an RPC and not RLS + DELETE ─────────────────────────────────────────
--
-- Every write in this schema goes through a SECURITY DEFINER function with the
-- tables revoked from clients (ARCHITECTURE.md §2), and `learning_goals` carries
-- no DELETE policy at all — a client DELETE would fail, silently returning zero
-- rows rather than an error, which is the worst possible outcome for a destructive
-- action the UI is about to report as done.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_learning_goal(p_goal_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_goal_id IS NULL THEN
    RAISE EXCEPTION 'goal id is required' USING ERRCODE = 'P0002';
  END IF;

  -- Archived goals are deletable too, unlike every other RPC here, which refuses
  -- them. Those refuse because they would MODIFY a goal the learner has retired;
  -- this one removes it, and "I archived it and now I want it gone" is the most
  -- likely path to this button.
  DELETE FROM learning_goals
   WHERE id = p_goal_id AND user_id = v_uid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Not found and not owned are answered with the SAME code on purpose: telling a
  -- caller "that id exists but is not yours" is an existence oracle over other
  -- users' rows.
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'Goal not found or not owned' USING ERRCODE = 'P0003';
  END IF;

  RETURN jsonb_build_object('ok', true, 'goal_id', p_goal_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_learning_goal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_learning_goal(uuid) TO authenticated;

COMMENT ON FUNCTION public.delete_learning_goal(uuid) IS
  'Permanently remove a learning goal. Its deck links and every daily plan cascade; answer attempts survive with goal_id NULL, because they are the record of study that actually happened.';
