-- ============================================================================
-- 190: restore study_logs.prev_srs_status — every SRS rating in production was
--      failing on it
--
-- ── What was happening ──────────────────────────────────────────────────────
--
-- `apply_study_rating` (mig 160) inserts `prev_srs_status` into `study_logs`. In
-- production that column did not exist, so EVERY rating raised
--
--     42703  column "prev_srs_status" of relation "study_logs" does not exist
--
-- and the whole transaction rolled back. Not the log row — the whole rating. The
-- card was never rescheduled, no `study_rating_events` row was written, and the
-- client surfaced it as a persistence error it deliberately does not retry.
--
-- The damage was invisible from the outside and total from the inside:
--
--     study_rating_events   0 rows
--     study_logs            last row 2026-03-29
--     study_sessions        last row 2026-07-27
--
-- Found on 2026-08-06 while verifying the plan-study release against production:
-- `apply_plan_study_rating` calls `apply_study_rating`, so it inherited the
-- failure and reported it out loud where the deck path had been quietly eating it.
--
-- ── Why the column was missing ──────────────────────────────────────────────
--
-- `046_srs_fixes.sql` adds it, and 046 IS recorded in
-- `supabase_migrations.schema_migrations` on production. So the row says applied
-- while the column is absent — the signature of a restore, a manual repair, or a
-- migration recorded without running. Nothing in the repo drops it: `grep` finds
-- no `DROP COLUMN prev_srs_status` and only `001_initial_schema.sql` creates the
-- table.
--
-- This migration therefore does not assume anything about how it went missing. It
-- re-asserts the column idempotently, which is a no-op on any database where 046
-- really did run, and repairs any that it did not.
-- ============================================================================

ALTER TABLE public.study_logs
  ADD COLUMN IF NOT EXISTS prev_srs_status text;

COMMENT ON COLUMN public.study_logs.prev_srs_status IS
  'SRS status BEFORE this rating. Written by apply_study_rating and read by the daily new-card count. Re-asserted by mig 190 after production was found without it, with every rating failing 42703.';
