-- Rollback 179 — drop the public plan-limits read path.
--
-- Non-destructive: 179 created a function and nothing else. No table, column or
-- row was added, so reverting loses no data. Any client still calling this after
-- a revert gets PGRST202 (function not found) and must fall back to its own
-- constants, which is what it did before 179 existed.
--
-- Idempotent: IF EXISTS, so a second revert pass is a no-op.

BEGIN;

DROP FUNCTION IF EXISTS public.get_plan_limits();

COMMIT;
