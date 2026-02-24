-- Migration 043: Add learning_steps to SRS settings default
-- Adds Anki-style learning steps (minutes) to the deck srs_settings JSONB default.
-- Existing decks without learning_steps will fall back to [1, 10] in the app layer.

-- Update the default value for new decks
ALTER TABLE decks
  ALTER COLUMN srs_settings
  SET DEFAULT '{"again_days": 0, "hard_days": 1, "good_days": 1, "easy_days": 4, "learning_steps": [1, 10]}'::jsonb;
