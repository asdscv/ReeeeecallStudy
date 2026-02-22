-- 038: Add answer_mode to profiles for DB persistence of button/swipe preference
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS answer_mode TEXT NOT NULL DEFAULT 'button'
  CHECK (answer_mode IN ('button', 'swipe'));
