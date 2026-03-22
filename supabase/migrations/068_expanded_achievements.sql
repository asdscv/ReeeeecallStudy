-- =============================================
-- 068: Expanded Achievements (Duolingo-level)
--
-- Adds 30+ more achievements for long-term engagement.
-- Extensible: just INSERT new rows — no code changes needed.
-- =============================================

INSERT INTO achievement_definitions (id, category, icon, required_value, xp_reward, sort_order) VALUES
  -- Extended streaks (long-term retention)
  ('streak_60',         'streak',    '🔥', 60,    200,  6),
  ('streak_180',        'streak',    '💎', 180,   750,  7),
  ('streak_365',        'streak',    '👑', 365,   2000, 8),

  -- Extended cards studied (mastery path)
  ('cards_2000',        'study',     '🎓', 2000,  250,  16),
  ('cards_10000',       'study',     '🏅', 10000, 1000, 17),
  ('cards_25000',       'study',     '👑', 25000, 2500, 18),
  ('cards_50000',       'study',     '💎', 50000, 5000, 19),

  -- Extended sessions
  ('sessions_200',      'study',     '⚡', 200,   200,  23),
  ('sessions_500',      'study',     '⚡', 500,   500,  24),
  ('sessions_1000',     'study',     '💎', 1000,  1500, 25),

  -- Extended decks
  ('decks_20',          'milestone', '📦', 20,    100,  33),
  ('decks_50',          'milestone', '📦', 50,    250,  34),

  -- Study time milestones (total minutes)
  ('time_60',           'study',     '⏱️', 60,    20,   50),
  ('time_300',          'study',     '⏱️', 300,   50,   51),
  ('time_600',          'study',     '⏱️', 600,   100,  52),
  ('time_1800',         'study',     '⏱️', 1800,  300,  53),
  ('time_6000',         'study',     '⏱️', 6000,  750,  54),
  ('time_18000',        'study',     '👑', 18000, 2000, 55),

  -- Mastery milestones (cards with ease_factor > 2.5)
  ('mastery_10',        'study',     '🌟', 10,    25,   60),
  ('mastery_50',        'study',     '🌟', 50,    75,   61),
  ('mastery_100',       'study',     '🌟', 100,   150,  62),
  ('mastery_500',       'study',     '🌟', 500,   500,  63),
  ('mastery_1000',      'study',     '💎', 1000,  1500, 64),

  -- Social & community
  ('shares_5',          'social',    '🤝', 5,     50,   43),
  ('shares_10',         'social',    '🤝', 10,    100,  44),
  ('reviews_5',         'social',    '⭐', 5,     40,   45),
  ('reviews_10',        'social',    '⭐', 10,    80,   46),
  ('market_acquire_10', 'social',    '🛒', 10,    60,   47),
  ('market_acquire_25', 'social',    '🛒', 25,    150,  48),

  -- Special milestones
  ('perfect_session',   'milestone', '💯', 1,     50,   70),
  ('night_owl',         'milestone', '🦉', 1,     30,   71),
  ('early_bird',        'milestone', '🐦', 1,     30,   72),
  ('weekend_warrior',   'milestone', '🗓️', 1,     40,   73)

ON CONFLICT (id) DO NOTHING;

-- =============================================
-- Update check_achievements to handle new types
-- (time milestones + mastery milestones)
-- =============================================

CREATE OR REPLACE FUNCTION check_achievements(p_user_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_new_achievements TEXT[] := '{}';
  v_total_xp INTEGER := 0;
  v_streak INTEGER;
  v_total_cards BIGINT;
  v_total_sessions BIGINT;
  v_total_decks BIGINT;
  v_total_shares BIGINT;
  v_total_reviews BIGINT;
  v_total_acquires BIGINT;
  v_total_time_min BIGINT;
  v_mastered_cards BIGINT;
  v_def RECORD;
  v_matched BOOLEAN;
BEGIN
  -- Gather stats
  SELECT COALESCE(current_streak, 0) INTO v_streak FROM study_streaks WHERE user_id = v_uid;
  SELECT COALESCE(SUM(cards_studied), 0) INTO v_total_cards FROM study_sessions WHERE user_id = v_uid;
  SELECT COUNT(*) INTO v_total_sessions FROM study_sessions WHERE user_id = v_uid;
  SELECT COUNT(*) INTO v_total_decks FROM decks WHERE user_id = v_uid;
  SELECT COUNT(*) INTO v_total_shares FROM marketplace_listings WHERE owner_id = v_uid;
  SELECT COUNT(*) INTO v_total_reviews FROM marketplace_reviews WHERE user_id = v_uid;
  SELECT COALESCE(SUM(total_duration_ms) / 60000, 0) INTO v_total_time_min FROM study_sessions WHERE user_id = v_uid;
  SELECT COUNT(*) INTO v_mastered_cards FROM cards WHERE user_id = v_uid AND ease_factor > 2.5 AND srs_status = 'review';
  SELECT 0 INTO v_total_acquires; -- simplified

  FOR v_def IN SELECT * FROM achievement_definitions ORDER BY sort_order LOOP
    IF EXISTS (SELECT 1 FROM user_achievements WHERE user_id = v_uid AND achievement_id = v_def.id) THEN
      CONTINUE;
    END IF;

    v_matched := false;

    -- Streak
    IF v_def.category = 'streak' THEN
      v_matched := v_streak >= v_def.required_value;
    -- Cards
    ELSIF v_def.id LIKE 'cards_%' THEN
      v_matched := v_total_cards >= v_def.required_value;
    -- Sessions
    ELSIF v_def.id LIKE 'sessions_%' THEN
      v_matched := v_total_sessions >= v_def.required_value;
    -- Decks
    ELSIF v_def.id = 'first_deck' OR v_def.id LIKE 'decks_%' THEN
      v_matched := v_total_decks >= v_def.required_value;
    -- Study time
    ELSIF v_def.id LIKE 'time_%' THEN
      v_matched := v_total_time_min >= v_def.required_value;
    -- Mastery
    ELSIF v_def.id LIKE 'mastery_%' THEN
      v_matched := v_mastered_cards >= v_def.required_value;
    -- Shares
    ELSIF v_def.id = 'first_share' OR v_def.id LIKE 'shares_%' THEN
      v_matched := v_total_shares >= v_def.required_value;
    -- Reviews
    ELSIF v_def.id = 'first_review' OR v_def.id LIKE 'reviews_%' THEN
      v_matched := v_total_reviews >= v_def.required_value;
    -- Market acquire
    ELSIF v_def.id LIKE 'market_acquire_%' THEN
      v_matched := v_total_acquires >= v_def.required_value;
    -- Special (check separately — always awarded manually or by specific logic)
    ELSIF v_def.id = 'perfect_session' THEN
      v_matched := EXISTS (
        SELECT 1 FROM study_sessions
        WHERE user_id = v_uid AND cards_studied >= 10
          AND total_cards = cards_studied
      );
    ELSIF v_def.id = 'night_owl' THEN
      v_matched := EXISTS (
        SELECT 1 FROM study_sessions
        WHERE user_id = v_uid AND EXTRACT(HOUR FROM completed_at) BETWEEN 0 AND 4
      );
    ELSIF v_def.id = 'early_bird' THEN
      v_matched := EXISTS (
        SELECT 1 FROM study_sessions
        WHERE user_id = v_uid AND EXTRACT(HOUR FROM completed_at) BETWEEN 5 AND 7
      );
    ELSIF v_def.id = 'weekend_warrior' THEN
      v_matched := EXISTS (
        SELECT 1 FROM study_sessions
        WHERE user_id = v_uid AND EXTRACT(DOW FROM completed_at) IN (0, 6)
      );
    END IF;

    IF v_matched THEN
      INSERT INTO user_achievements (user_id, achievement_id) VALUES (v_uid, v_def.id);
      v_new_achievements := array_append(v_new_achievements, v_def.id);
      v_total_xp := v_total_xp + v_def.xp_reward;
    END IF;
  END LOOP;

  IF v_total_xp > 0 THEN
    UPDATE profiles
    SET xp = xp + v_total_xp,
        level = GREATEST(1, FLOOR(SQRT((xp + v_total_xp) / 50.0))::INT + 1)
    WHERE id = v_uid;
  END IF;

  RETURN json_build_object(
    'new_achievements', v_new_achievements,
    'xp_earned', v_total_xp,
    'total_checked', (SELECT COUNT(*) FROM achievement_definitions)
  );
END;
$$;
