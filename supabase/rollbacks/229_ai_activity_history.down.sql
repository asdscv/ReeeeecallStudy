-- Rollback 229: 기록 goes back to card study only.
--
-- Drops `get_ai_activity`. Quiz sittings and generation jobs are still recorded; they simply stop
-- being readable from the history screen, which is the state where a learner's whole afternoon of
-- AI work shows as an empty day.
DROP FUNCTION IF EXISTS public.get_ai_activity(integer, timestamptz);
