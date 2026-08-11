-- Rollback 208. Re-apply 203 afterwards to restore get_quiz_run_items without the target:
--   psql ... -f supabase/rollbacks/208_quiz_progressive_run.down.sql
--   psql ... -f supabase/migrations/203_quiz_flaws_alignment_and_band1.sql
BEGIN;
DROP FUNCTION IF EXISTS public.append_quiz_run_items(uuid);
COMMIT;
