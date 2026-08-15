-- Rollback 225: the quiz list goes back to saying nothing.
--
-- Drops the two reads and the shared tally. The client falls back to selecting `quiz_sets`
-- directly, which is the state where a learner cannot tell a set made yesterday from one made in
-- March, or one sat three times from one never opened.
DROP FUNCTION IF EXISTS public.get_quiz_set_history(uuid);
DROP FUNCTION IF EXISTS public.list_quiz_sets(integer);
DROP FUNCTION IF EXISTS public._quiz_run_tally(uuid);
