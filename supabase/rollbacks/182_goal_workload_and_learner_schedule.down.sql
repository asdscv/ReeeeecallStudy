-- Rollback for 182 — restore migration 181's version of get_goal_knowledge.
--
-- NOT a DROP. 182 is a CREATE OR REPLACE of a function both clients call; dropping it
-- would take the goal-progress panel down entirely rather than returning it to the
-- previous behaviour. A rollback should undo a change, not remove the feature.
--
-- What comes back is therefore 181 verbatim, INCLUDING its defect: progress read from
-- `cards.*`, which is the publisher's schedule on any deck the learner does not own, so
-- official-deck goals will again read as "not started". That is what reverting 182 means,
-- and it is written down here rather than discovered.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT, so the dry-run can apply and revert
-- repeatedly.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_goal_knowledge(
  p_goal_id uuid,
  p_at timestamptz,
  p_stability_multiplier numeric DEFAULT 1.0
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_owner    uuid;
  v_total    bigint := 0;
  v_unseen   bigint := 0;
  v_known    bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'p_at is required' USING ERRCODE = 'P0002';
  END IF;
  -- A non-positive multiplier would mark every reviewed card as forgotten, which is a silently
  -- wrong answer rather than an obviously wrong one.
  IF p_stability_multiplier IS NULL OR p_stability_multiplier <= 0 THEN
    RAISE EXCEPTION 'p_stability_multiplier must be positive' USING ERRCODE = 'P0002';
  END IF;

  SELECT user_id INTO v_owner FROM learning_goals WHERE id = p_goal_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Goal not found' USING ERRCODE = 'P0002';
  END IF;
  -- SECURITY DEFINER bypasses RLS, so ownership is checked explicitly. Reading another user's
  -- goal progress would be an IDOR of exactly the shape migrations 098/099 closed elsewhere.
  IF v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  WITH goal_cards AS (
    SELECT c.id, c.interval_days, c.last_reviewed_at
    FROM learning_goal_decks lgd
    JOIN cards c ON c.deck_id = lgd.deck_id
    WHERE lgd.goal_id = p_goal_id
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE last_reviewed_at IS NULL OR interval_days IS NULL OR interval_days <= 0),
    count(*) FILTER (
      WHERE last_reviewed_at IS NOT NULL
        AND interval_days IS NOT NULL
        AND interval_days > 0
        -- elapsed <= interval * k, expressed as a deadline so the comparison stays on dates.
        AND p_at <= last_reviewed_at + ((interval_days * p_stability_multiplier) * INTERVAL '1 day')
    )
  INTO v_total, v_unseen, v_known
  FROM goal_cards;

  RETURN jsonb_build_object(
    'total', v_total,
    'unseen', v_unseen,
    'known', v_known,
    'unknown', v_total - v_unseen - v_known
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) TO authenticated;

COMMIT;
