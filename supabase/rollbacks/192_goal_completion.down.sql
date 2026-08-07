-- Rollback for 192.
--
-- Drops the completion stamp and returns `get_goal_knowledge` to its 191 shape.
-- Safe in that direction: 192 only ADDS keys (`mature`, `rung1`, `rung3`, `rung8`)
-- and never changes what an existing key means, so a client written against 191
-- reads the same numbers either way.
--
-- What it does NOT undo is any goal already stamped. Those rows keep
-- `status = 'completed'` and their `target.completion` record, deliberately: the
-- milestone was earned under the rule that was live at the time, and silently
-- reopening finished goals would be a worse surprise than an unused jsonb key.
DROP FUNCTION IF EXISTS public.complete_goal_if_earned(uuid);

-- Re-apply 191's definition. Kept as an explicit note rather than copied inline:
-- run supabase/migrations/191_goal_knowledge_unseen_means_unseen.sql to restore it.
SELECT 'run migration 191 to restore the previous get_goal_knowledge' AS note;
