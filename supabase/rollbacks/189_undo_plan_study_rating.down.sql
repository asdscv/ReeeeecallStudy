-- Rollback for 189: drop the plan-aware undo.
--
-- Net-zero: 189 only ADDS a function. Rolling it back restores the prior state
-- exactly — and with it the split it fixed, so it must be rolled back together
-- with 187 and the client, never on its own.
DROP FUNCTION IF EXISTS public.undo_plan_study_rating(uuid, uuid);
