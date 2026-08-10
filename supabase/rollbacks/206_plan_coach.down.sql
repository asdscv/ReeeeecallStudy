-- Rollback 206. Re-apply 174 afterwards to restore `set_study_recommendations` without the
-- lever relaxation:
--   psql ... -f supabase/rollbacks/206_plan_coach.down.sql
--   psql ... -f supabase/migrations/174_study_recommendation_writers.sql
BEGIN;
DROP FUNCTION IF EXISTS public.get_plan_digest(uuid, text, integer);
DROP FUNCTION IF EXISTS public.get_learning_plan_levers();
-- Plan-level rows would fail 174's "must reference a card" rule on the next write; remove
-- them rather than leave rows no producer can regenerate.
DELETE FROM public.study_recommendations WHERE card_id IS NULL AND concept_id IS NULL AND activity_id IS NULL;
DROP TABLE IF EXISTS public.learning_plan_levers;
COMMIT;
