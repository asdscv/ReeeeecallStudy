-- ============================================================================
-- 181: get_goal_knowledge — how much of a goal the learner will still know on a
--      given date, aggregated server-side.
--
-- WHY AN RPC AND NOT A CLIENT COMPUTATION. The plan already fetches only DUE cards, capped, so
-- the client never holds a goal's full card set — deliberately, because a goal can span 10,000+
-- cards. Progress over the whole goal therefore has to be counted where the rows live.
--
-- WHY A MULTIPLIER PARAMETER AND NOT A RETENTION TARGET. "Known" is defined once, in TypeScript
-- (packages/shared/learning/application/knowledge.ts). Re-implementing the FSRS curve in SQL
-- would recreate exactly the split this work removed — the app already shipped two disagreeing
-- definitions of mastery, one of which counted a card as mastered after a single correct answer.
--
-- The curve collapses to something SQL can express without knowing the curve at all:
--
--     R(e, S) = (1 + (19/81)·e/S)^(-0.5)  >=  r
--   ⟺ e/S <= (r^-2 - 1)·(81/19)
--   ⟺ elapsed <= interval · k(r)
--
-- k is a pure function of the retention target — k(0.9) = 1 exactly, which is why the default
-- rule reduces to the pleasingly plain "the card is not overdue yet". The caller computes k from
-- the active criterion and passes the scalar; this function only compares dates. Change the
-- target, or the criterion, and nothing here needs to change.
--
-- Cards with no review history are counted as `unseen` and kept out of both known and unknown:
-- "no evidence" is not the same as "will have forgotten", and a brand-new deck must read as
-- not-started rather than as a confident 0%.
-- ============================================================================

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
