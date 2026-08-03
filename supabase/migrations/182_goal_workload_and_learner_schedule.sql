-- ============================================================================
-- 182: goal progress reads the LEARNER's schedule, and reports what is still owed
--
-- Two changes to `get_goal_knowledge`, both required before a goal can have a real
-- schedule.
--
-- ── 1. The publisher's schedule was being read as the learner's ─────────────
--
-- Migration 181 counts from `cards.interval_days` / `cards.last_reviewed_at`.
-- Those columns belong to the CARD, which means they belong to whoever OWNS the
-- deck. For a subscribed or official deck the learner's own schedule lives in
-- `user_card_progress` instead — `splitDecksBySrsSource` in
-- packages/shared/lib/learning-card-sources.ts is the client-side statement of
-- exactly this rule, and #389 fixed the same defect in the planner four days ago.
--
-- The consequence was not subtle: official deck cards carry interval_days = 0 and
-- last_reviewed_at = NULL for everyone, so every card of an official deck counted
-- as `unseen` no matter how much the learner had studied. A goal built on official
-- content read "not started" forever, while the planner — already fixed — knew
-- better. The two numbers on screen disagreed.
--
-- Fixed by resolving each card's schedule the same way the planner does: the
-- learner's `user_card_progress` row when the deck is not theirs, the card's own
-- columns when it is.
--
-- ── 2. It could not say how much work is LEFT ───────────────────────────────
--
-- A schedule needs three numbers the old shape did not report:
--   `new_remaining` — cards never started. These are the intake, and intake is the
--                     only real lever: one new card is ~7 further reviews over a
--                     year (the ladder in application/workload.ts), so the rate at
--                     which they are introduced decides the whole workload curve.
--   `due_now`       — reviews already owed. Non-negotiable work; it is what makes
--                     an honest daily budget different from a wished-for one.
--   `overdue`       — the part of `due_now` that is late, so "you are behind" can
--                     be said with a number rather than implied.
--
-- Added to the SAME function rather than a second one, deliberately: a separate RPC
-- would need its own copy of the goal-cards CTE and the ownership join, which is
-- how two counts of the same thing start disagreeing. The existing keys are
-- untouched, so the current caller keeps working.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT. No table is touched.
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
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_total     bigint := 0;
  v_unseen    bigint := 0;
  v_known     bigint := 0;
  v_due_now   bigint := 0;
  v_overdue   bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'p_at is required' USING ERRCODE = 'P0002';
  END IF;
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
    SELECT
      c.id,
      -- Whose schedule is this? The deck owner's columns live on the card; everyone
      -- else's live on their own progress row. A learner studying an official deck
      -- has never written to `cards`, so reading it would report the publisher's
      -- state — which for official content is a uniform "never reviewed".
      CASE WHEN d.user_id = v_uid THEN c.interval_days    ELSE ucp.interval_days    END AS interval_days,
      CASE WHEN d.user_id = v_uid THEN c.last_reviewed_at ELSE ucp.last_reviewed_at END AS last_reviewed_at,
      CASE WHEN d.user_id = v_uid THEN c.next_review_at   ELSE ucp.next_review_at   END AS next_review_at
    FROM learning_goal_decks lgd
    JOIN decks d ON d.id = lgd.deck_id
    JOIN cards c ON c.deck_id = lgd.deck_id
    LEFT JOIN user_card_progress ucp
      ON ucp.card_id = c.id AND ucp.user_id = v_uid
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
    ),
    -- Work already owed. A never-started card is NOT due: it is intake, counted in
    -- `unseen`, and gated by the daily new-card rate rather than by a due date.
    -- Counting it here would make "reviews I owe" include the entire unstarted deck.
    count(*) FILTER (
      WHERE last_reviewed_at IS NOT NULL
        AND next_review_at IS NOT NULL
        AND next_review_at <= p_at
    ),
    -- Late by more than a day. Separated from `due_now` so "behind" is a fact with a
    -- size, not an inference from a plan that happened to be too long.
    count(*) FILTER (
      WHERE last_reviewed_at IS NOT NULL
        AND next_review_at IS NOT NULL
        AND next_review_at < p_at - INTERVAL '1 day'
    )
  INTO v_total, v_unseen, v_known, v_due_now, v_overdue
  FROM goal_cards;

  RETURN jsonb_build_object(
    'total', v_total,
    'unseen', v_unseen,
    'known', v_known,
    'unknown', v_total - v_unseen - v_known,
    -- New keys. `unseen` already answers "how many are left to start", but it is
    -- named for the progress bar; `new_remaining` is the same number named for the
    -- scheduler, and keeping both means neither caller has to know the other's word.
    'new_remaining', v_unseen,
    'due_now', v_due_now,
    'overdue', v_overdue
  );
END;
$$;

COMMENT ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) IS
  'Goal progress + outstanding work, counted server-side over the whole goal. Resolves each '
  'card''s schedule from user_card_progress when the learner does not own the deck.';

-- Default privileges GRANT EXECUTE to PUBLIC on creation and CREATE OR REPLACE does
-- not re-alter them, so revoke before granting.
REVOKE EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) TO authenticated;

COMMIT;
