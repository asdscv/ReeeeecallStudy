-- Add tts_speed column to profiles (default 0.9, range 0.5–2.0)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tts_speed NUMERIC NOT NULL DEFAULT 0.9;

ALTER TABLE profiles
  ADD CONSTRAINT chk_tts_speed CHECK (tts_speed >= 0.5 AND tts_speed <= 2.0);
