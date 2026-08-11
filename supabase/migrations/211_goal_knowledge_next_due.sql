-- 211 — "오늘 이 덱들에서 복습할 카드가 없습니다" needs to be able to say WHEN.
--
-- A learner finished all twelve of today's items, pressed 더 하기, and got that sentence. It
-- was true in the sense the code meant it — nothing was due at that instant — and false in
-- every sense they could read it in. Twelve of their cards were coming back within ten
-- minutes: rated 몰랐음 or mid-learning-step, so `interval_days = 0` and `next_review_at` a few
-- minutes out. The screen told them the decks had nothing, the card above it told them twelve
-- reviews were overdue, and neither sentence was about what had actually happened — which is
-- that they were done for now.
--
-- The screen cannot say "잠시 뒤에 다시 나와요" because nothing tells it when the next card is
-- due. `get_goal_knowledge` scans exactly the rows that know: it already computes `due_now`
-- (`next_review_at <= p_at`) and `overdue` from that scan. So this adds the one aggregate that
-- turns an empty state into an answer:
--
--     next_due_at — the soonest FUTURE review across the goal's cards, or null
--
-- Null means nothing is scheduled at all, which is a different screen from "nothing right
-- now": the first needs new cards, the second needs a clock.
--
-- Read-only, one more aggregate over a scan that already runs. The rest of the body is 192's
-- verbatim — same `learner_card_schedule` source, same predicates — because a second
-- definition of "the goal's cards" is how the counts on this screen came to disagree in the
-- first place.
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
  v_mature    bigint := 0;
  v_rung1     bigint := 0;
  v_rung3     bigint := 0;
  v_rung8     bigint := 0;
  v_next_due  timestamptz;
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
  IF v_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

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
        AND p_at <= last_reviewed_at + ((interval_days * p_stability_multiplier) * INTERVAL '1 day')
    ),
    count(*) FILTER (
      WHERE last_reviewed_at IS NOT NULL
        AND next_review_at IS NOT NULL
        AND next_review_at <= p_at
    ),
    count(*) FILTER (
      WHERE last_reviewed_at IS NOT NULL
        AND next_review_at IS NOT NULL
        AND next_review_at < p_at - INTERVAL '1 day'
    ),
    -- ── Mastery ──────────────────────────────────────────────────────────────
    -- Retained rather than being learned. Deliberately NOT filtered on whether the
    -- card is currently due: a mature card one day overdue has not stopped being
    -- mature, and making completion depend on the learner's punctuality would let a
    -- finished goal un-finish itself overnight.
    count(*) FILTER (WHERE interval_days >= 21),
    -- The rungs below it, so a client can say WHEN the rest will get there without
    -- reading every card row. The ladder is [1,3,8,21]: a card at rung 8 is one
    -- successful review and 8 days from mature, at rung 3 it is 11 days, and at 1 or
    -- in a learning step it is 12.
    count(*) FILTER (WHERE last_reviewed_at IS NOT NULL AND coalesce(interval_days, 0) BETWEEN 0 AND 2),
    count(*) FILTER (WHERE interval_days BETWEEN 3 AND 7),
    count(*) FILTER (WHERE interval_days BETWEEN 8 AND 20),
    -- The soonest review still AHEAD. Deliberately excludes anything already due: `due_now`
    -- answers "is there work right now", and a screen showing both would otherwise print a
    -- time in the past beside a count of overdue cards.
    min(next_review_at) FILTER (WHERE next_review_at IS NOT NULL AND next_review_at > p_at)
  INTO v_total, v_unseen, v_known, v_due_now, v_overdue, v_mature, v_rung1, v_rung3, v_rung8,
       v_next_due
  FROM goal_cards;

  RETURN jsonb_build_object(
    'total', v_total,
    'unseen', v_unseen,
    'known', v_known,
    'unknown', v_total - v_unseen - v_known,
    'new_remaining', v_unseen,
    'due_now', v_due_now,
    'overdue', v_overdue,
    'mature', v_mature,
    -- Cards not yet mature, by how far they still have to climb. Named for the
    -- interval they sit at, not for days remaining, so the client owns the ladder
    -- arithmetic and this stays a description of the schedule.
    'rung1', v_rung1,
    'rung3', v_rung3,
    'rung8', v_rung8,
    -- Null when nothing is scheduled ahead at all — a different screen from "nothing right
    -- now", and the client has to be able to tell the two apart.
    'next_due_at', v_next_due
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) TO authenticated;

COMMENT ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) IS
  'Card-state counts for a goal at an instant, plus `next_due_at` — the soonest review still ahead — so an empty day can say when the learner is back instead of reading as a failure.';

COMMIT;
