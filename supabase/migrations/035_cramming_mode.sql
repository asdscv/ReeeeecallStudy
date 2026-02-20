-- 035: Add cramming mode support
-- Adds 'cramming' to study_mode constraints, 'got_it'/'missed'/'next' to rating constraint,
-- and metadata JSONB column to study_sessions for cramming stats.

-- study_logs: add 'cramming' to study_mode CHECK
ALTER TABLE study_logs DROP CONSTRAINT IF EXISTS study_logs_study_mode_check;
ALTER TABLE study_logs ADD CONSTRAINT study_logs_study_mode_check
  CHECK (study_mode IN ('srs', 'sequential_review', 'random', 'sequential', 'by_date', 'cramming'));

-- study_logs: add 'got_it', 'missed', 'next' to rating CHECK
-- 'next' is used by random/sequential/by_date modes
ALTER TABLE study_logs DROP CONSTRAINT IF EXISTS study_logs_rating_check;
ALTER TABLE study_logs ADD CONSTRAINT study_logs_rating_check
  CHECK (rating IN ('again', 'hard', 'good', 'easy', 'known', 'unknown', 'next', 'viewed', 'got_it', 'missed'));

-- profiles: add 'cramming' to default_study_mode CHECK
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_default_study_mode_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_default_study_mode_check
  CHECK (default_study_mode IN ('srs', 'sequential_review', 'random', 'sequential', 'by_date', 'cramming'));

-- study_sessions: add metadata column for cramming stats (rounds, mastery, hardest cards)
ALTER TABLE study_sessions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
