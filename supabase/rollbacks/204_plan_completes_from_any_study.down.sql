-- Rollback 204: put `apply_study_rating` back to the 10-argument form that never
-- touched the plan, and restore `apply_plan_study_rating`'s 187 call shape.
--
-- Re-apply migrations 162 (apply_study_rating) and 187 (apply_plan_study_rating) in
-- that order, then drop what 204 added:
--
--   psql ... -f supabase/migrations/162_study_session_refresh.sql
--   psql ... -f supabase/migrations/187_plan_study_rating.sql
--   psql ... -f supabase/rollbacks/204_plan_completes_from_any_study.down.sql
BEGIN;
DROP FUNCTION IF EXISTS public.apply_study_rating(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer, boolean);
DROP FUNCTION IF EXISTS public._apply_study_rating_core(
  uuid, uuid, uuid, uuid, text, text, text, bigint, jsonb, integer);
DROP FUNCTION IF EXISTS public._pending_plan_item_for_card(uuid, uuid);
COMMIT;
