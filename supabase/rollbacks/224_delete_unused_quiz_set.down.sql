-- Rollback 224: the dead rows come back and stay.
--
-- Drops `delete_quiz_set`. A generation that produces nothing leaves a set nobody can take and
-- nobody can clear, which is the state 17 of production's 49 sets were in.
DROP FUNCTION IF EXISTS public.delete_quiz_set(uuid);
