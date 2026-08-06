-- Rollback for 188: drop the delete RPC.
--
-- Net-zero on schema: 188 only ADDS a function and relies on foreign keys that
-- already existed in mig 165. Dropping it restores the prior state exactly.
--
-- It does NOT undo any deletion the function performed — nothing can. Roll this
-- back together with the client, or the 삭제 button starts failing with a
-- function-not-found error instead of being absent.
DROP FUNCTION IF EXISTS public.delete_learning_goal(uuid);
