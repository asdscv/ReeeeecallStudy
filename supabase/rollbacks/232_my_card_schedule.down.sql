-- Rollback 232: the retention curve goes back to an empty dashed square.
--
-- Drops the wrapper. `learner_card_schedule` stays revoked from `authenticated`, so the analytics
-- page's call fails silently again and the chart draws a grid with no line in it.
DROP FUNCTION IF EXISTS public.my_card_schedule(uuid[]);
