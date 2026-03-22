-- ========================================
-- 069: Streak Freeze + Daily Quests + Quest Progress
-- Duolingo-level gamification features
-- ========================================

-- ========================================
-- 1. Streak Freeze columns on study_streaks
-- ========================================

ALTER TABLE study_streaks ADD COLUMN IF NOT EXISTS streak_freezes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE study_streaks ADD COLUMN IF NOT EXISTS freeze_used_at DATE;

-- Ensure max 3 freezes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_streak_freezes_max') THEN
    ALTER TABLE study_streaks ADD CONSTRAINT chk_streak_freezes_max
      CHECK (streak_freezes >= 0 AND streak_freezes <= 3);
  END IF;
END $$;

-- ========================================
-- 2. Rewrite update_study_streak with freeze logic
-- ========================================

CREATE OR REPLACE FUNCTION update_study_streak(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_row study_streaks%ROWTYPE;
  v_new_current INTEGER;
  v_new_longest INTEGER;
  v_freeze_used BOOLEAN := false;
  v_freezes_remaining INTEGER;
  v_new_freezes INTEGER;
BEGIN
  -- Get or create streak row
  INSERT INTO study_streaks (user_id, current_streak, longest_streak, last_study_date, streak_started_at, streak_freezes, freeze_used_at)
  VALUES (p_user_id, 0, 0, NULL, NULL, 0, NULL)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM study_streaks WHERE user_id = p_user_id FOR UPDATE;

  -- Already studied today
  IF v_row.last_study_date = v_today THEN
    RETURN json_build_object(
      'current_streak', v_row.current_streak,
      'longest_streak', v_row.longest_streak,
      'freeze_used', false,
      'freezes_remaining', v_row.streak_freezes,
      'updated', false
    );
  END IF;

  v_new_freezes := v_row.streak_freezes;

  -- Case 1: yesterday → normal increment
  IF v_row.last_study_date = v_today - 1 THEN
    v_new_current := v_row.current_streak + 1;

  -- Case 2: 2 days ago → check freeze
  ELSIF v_row.last_study_date = v_today - 2 THEN
    IF v_row.streak_freezes > 0 THEN
      -- Consume a freeze to protect the streak
      v_new_freezes := v_row.streak_freezes - 1;
      v_freeze_used := true;
      v_new_current := v_row.current_streak + 1;
    ELSE
      -- No freeze available, streak breaks
      v_new_current := 1;
    END IF;

  -- Case 3: gap > 2 days or first study
  ELSE
    v_new_current := 1;
  END IF;

  -- Award 1 streak freeze per 7 consecutive days (max 3)
  IF v_new_current > 0 AND v_new_current % 7 = 0 AND v_new_freezes < 3 THEN
    v_new_freezes := LEAST(v_new_freezes + 1, 3);
  END IF;

  v_new_longest := GREATEST(v_row.longest_streak, v_new_current);
  v_freezes_remaining := v_new_freezes;

  UPDATE study_streaks
  SET current_streak = v_new_current,
      longest_streak = v_new_longest,
      last_study_date = v_today,
      streak_started_at = CASE WHEN v_new_current = 1 THEN v_today ELSE v_row.streak_started_at END,
      streak_freezes = v_new_freezes,
      freeze_used_at = CASE WHEN v_freeze_used THEN v_today ELSE v_row.freeze_used_at END,
      updated_at = now()
  WHERE user_id = p_user_id;

  RETURN json_build_object(
    'current_streak', v_new_current,
    'longest_streak', v_new_longest,
    'freeze_used', v_freeze_used,
    'freezes_remaining', v_freezes_remaining,
    'updated', true
  );
END;
$$;

-- ========================================
-- 3. Daily Quests table
-- ========================================

CREATE TABLE IF NOT EXISTS daily_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_date DATE NOT NULL DEFAULT CURRENT_DATE,
  quest_type TEXT NOT NULL,  -- 'cards', 'sessions', 'time', 'perfect'
  target_value INTEGER NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  xp_reward INTEGER NOT NULL DEFAULT 20,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, quest_date, quest_type)
);

ALTER TABLE daily_quests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own quests" ON daily_quests FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_daily_quests_user_date ON daily_quests(user_id, quest_date);

-- ========================================
-- 4. Generate Daily Quests RPC
-- ========================================

CREATE OR REPLACE FUNCTION generate_daily_quests()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_today DATE := CURRENT_DATE;
  v_quest_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_quest_count FROM daily_quests WHERE user_id = v_uid AND quest_date = v_today;

  IF v_quest_count = 0 THEN
    -- Quest 1: Study X cards (random 10-50)
    INSERT INTO daily_quests (user_id, quest_date, quest_type, target_value, xp_reward)
    VALUES (v_uid, v_today, 'cards', 10 + (random() * 40)::int, 20);

    -- Quest 2: Complete X sessions (1-3)
    INSERT INTO daily_quests (user_id, quest_date, quest_type, target_value, xp_reward)
    VALUES (v_uid, v_today, 'sessions', 1 + (random() * 2)::int, 15);

    -- Quest 3: Study for X minutes (5-30)
    INSERT INTO daily_quests (user_id, quest_date, quest_type, target_value, xp_reward)
    VALUES (v_uid, v_today, 'time', 5 + (random() * 25)::int, 25);
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(json_build_object(
      'id', id, 'quest_type', quest_type, 'target_value', target_value,
      'current_value', current_value, 'xp_reward', xp_reward,
      'completed', completed
    )), '[]'::json)
    FROM daily_quests WHERE user_id = v_uid AND quest_date = v_today
  );
END;
$$;

-- ========================================
-- 5. Update Quest Progress RPC
-- ========================================

CREATE OR REPLACE FUNCTION update_quest_progress(
  p_cards_studied INTEGER DEFAULT 0,
  p_duration_minutes INTEGER DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_today DATE := CURRENT_DATE;
  v_completed TEXT[] := '{}';
  v_total_xp INTEGER := 0;
  v_quest RECORD;
BEGIN
  FOR v_quest IN SELECT * FROM daily_quests WHERE user_id = v_uid AND quest_date = v_today AND NOT completed LOOP
    CASE v_quest.quest_type
      WHEN 'cards' THEN
        UPDATE daily_quests SET current_value = LEAST(current_value + p_cards_studied, target_value) WHERE id = v_quest.id;
      WHEN 'sessions' THEN
        UPDATE daily_quests SET current_value = LEAST(current_value + 1, target_value) WHERE id = v_quest.id;
      WHEN 'time' THEN
        UPDATE daily_quests SET current_value = LEAST(current_value + p_duration_minutes, target_value) WHERE id = v_quest.id;
    END CASE;

    -- Check if now completed
    IF (SELECT current_value >= target_value FROM daily_quests WHERE id = v_quest.id) THEN
      UPDATE daily_quests SET completed = true, completed_at = now() WHERE id = v_quest.id;
      v_completed := array_append(v_completed, v_quest.quest_type);
      v_total_xp := v_total_xp + v_quest.xp_reward;
    END IF;
  END LOOP;

  -- Award XP to profile
  IF v_total_xp > 0 THEN
    UPDATE profiles SET xp = COALESCE(xp, 0) + v_total_xp WHERE id = v_uid;
  END IF;

  RETURN json_build_object('completed_quests', v_completed, 'xp_earned', v_total_xp);
END;
$$;

-- ========================================
-- 6. Get Streak Freeze Info RPC
-- ========================================

CREATE OR REPLACE FUNCTION get_streak_freeze_info()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row study_streaks%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM study_streaks WHERE user_id = v_uid;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'streak_freezes', 0,
      'freeze_used_today', false,
      'current_streak', 0
    );
  END IF;

  RETURN json_build_object(
    'streak_freezes', v_row.streak_freezes,
    'freeze_used_today', (v_row.freeze_used_at = CURRENT_DATE),
    'current_streak', v_row.current_streak
  );
END;
$$;
