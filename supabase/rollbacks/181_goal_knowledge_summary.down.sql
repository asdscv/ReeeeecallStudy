-- Rollback for 181. Idempotent: the dry-run applies and reverts repeatedly.
BEGIN;
DROP FUNCTION IF EXISTS public.get_goal_knowledge(uuid, timestamptz, numeric);
COMMIT;
