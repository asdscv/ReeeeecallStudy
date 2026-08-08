-- Rollback for 200 (the easy band built from deck-mates).
--
-- Function only; no tables, no columns, no data. Questions already built this way stay — they
-- are ordinary rows in `quiz_questions` and nothing about them depends on the builder existing.
--
-- What reverting costs: bands with `near_max = 0` go back to asking a model for deliberately
-- unrelated wrong answers, which it will not write. That is not a degraded easy band, it is
-- an easy band that produces nothing — observed across three deploys of prompt tuning.

BEGIN;
DROP FUNCTION IF EXISTS public.build_deck_mate_quiz(uuid);
COMMIT;
