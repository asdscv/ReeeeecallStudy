-- Rollback 211 — get_goal_knowledge back to 192's exact body.
--
-- Safe in either direction: the client reads `next_due_at ?? null`, and a null simply shows
-- the plain "오늘 몫은 끝났어요" without a time under it.
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
    count(*) FILTER (WHERE interval_days BETWEEN 8 AND 20)
  INTO v_total, v_unseen, v_known, v_due_now, v_overdue, v_mature, v_rung1, v_rung3, v_rung8
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
    'rung8', v_rung8
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) TO authenticated;

COMMIT;
