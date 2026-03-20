-- ========================================
-- 064: Daily Goals, Study Streaks, Marketplace Difficulty
-- ========================================

-- ========================================
-- 1. Daily Study Goal (profiles)
-- ========================================

-- Add daily_study_goal to profiles (minutes per day, null = no goal)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_study_goal INTEGER DEFAULT NULL;

-- CHECK: must be positive if set
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_daily_study_goal_positive') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_daily_study_goal_positive
      CHECK (daily_study_goal IS NULL OR daily_study_goal > 0);
  END IF;
END $$;

-- ========================================
-- 2. Study Streaks Table
-- ========================================

-- study_streaks table: tracks consecutive study days per user
CREATE TABLE IF NOT EXISTS study_streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_study_date DATE,
  streak_started_at DATE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE study_streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own streaks" ON study_streaks FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_streaks_user ON study_streaks(user_id);

-- ========================================
-- 3. Update Streak RPC
-- ========================================

-- Called after each study session completes
CREATE OR REPLACE FUNCTION update_study_streak(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_row study_streaks%ROWTYPE;
  v_new_current INTEGER;
  v_new_longest INTEGER;
BEGIN
  -- Get or create streak row
  INSERT INTO study_streaks (user_id, current_streak, longest_streak, last_study_date, streak_started_at)
  VALUES (p_user_id, 0, 0, NULL, NULL)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM study_streaks WHERE user_id = p_user_id FOR UPDATE;

  -- Already studied today
  IF v_row.last_study_date = v_today THEN
    RETURN json_build_object('current_streak', v_row.current_streak, 'longest_streak', v_row.longest_streak, 'updated', false);
  END IF;

  -- Consecutive day
  IF v_row.last_study_date = v_today - 1 THEN
    v_new_current := v_row.current_streak + 1;
  ELSE
    -- Streak broken or first study
    v_new_current := 1;
  END IF;

  v_new_longest := GREATEST(v_row.longest_streak, v_new_current);

  UPDATE study_streaks
  SET current_streak = v_new_current,
      longest_streak = v_new_longest,
      last_study_date = v_today,
      streak_started_at = CASE WHEN v_new_current = 1 THEN v_today ELSE v_row.streak_started_at END,
      updated_at = now()
  WHERE user_id = p_user_id;

  RETURN json_build_object('current_streak', v_new_current, 'longest_streak', v_new_longest, 'updated', true);
END;
$$;

-- ========================================
-- 4. Get User Study Stats RPC
-- ========================================

CREATE OR REPLACE FUNCTION get_user_study_stats(p_user_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'total_sessions', (SELECT COUNT(*) FROM study_sessions WHERE user_id = v_uid),
    'total_cards_studied', (SELECT COALESCE(SUM(cards_studied), 0) FROM study_sessions WHERE user_id = v_uid),
    'total_study_time_ms', (SELECT COALESCE(SUM(total_duration_ms), 0) FROM study_sessions WHERE user_id = v_uid),
    'total_decks', (SELECT COUNT(*) FROM decks WHERE user_id = v_uid),
    'total_cards', (SELECT COUNT(*) FROM cards WHERE user_id = v_uid),
    'streak', (SELECT json_build_object(
      'current', COALESCE(current_streak, 0),
      'longest', COALESCE(longest_streak, 0),
      'last_study_date', last_study_date
    ) FROM study_streaks WHERE user_id = v_uid),
    'daily_goal', (SELECT daily_study_goal FROM profiles WHERE id = v_uid),
    'sessions_by_mode', (
      SELECT COALESCE(json_agg(json_build_object('mode', study_mode, 'count', cnt, 'total_cards', total_cards)), '[]')
      FROM (
        SELECT study_mode, COUNT(*) as cnt, SUM(cards_studied) as total_cards
        FROM study_sessions WHERE user_id = v_uid
        GROUP BY study_mode
      ) t
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ========================================
-- 5. Marketplace Difficulty Level
-- ========================================

-- Add difficulty_level to marketplace_listings
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS difficulty_level TEXT DEFAULT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ml_difficulty') THEN
    ALTER TABLE marketplace_listings ADD CONSTRAINT chk_ml_difficulty
      CHECK (difficulty_level IS NULL OR difficulty_level IN ('beginner', 'intermediate', 'advanced', 'expert'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ml_difficulty ON marketplace_listings(difficulty_level) WHERE difficulty_level IS NOT NULL;
