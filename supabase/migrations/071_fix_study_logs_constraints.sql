-- ═══════════════════════════════════════════════════════
-- Migration 071: Fix study_logs CHECK constraints
-- ═══════════════════════════════════════════════════════
-- Problem: study_mode and rating CHECK constraints were not updated
-- to include 'by_date', 'cramming', 'got_it', 'missed', 'next'.
-- This caused ALL study_logs INSERTs to fail silently for ~1 month
-- when using these modes, breaking heatmap + daily study volume.
--
-- Migration 035 defined these constraints but may not have been
-- applied to production. This migration re-applies them idempotently.
-- ═══════════════════════════════════════════════════════

-- Fix study_mode constraint — add 'by_date' and 'cramming'
ALTER TABLE study_logs DROP CONSTRAINT IF EXISTS study_logs_study_mode_check;
ALTER TABLE study_logs ADD CONSTRAINT study_logs_study_mode_check
  CHECK (study_mode IN ('srs', 'sequential_review', 'random', 'sequential', 'by_date', 'cramming'));

-- Fix rating constraint — add 'got_it', 'missed', 'next'
ALTER TABLE study_logs DROP CONSTRAINT IF EXISTS study_logs_rating_check;
ALTER TABLE study_logs ADD CONSTRAINT study_logs_rating_check
  CHECK (rating IN ('again', 'hard', 'good', 'easy', 'known', 'unknown', 'next', 'viewed', 'got_it', 'missed'));

-- Also fix profiles.default_study_mode constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_default_study_mode_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_default_study_mode_check
  CHECK (default_study_mode IN ('srs', 'sequential_review', 'random', 'sequential', 'by_date', 'cramming'));
