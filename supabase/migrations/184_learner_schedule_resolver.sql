-- ============================================================================
-- 184: one answer to "where does THIS learner's schedule live".
--
-- A card's SRS columns belong to whoever OWNS the deck. A learner studying a subscribed or
-- official deck has never written to `cards`; their schedule is a `user_card_progress` row.
-- Read the wrong one and you do not get a missing number, you get SOMEONE ELSE'S number.
--
-- That rule is already written down three times, in three languages of expression:
--
--   packages/shared/lib/srs-access.ts        `getSrsSource` — ownership is the discriminator
--   packages/shared/lib/learning-card-sources.ts  `splitDecksBySrsSource`
--   migration 182                            a CASE expression inside `get_goal_knowledge`
--
-- And it was MISSING from a fourth: `mature_card_count` (183) reads `cards` alone, so every
-- achievement in the app ignores subscribed and official study entirely. Production already has
-- 14,805 progress rows against 433 owned-card rows — the majority of study in this app is on
-- decks the learner does not own, and none of it counts toward mastery.
--
-- Rather than write the rule a fourth time, this migration states it ONCE as a set-returning
-- function and points both counters at it. Adding a third place SRS state can live — a shared
-- household deck, a classroom assignment — becomes one edit here instead of a hunt.
--
-- WHY A FUNCTION AND NOT A VIEW. A view would need `security_invoker` to respect RLS, and both
-- callers are SECURITY DEFINER functions that must see rows RLS would hide from the caller. A
-- STABLE function taking the learner explicitly makes the subject of the query impossible to
-- get wrong, and it composes into an existing CTE without a policy detour.
--
-- Idempotent: CREATE OR REPLACE only, no table touched.
-- ============================================================================

BEGIN;

/**
 * Every card this learner has a schedule for, with the schedule resolved to the right source.
 *
 * Ownership discriminates, exactly as `getSrsSource` documents: a deck the learner owns keeps
 * its schedule on the card; anything else keeps it on the learner's progress row. There is no
 * UNION of both, so a card can never be counted twice.
 *
 * LEFT JOIN, not INNER: a subscribed card the learner has never touched has no progress row, and
 * it must still appear — as unseen. Dropping it would make a fresh subscription look like a
 * completed one, since a total that excludes what you have not started is not a total.
 */
CREATE OR REPLACE FUNCTION public.learner_card_schedule(p_user_id uuid)
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
  -- Their own decks, plus any deck they hold a progress row in. `deck_shares` is deliberately
  -- not consulted: a share the learner has never opened produces no progress row and no study,
  -- and counting it would inflate every total the moment a deck was shared with them.
  WHERE d.user_id = p_user_id OR ucp.user_id = p_user_id;
$$;

-- SECURITY INVOKER (the default) so a direct caller sees only what RLS allows. The two counters
-- below are SECURITY DEFINER and execute as the owner, so they still see everything they need.
REVOKE EXECUTE ON FUNCTION public.learner_card_schedule(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learner_card_schedule(uuid) TO service_role;

/**
 * Cards this learner has retained across weeks — now counting the decks they subscribe to.
 *
 * 21 days mirrors `LEGACY_MATURE_INTERVAL_DAYS` in the criterion catalog, pinned by test.
 */
CREATE OR REPLACE FUNCTION public.mature_card_count(p_user_id uuid)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path = public
AS $$
  SELECT count(*) FROM learner_card_schedule(p_user_id)
  WHERE srs_status = 'review'
    AND interval_days >= 21;
$$;

COMMIT;
