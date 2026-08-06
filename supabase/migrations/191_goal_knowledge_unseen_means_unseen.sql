-- ============================================================================
-- 191: `unseen` has to mean unseen
--
-- ── The report ──────────────────────────────────────────────────────────────
--
-- "17장은 뭐고 12장은 뭐야". The plan screen read "배운 17장 … / 아직 안 배움 12장"
-- over a goal of 29 cards. Measured against the same account:
--
--   cards with last_reviewed_at IS NULL  →  0
--   cards counted as `unseen`            →  12
--
-- Not one of those 12 was unseen. Every card in the goal had been studied.
--
-- ── The cause ───────────────────────────────────────────────────────────────
--
-- The filter, unchanged since mig 181 and carried into 186:
--
--     last_reviewed_at IS NULL OR interval_days IS NULL OR interval_days <= 0
--
-- `interval_days <= 0` was meant as a guard against junk rows. It is not: it is the
-- SRS's own value for a card in a LEARNING STEP. `srs.ts` returns `interval_days: 0`
-- for every learning-step transition (lines 130/144/168), and again for a review card
-- rated "again", because `DEFAULT_SRS_SETTINGS.again_days` is 0. `apply_study_rating`
-- (mig 160) writes it verbatim. So a card the learner answered thirty seconds ago —
-- the most recently studied cards they own — is filed under "never studied".
--
-- ── Why it surfaced now ─────────────────────────────────────────────────────
--
-- The progress bar used to be `known / attempted`, and a lapsing card left the
-- numerator and the denominator together, so the figure did not move. The bar is
-- `attempted / total` now, which exposes it in the worst possible direction:
--
--   rate a review card "again"  →  it leaves `known`, lands in `unseen`
--                               →  attempted falls, the BAR GOES BACKWARDS
--                               →  and the card is printed as "아직 안 배움"
--
-- Studying made the number worse and the screen called the answered card unstudied.
--
-- ── The fix ─────────────────────────────────────────────────────────────────
--
-- `unseen` is `last_reviewed_at IS NULL`, and nothing else. That is the same test the
-- planner has always used (`isNew: !card.last_reviewed_at` in learning-candidates.ts),
-- so this makes the two agree rather than inventing a third definition.
--
-- `known` is untouched: it still requires a real interval and a deadline in the future,
-- which a learning-step card does not have. Those cards therefore fall into `unknown`
-- via the `total - unseen - known` remainder — correctly, because a learning step IS
-- work owed right now (`next_review_at` is minutes away, and `due_now` below has always
-- counted them).
--
-- `new_remaining` is the same value under its scheduler-facing name, so it is fixed by
-- the same line: the intake counter stops claiming there are cards to introduce that
-- were introduced days ago.
--
-- Read-only function, no data change, no lock. Everything else in 186 is reproduced
-- verbatim so this file is the whole current definition rather than a diff to chase.
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

  -- Whose schedule is this? `learner_card_schedule` is the one place that answers, mirroring
  -- `getSrsSource` on the client. Scope is passed IN — the goal's decks — because the goal
  -- decides which cards count, and a resolver that also chose its own scope silently dropped
  -- subscribed cards the learner had not touched yet.
  WITH goal_cards AS (
    SELECT s.card_id AS id, s.interval_days, s.last_reviewed_at, s.next_review_at
    FROM learner_card_schedule(
      v_uid,
      ARRAY(SELECT deck_id FROM learning_goal_decks WHERE goal_id = p_goal_id)
    ) s
  )
  SELECT
    count(*),
    -- Never reviewed. NOT `interval_days <= 0`, which is the SRS's value for a card in a
    -- learning step or one just rated "again" — the most recently studied cards there are.
    count(*) FILTER (WHERE last_reviewed_at IS NULL),
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
    -- Studied, and not inside a review window: overdue reviews AND cards mid-learning-step.
    -- Both are work owed now, which is what every caller does with this number.
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

REVOKE EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) TO authenticated;

COMMENT ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) IS
  'Goal progress by card state. `unseen` is last_reviewed_at IS NULL and nothing else — the interval_days <= 0 clause it replaced counted every learning-step and just-lapsed card as never studied, which made the progress bar move BACKWARDS when a learner rated a review "again".';

COMMIT;
