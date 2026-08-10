-- Rollback 205. Re-apply 198 afterwards to restore `submit_quiz_answer` without the
-- free exact-match branch:
--   psql ... -f supabase/rollbacks/205_daily_check.down.sql
--   psql ... -f supabase/migrations/198_quiz_difficulty_open_ended.sql
BEGIN;
DROP FUNCTION IF EXISTS public.build_daily_check(uuid, text, integer);
DROP FUNCTION IF EXISTS public.count_daily_check_cards(text);
DROP FUNCTION IF EXISTS public._quiz_answer_for_cards(uuid, uuid[]);
DROP INDEX IF EXISTS public.quiz_sets_goal_created_idx;
ALTER TABLE public.quiz_sets DROP COLUMN IF EXISTS goal_id;
-- `_normalize_answer` is left in place: dropping it would break `submit_quiz_answer`
-- until 198 is re-applied, and it is inert on its own.
COMMIT;
