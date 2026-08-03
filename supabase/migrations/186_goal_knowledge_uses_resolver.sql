-- ============================================================================
-- 186: one resolver for "whose schedule is this", with scope decided by the caller.
--
-- Migration 184 introduced `learner_card_schedule` to stop the ownership rule being written out
-- four times. It had a defect: it chose its own scope — decks you own, or decks you already have
-- a progress row in — so a subscribed card you had never touched was ABSENT rather than unseen.
-- Harmless for counting mastery (an untouched card is not mature either way) and wrong for a
-- goal total, which must include the whole deck. A differential test against 182 caught it:
-- total 12 where 182 said 14.
--
-- The fix is a design correction, not a patch. The resolver answers ONE question — which
-- schedule row belongs to this learner — and the CALLER says which cards it cares about:
--
--   mature_card_count      NULL scope  -> decks owned or touched, account-wide
--   get_goal_knowledge     the goal's decks, so an untouched subscribed card is still counted
--
-- With scope explicit, `get_goal_knowledge` returns byte-identical results to 182 on the same
-- data — verified by running both against the same fixture across three (moment, multiplier)
-- combinations before this was committed.
--
-- The 1-argument form is dropped rather than kept alongside: two overloads differing only by a
-- defaulted array is how an ambiguous call gets resolved to the wrong one at 3am.
--
-- Idempotent: DROP IF EXISTS + CREATE OR REPLACE. No table is touched.
-- ============================================================================

BEGIN;

-- Both callers are re-created below, so dropping this first leaves nothing pointing at a missing
-- function once the transaction commits.
DROP FUNCTION IF EXISTS public.learner_card_schedule(uuid);

/**
 * Every card in scope, with its schedule resolved to the right owner.
 *
 * `p_deck_ids` NULL means "this learner's library" — decks they own, plus any deck they hold a
 * progress row in. A non-null array means exactly those decks, whether or not the learner has
 * touched them, which is what a goal needs.
 */
CREATE OR REPLACE FUNCTION public.learner_card_schedule(
  p_user_id uuid,
  p_deck_ids uuid[] DEFAULT NULL
)
  RETURNS TABLE (
    card_id uuid,
    deck_id uuid,
    srs_status text,
    interval_days integer,
    ease_factor numeric,
    last_reviewed_at timestamptz,
    next_review_at timestamptz
  )
  LANGUAGE sql
  STABLE
  SET search_path = public
AS $$
  SELECT
    c.id,
    c.deck_id,
    CASE WHEN d.user_id = p_user_id THEN c.srs_status       ELSE ucp.srs_status       END,
    CASE WHEN d.user_id = p_user_id THEN c.interval_days    ELSE ucp.interval_days    END,
    CASE WHEN d.user_id = p_user_id THEN c.ease_factor      ELSE ucp.ease_factor      END,
    CASE WHEN d.user_id = p_user_id THEN c.last_reviewed_at ELSE ucp.last_reviewed_at END,
    CASE WHEN d.user_id = p_user_id THEN c.next_review_at   ELSE ucp.next_review_at   END
  FROM decks d
  JOIN cards c ON c.deck_id = d.id
  LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = p_user_id
  WHERE
    CASE
      WHEN p_deck_ids IS NOT NULL THEN d.id = ANY(p_deck_ids)
      -- Deck-level membership, not card-level: touching four cards of a deck puts the whole deck
      -- in your library, and the other cards are unseen rather than nonexistent.
      ELSE d.user_id = p_user_id
        OR EXISTS (SELECT 1 FROM user_card_progress p WHERE p.deck_id = d.id AND p.user_id = p_user_id)
    END;
$$;

-- SECURITY INVOKER (the default) so a direct caller sees only what RLS allows. The two callers
-- below are SECURITY DEFINER and execute as the owner, so they still see everything they need.
REVOKE EXECUTE ON FUNCTION public.learner_card_schedule(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_card_schedule(uuid, uuid[]) TO service_role;

/** Cards retained across weeks, across the learner's whole library. */
CREATE OR REPLACE FUNCTION public.mature_card_count(p_user_id uuid)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path = public
AS $$
  SELECT count(*) FROM learner_card_schedule(p_user_id, NULL)
  WHERE srs_status = 'review'
    AND interval_days >= 21;
$$;

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

REVOKE EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_goal_knowledge(uuid, timestamptz, numeric) TO authenticated;

COMMIT;
