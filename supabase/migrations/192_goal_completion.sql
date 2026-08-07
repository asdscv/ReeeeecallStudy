-- ============================================================================
-- 192: a goal that can finish
--
-- ── What was missing ────────────────────────────────────────────────────────
--
-- "로직으로 저 학습플랜 완료하는건 언제야?"  Never. There was no answer anywhere.
--
--   * `learning_goals.status` has allowed 'completed' since mig 165, and
--     `update_learning_goal` has permitted active -> completed since 167.
--   * `learning_goals.target jsonb` was created in 165 for exactly this and is `{}`
--     on every row in production. Nothing writes it, nothing reads it.
--   * No code anywhere sets a goal to 'completed'. Not a button, not a rule.
--   * `target_date` is used for pacing and nothing reacts when it passes.
--
-- So a goal ran forever. And it has to, under SRS: reviews recur with growing
-- intervals and the daily count never reaches zero. "Done" is a product decision
-- the engine cannot make for itself, and nobody had made it.
--
-- ── The rule ────────────────────────────────────────────────────────────────
--
-- A goal is complete when 80% of its cards are MATURE, where mature means an
-- interval of 21 days or more.
--
-- 21 is the fourth rung of the scheduler's own ladder (INTERVALS_DAYS in
-- workload.ts is [1,3,8,21,56,151,365]) and the long-standing spaced-repetition
-- convention for "this is retained rather than being learned". Reaching it takes
-- four successful answers over twelve days — 0d, 0d+10min, 1d, 4d, 12d — so it is
-- a claim about memory surviving gaps, not about having seen a card.
--
-- The ratio is compared directly, `mature * 100 >= total * 80`, with no rounding
-- kindness. That makes a 2-4 card goal require every card, which is correct: three
-- of four cards known is not a finished goal, and any absolute slack ("all but two")
-- would complete a two-card goal at zero cards learned.
--
-- ── Why completion sticks ───────────────────────────────────────────────────
--
-- `again_days = 0` sends a lapsed card back to interval 0, so one wrong answer
-- moves a card out of mature. On a 29-card goal that is 83% -> 79%; on a 2-card
-- goal it is 100% -> 50%. A live gauge would therefore flicker between complete and
-- incomplete on every mistake.
--
-- So completion is a RECORD, not a state: the first time the ratio is met the goal
-- is stamped 'completed' and it stays. Reviews keep coming — finishing a goal does
-- not mean abandoning the cards — but the milestone is not taken back because the
-- learner got one card wrong next week.
--
-- ── Why the server judges ───────────────────────────────────────────────────
--
-- `update_learning_goal(p_status := 'completed')` would let any client stamp any
-- goal. Nothing catastrophic — it is the caller's own goal — but then the rule lives
-- in whichever client happened to implement it, and web and mobile would drift the
-- way `known / attempted` versus `known / total` already did once. One function,
-- one definition, and it re-checks rather than trusting what it was told.
-- ============================================================================

BEGIN;

-- ── get_goal_knowledge gains the mastery numbers ────────────────────────────
--
-- Everything from 191 is reproduced verbatim so this file is the whole current
-- definition rather than a diff to chase. New keys only; no existing key changes
-- meaning, so a client deployed before this reads exactly what it read before.
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

-- ── The completion stamp ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_goal_if_earned(p_goal_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_goal    learning_goals%ROWTYPE;
  v_total   bigint := 0;
  v_mature  bigint := 0;
  v_earned  boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_goal FROM learning_goals WHERE id = p_goal_id FOR UPDATE;
  IF NOT FOUND OR v_goal.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Goal not found or not owned' USING ERRCODE = 'P0003';
  END IF;

  -- Already stamped, or not in a state that can be. Idempotent on purpose: the client
  -- calls this whenever it reads a goal's progress, which is often.
  IF v_goal.status <> 'active' THEN
    RETURN jsonb_build_object('completed', v_goal.status = 'completed', 'changed', false);
  END IF;

  WITH goal_cards AS (
    SELECT s.interval_days
    FROM learner_card_schedule(
      v_uid,
      ARRAY(SELECT deck_id FROM learning_goal_decks WHERE goal_id = p_goal_id)
    ) s
  )
  SELECT count(*), count(*) FILTER (WHERE interval_days >= 21)
  INTO v_total, v_mature
  FROM goal_cards;

  -- A goal with no cards cannot be finished. 0/0 is not 100%: there is nothing to
  -- have learned, and stamping it would turn "you have not added any decks yet" into
  -- a completion.
  v_earned := v_total > 0 AND (v_mature * 100) >= (v_total * 80);

  IF NOT v_earned THEN
    RETURN jsonb_build_object('completed', false, 'changed', false,
                              'total', v_total, 'mature', v_mature);
  END IF;

  UPDATE learning_goals
     SET status = 'completed',
         -- What the stamp was earned against, so a later change to the rule or to the
         -- deck cannot rewrite history. `target` has been an empty jsonb on every row
         -- since mig 165 created it for exactly this.
         target = coalesce(target, '{}'::jsonb) || jsonb_build_object(
           'completion', jsonb_build_object(
             'rule', 'mature_ratio_v1',
             'mature_interval_days', 21,
             'ratio', 0.8,
             'total_at', v_total,
             'mature_at', v_mature,
             'completed_at', now()
           )
         )
   WHERE id = p_goal_id;

  RETURN jsonb_build_object('completed', true, 'changed', true,
                            'total', v_total, 'mature', v_mature);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_goal_if_earned(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_goal_if_earned(uuid) TO authenticated;

COMMENT ON FUNCTION public.complete_goal_if_earned(uuid) IS
  'Stamp a goal completed the first time 80% of its cards reach a 21-day interval. Idempotent, server-judged, and one-way: a lapse afterwards does not un-complete it, because again_days = 0 would otherwise make a 2-card goal flicker between 100% and 50% on a single wrong answer.';

COMMIT;
