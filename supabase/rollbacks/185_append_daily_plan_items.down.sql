-- Rollback for 185. Drops the append RPC.
--
-- A plain DROP is safe here: 185 adds a new function and alters nothing. Rows already
-- appended stay exactly as they are — they are ordinary `daily_plan_items` with correct
-- positions, and `total_items` was kept in step, so the plan reads the same afterwards.
--
-- What breaks is the client's "더 하기" button, which will surface a 404 from PostgREST.
-- That is the intended failure: a rolled-back function should be visibly gone rather than
-- silently degraded.
BEGIN;

DROP FUNCTION IF EXISTS public.append_daily_plan_items(uuid, date, jsonb);

COMMIT;
