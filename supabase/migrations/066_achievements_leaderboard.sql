-- ========================================
-- 066: Achievement Badges System & Leaderboard
-- Enterprise-grade gamification layer
-- ========================================

-- ========================================
-- 1. Achievement Definitions (extensible — add new achievements without code changes)
-- ========================================

CREATE TABLE IF NOT EXISTS achievement_definitions (
  id             TEXT PRIMARY KEY,           -- e.g. 'streak_7', 'cards_100', 'first_share'
  category       TEXT NOT NULL CHECK (category IN ('streak', 'study', 'social', 'milestone')),
  icon           TEXT NOT NULL DEFAULT '🏆',
  required_value INTEGER NOT NULL DEFAULT 1,
  xp_reward      INTEGER NOT NULL DEFAULT 10,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ========================================
-- 2. User Achievements (earned badges)
-- ========================================

CREATE TABLE IF NOT EXISTS user_achievements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievement_definitions(id),
  earned_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own achievements"
  ON user_achievements FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement ON user_achievements(achievement_id);

-- ========================================
-- 3. XP & Level columns on profiles
-- ========================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1;

-- Ensure non-negative constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_xp_nonneg') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_profiles_xp_nonneg CHECK (xp >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_level_positive') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_profiles_level_positive CHECK (level >= 1);
  END IF;
END $$;

-- ========================================
-- 4. Seed Achievement Definitions
-- ========================================

INSERT INTO achievement_definitions (id, category, icon, required_value, xp_reward, sort_order) VALUES
  -- Streak achievements
  ('streak_3',          'streak',    '🔥', 3,    10,   1),
  ('streak_7',          'streak',    '🔥', 7,    25,   2),
  ('streak_14',         'streak',    '🔥', 14,   50,   3),
  ('streak_30',         'streak',    '🔥', 30,   100,  4),
  ('streak_100',        'streak',    '💎', 100,  500,  5),
  -- Cards studied achievements
  ('cards_10',          'study',     '📚', 10,   5,    10),
  ('cards_50',          'study',     '📚', 50,   15,   11),
  ('cards_100',         'study',     '📚', 100,  30,   12),
  ('cards_500',         'study',     '📚', 500,  75,   13),
  ('cards_1000',        'study',     '🎓', 1000, 150,  14),
  ('cards_5000',        'study',     '🎓', 5000, 500,  15),
  -- Session count achievements
  ('sessions_10',       'study',     '⚡', 10,   20,   20),
  ('sessions_50',       'study',     '⚡', 50,   50,   21),
  ('sessions_100',      'study',     '⚡', 100,  100,  22),
  -- Milestone achievements
  ('first_deck',        'milestone', '📦', 1,    10,   30),
  ('decks_5',           'milestone', '📦', 5,    25,   31),
  ('decks_10',          'milestone', '📦', 10,   50,   32),
  -- Social achievements
  ('first_share',       'social',    '🤝', 1,    20,   40),
  ('first_review',      'social',    '⭐', 1,    15,   41),
  ('market_acquire_5',  'social',    '🛒', 5,    30,   42)
ON CONFLICT (id) DO NOTHING;

-- ========================================
-- 5. RPC: Check and Award Achievements
-- ========================================

CREATE OR REPLACE FUNCTION check_achievements(p_user_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_new_achievements TEXT[] := '{}';
  v_total_xp INTEGER := 0;
  v_stats RECORD;
  v_def RECORD;
BEGIN
  -- Abort if no valid user
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'no authenticated user');
  END IF;

  -- Gather user stats in one pass
  SELECT
    COALESCE((SELECT current_streak FROM study_streaks WHERE user_id = v_uid), 0) AS streak,
    COALESCE((SELECT SUM(cards_studied) FROM study_sessions WHERE user_id = v_uid), 0) AS total_cards,
    (SELECT COUNT(*) FROM study_sessions WHERE user_id = v_uid) AS total_sessions,
    (SELECT COUNT(*) FROM decks WHERE user_id = v_uid) AS total_decks,
    (SELECT COUNT(*) FROM marketplace_listings WHERE owner_id = v_uid) AS total_shares,
    (SELECT COUNT(*) FROM marketplace_reviews WHERE user_id = v_uid) AS total_reviews,
    (
      SELECT COUNT(DISTINCT ml.id)
      FROM marketplace_listings ml
      JOIN decks d ON d.id = ml.deck_id
      WHERE d.user_id != v_uid
        AND EXISTS (
          SELECT 1 FROM decks d2
          WHERE d2.source_deck_id = ml.deck_id
            AND d2.user_id = v_uid
        )
    ) AS total_acquires
  INTO v_stats;

  -- Check each definition against gathered stats
  FOR v_def IN SELECT * FROM achievement_definitions ORDER BY sort_order LOOP
    -- Skip if already earned
    IF EXISTS (
      SELECT 1 FROM user_achievements
      WHERE user_id = v_uid AND achievement_id = v_def.id
    ) THEN
      CONTINUE;
    END IF;

    -- Evaluate condition based on achievement id/category
    IF (v_def.category = 'streak' AND v_stats.streak >= v_def.required_value)
    OR (v_def.id LIKE 'cards_%' AND v_stats.total_cards >= v_def.required_value)
    OR (v_def.id LIKE 'sessions_%' AND v_stats.total_sessions >= v_def.required_value)
    OR (v_def.id = 'first_deck' AND v_stats.total_decks >= v_def.required_value)
    OR (v_def.id LIKE 'decks_%' AND v_stats.total_decks >= v_def.required_value)
    OR (v_def.id = 'first_share' AND v_stats.total_shares >= v_def.required_value)
    OR (v_def.id = 'first_review' AND v_stats.total_reviews >= v_def.required_value)
    OR (v_def.id LIKE 'market_acquire_%' AND v_stats.total_acquires >= v_def.required_value)
    THEN
      INSERT INTO user_achievements (user_id, achievement_id)
      VALUES (v_uid, v_def.id);

      v_new_achievements := array_append(v_new_achievements, v_def.id);
      v_total_xp := v_total_xp + v_def.xp_reward;
    END IF;
  END LOOP;

  -- Award XP and recalculate level (sqrt-based curve: level = floor(sqrt(xp/50)) + 1)
  IF v_total_xp > 0 THEN
    UPDATE profiles
    SET xp    = xp + v_total_xp,
        level = GREATEST(1, FLOOR(SQRT((xp + v_total_xp) / 50.0))::INTEGER + 1)
    WHERE id = v_uid;
  END IF;

  RETURN json_build_object(
    'new_achievements', v_new_achievements,
    'xp_earned', v_total_xp,
    'total_checked', (SELECT COUNT(*) FROM achievement_definitions)
  );
END;
$$;

-- ========================================
-- 6. RPC: Get User Achievements (full badge list with earned status)
-- ========================================

CREATE OR REPLACE FUNCTION get_user_achievements(p_user_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'no authenticated user');
  END IF;

  RETURN json_build_object(
    'xp', (SELECT COALESCE(xp, 0) FROM profiles WHERE id = v_uid),
    'level', (SELECT COALESCE(level, 1) FROM profiles WHERE id = v_uid),
    'achievements', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',             ad.id,
        'category',       ad.category,
        'icon',           ad.icon,
        'required_value', ad.required_value,
        'xp_reward',      ad.xp_reward,
        'earned',         ua.earned_at IS NOT NULL,
        'earned_at',      ua.earned_at
      ) ORDER BY ad.sort_order), '[]'::json)
      FROM achievement_definitions ad
      LEFT JOIN user_achievements ua
        ON ua.achievement_id = ad.id AND ua.user_id = v_uid
    )
  );
END;
$$;

-- ========================================
-- 7. RPC: Leaderboard (weekly / monthly / all-time)
-- ========================================

CREATE OR REPLACE FUNCTION get_leaderboard(
  p_period TEXT DEFAULT 'weekly',
  p_limit  INTEGER DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ;
BEGIN
  -- Determine time window
  v_since := CASE p_period
    WHEN 'weekly'  THEN now() - interval '7 days'
    WHEN 'monthly' THEN now() - interval '30 days'
    ELSE '1970-01-01'::timestamptz  -- all-time
  END;

  RETURN json_build_object(
    'period', p_period,
    'entries', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT
          p.id AS user_id,
          p.display_name,
          p.level,
          p.xp,
          COALESCE(SUM(ss.cards_studied), 0)::INTEGER AS cards_studied,
          COUNT(ss.id)::INTEGER AS sessions,
          ROW_NUMBER() OVER (
            ORDER BY COALESCE(SUM(ss.cards_studied), 0) DESC
          ) AS rank
        FROM profiles p
        LEFT JOIN study_sessions ss
          ON ss.user_id = p.id
          AND ss.completed_at >= v_since
        WHERE p.user_status = 'active'
        GROUP BY p.id, p.display_name, p.level, p.xp
        ORDER BY cards_studied DESC
        LIMIT LEAST(p_limit, 100)
      ) t
    )
  );
END;
$$;

-- ========================================
-- 8. Grant execute permissions
-- ========================================

GRANT EXECUTE ON FUNCTION check_achievements(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_achievements(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_leaderboard(TEXT, INTEGER) TO authenticated;
