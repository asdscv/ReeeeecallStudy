-- 232: the 기억 유지 곡선 has been an empty dashed square since it shipped.
--
-- `PersonalAnalyticsPage` calls `learner_card_schedule(p_user_id, p_deck_ids)` straight from the
-- browser. That function is SECURITY INVOKER and deliberately not granted to `authenticated` —
-- migration 186 says so in as many words: "not granted to `authenticated` at all. It is reached
-- only from inside `get_goal_knowledge` (SECURITY DEFINER)". So the call has never succeeded for
-- a signed-in learner. The client destructures `{ data }` and never looks at `error`, so the
-- permission denial arrives as an empty array and the chart draws a grid with nothing in it.
--
-- The answer is not to grant the invoker function to everyone. It takes `p_user_id` as an
-- ARGUMENT, and a function that both trusts its caller's id and is callable by any authenticated
-- user is one where every learner can ask about every other learner. RLS would still filter the
-- rows today, but that is a property of the tables, not of this function, and it is the wrong
-- thing to be relying on.
--
-- So: a DEFINER wrapper that takes no user id and derives it from `auth.uid()`. There is nothing
-- to pass and therefore nothing to forge.
BEGIN;

CREATE OR REPLACE FUNCTION public.my_card_schedule(p_deck_ids uuid[] DEFAULT NULL)
  -- Column-for-column with `learner_card_schedule`, `ease_factor` included. Dropping a column
  -- from the middle of a SELECT * makes a return-type mismatch, not a narrower row.
  RETURNS TABLE (card_id uuid, deck_id uuid, srs_status text, interval_days integer,
                 ease_factor numeric, last_reviewed_at timestamptz, next_review_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.learner_card_schedule(auth.uid(), p_deck_ids)
   WHERE auth.uid() IS NOT NULL;
$$;

COMMENT ON FUNCTION public.my_card_schedule(uuid[]) IS
  'The caller''s own card schedule. A DEFINER wrapper around learner_card_schedule so the '
  'analytics page can read it without the invoker function being granted to every authenticated '
  'user — there is no user id to pass, so there is none to forge.';

REVOKE EXECUTE ON FUNCTION public.my_card_schedule(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_card_schedule(uuid[]) TO authenticated;

COMMIT;
