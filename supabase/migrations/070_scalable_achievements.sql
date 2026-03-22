-- =============================================
-- 070: Scalable Achievement Engine
--
-- Replaces hardcoded badge checking with a
-- rule-based engine that auto-generates milestones.
--
-- No more manual INSERT for new badges.
-- The engine calculates next milestones dynamically.
-- =============================================

-- ─── Milestone progression sequences ───────────────
-- Each category has a progression curve:
--   Early: tight gaps (motivation boost)
--   Mid:   moderate gaps
--   Late:  wider gaps (but never boring — special titles)

CREATE OR REPLACE FUNCTION get_next_milestone(
  p_category TEXT,
  p_current_value BIGINT
)
RETURNS TABLE(milestone_value BIGINT, milestone_icon TEXT, milestone_xp INTEGER)
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_milestones BIGINT[];
  v_icons TEXT[];
  v_base_xp INTEGER;
BEGIN
  CASE p_category
    -- Streak: 3,7,14,30,60,100,180,365 then every 365
    WHEN 'streak' THEN
      v_milestones := ARRAY[3,7,14,30,60,100,180,365,730,1095,1460,1825,2190,2555,2920,3285,3650];
      v_icons := ARRAY['🔥','🔥','🔥','🔥','🔥','💎','💎','👑','👑','👑','🏆','🏆','🏆','🏆','🏆','🏆','🏆'];
      v_base_xp := 10;

    -- Cards studied: 10,50,100,500,1k,2k,5k,10k,25k,50k,100k then every 50k
    WHEN 'cards' THEN
      v_milestones := ARRAY[10,50,100,500,1000,2000,5000,10000,25000,50000,100000,150000,200000,300000,500000];
      v_icons := ARRAY['📚','📚','📚','📚','🎓','🎓','🎓','🏅','🏅','💎','👑','👑','👑','🏆','🏆'];
      v_base_xp := 5;

    -- Sessions: 1,10,50,100,200,500,1000,2000,5000 then every 2500
    WHEN 'sessions' THEN
      v_milestones := ARRAY[1,10,50,100,200,500,1000,2000,5000,7500,10000];
      v_icons := ARRAY['⚡','⚡','⚡','⚡','⚡','💎','💎','👑','👑','🏆','🏆'];
      v_base_xp := 10;

    -- Study time (minutes): 60,300,600,1800,6000,18000,36000,72000 then every 36000
    WHEN 'time' THEN
      v_milestones := ARRAY[60,300,600,1800,6000,18000,36000,72000,108000];
      v_icons := ARRAY['⏱️','⏱️','⏱️','⏱️','⏱️','💎','👑','👑','🏆'];
      v_base_xp := 15;

    -- Mastery (cards with ease>2.5): 10,50,100,500,1000,5000,10000 then every 5000
    WHEN 'mastery' THEN
      v_milestones := ARRAY[10,50,100,500,1000,5000,10000,15000,20000];
      v_icons := ARRAY['🌟','🌟','🌟','🌟','💎','💎','👑','👑','🏆'];
      v_base_xp := 20;

    -- Decks: 1,5,10,20,50 then every 25
    WHEN 'decks' THEN
      v_milestones := ARRAY[1,5,10,20,50,75,100];
      v_icons := ARRAY['📦','📦','📦','📦','💎','💎','👑'];
      v_base_xp := 10;

    -- Shares: 1,5,10,25,50 then every 25
    WHEN 'shares' THEN
      v_milestones := ARRAY[1,5,10,25,50,75,100];
      v_icons := ARRAY['🤝','🤝','🤝','🤝','💎','💎','👑'];
      v_base_xp := 15;

    ELSE
      RETURN;
  END CASE;

  -- Find next milestone above current value
  FOR i IN 1..array_length(v_milestones, 1) LOOP
    IF v_milestones[i] > p_current_value THEN
      milestone_value := v_milestones[i];
      milestone_icon := v_icons[i];
      -- XP scales with milestone size: base * log2(milestone)
      milestone_xp := v_base_xp * GREATEST(1, FLOOR(LOG(2, v_milestones[i]))::INT);
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;

  -- Beyond predefined list: auto-generate next milestone
  -- Use the last interval to keep going
  DECLARE
    v_last_val BIGINT := v_milestones[array_length(v_milestones, 1)];
    v_second_last BIGINT := v_milestones[array_length(v_milestones, 1) - 1];
    v_interval BIGINT := v_last_val - v_second_last;
    v_next BIGINT;
  BEGIN
    v_next := v_last_val + v_interval;
    WHILE v_next <= p_current_value LOOP
      v_next := v_next + v_interval;
    END LOOP;
    milestone_value := v_next;
    milestone_icon := '🏆';
    milestone_xp := v_base_xp * GREATEST(1, FLOOR(LOG(2, v_next))::INT);
    RETURN NEXT;
  END;
END;
$$;

-- ─── Rewrite check_achievements as rule engine ─────

CREATE OR REPLACE FUNCTION check_achievements(p_user_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_new_achievements TEXT[] := '{}';
  v_total_xp INTEGER := 0;
  v_stats RECORD;
  v_cat RECORD;
  v_next RECORD;
  v_achievement_id TEXT;
BEGIN
  -- Gather all stats at once
  SELECT
    COALESCE((SELECT current_streak FROM study_streaks WHERE user_id = v_uid), 0) as streak,
    COALESCE((SELECT SUM(cards_studied) FROM study_sessions WHERE user_id = v_uid), 0) as total_cards,
    (SELECT COUNT(*) FROM study_sessions WHERE user_id = v_uid) as total_sessions,
    COALESCE((SELECT SUM(total_duration_ms)/60000 FROM study_sessions WHERE user_id = v_uid), 0) as total_time_min,
    (SELECT COUNT(*) FROM cards WHERE user_id = v_uid AND ease_factor > 2.5 AND srs_status = 'review') as mastered_cards,
    (SELECT COUNT(*) FROM decks WHERE user_id = v_uid) as total_decks,
    (SELECT COUNT(*) FROM marketplace_listings WHERE owner_id = v_uid) as total_shares
  INTO v_stats;

  -- Check each category
  FOR v_cat IN
    SELECT * FROM (VALUES
      ('streak', v_stats.streak),
      ('cards', v_stats.total_cards),
      ('sessions', v_stats.total_sessions),
      ('time', v_stats.total_time_min),
      ('mastery', v_stats.mastered_cards),
      ('decks', v_stats.total_decks),
      ('shares', v_stats.total_shares)
    ) AS t(category, current_value)
  LOOP
    -- Check ALL milestones up to current value (not just next one)
    FOR v_next IN SELECT * FROM get_next_milestone(v_cat.category, 0) LOOP
      -- Nothing to do — this gives us the first milestone
    END LOOP;

    -- Actually check every milestone the user has passed
    DECLARE
      v_check_val BIGINT := 0;
    BEGIN
      LOOP
        SELECT * INTO v_next FROM get_next_milestone(v_cat.category, v_check_val);
        EXIT WHEN v_next IS NULL OR v_next.milestone_value IS NULL;
        EXIT WHEN v_next.milestone_value > v_cat.current_value;

        v_achievement_id := v_cat.category || '_' || v_next.milestone_value;

        -- Auto-create definition if not exists
        INSERT INTO achievement_definitions (id, category, icon, required_value, xp_reward, sort_order)
        VALUES (v_achievement_id,
                CASE v_cat.category
                  WHEN 'streak' THEN 'streak'
                  WHEN 'cards' THEN 'study'
                  WHEN 'sessions' THEN 'study'
                  WHEN 'time' THEN 'study'
                  WHEN 'mastery' THEN 'study'
                  WHEN 'decks' THEN 'milestone'
                  WHEN 'shares' THEN 'social'
                END,
                v_next.milestone_icon, v_next.milestone_value, v_next.milestone_xp, 0)
        ON CONFLICT (id) DO NOTHING;

        -- Award if not already earned
        IF NOT EXISTS (SELECT 1 FROM user_achievements WHERE user_id = v_uid AND achievement_id = v_achievement_id) THEN
          INSERT INTO user_achievements (user_id, achievement_id) VALUES (v_uid, v_achievement_id);
          v_new_achievements := array_append(v_new_achievements, v_achievement_id);
          v_total_xp := v_total_xp + v_next.milestone_xp;
        END IF;

        v_check_val := v_next.milestone_value;
      END LOOP;
    END;
  END LOOP;

  -- Also check special one-time achievements
  IF NOT EXISTS (SELECT 1 FROM user_achievements WHERE user_id = v_uid AND achievement_id = 'perfect_session') THEN
    IF EXISTS (SELECT 1 FROM study_sessions WHERE user_id = v_uid AND cards_studied >= 10 AND total_cards = cards_studied) THEN
      INSERT INTO achievement_definitions (id, category, icon, required_value, xp_reward, sort_order)
      VALUES ('perfect_session', 'milestone', '💯', 1, 50, 70) ON CONFLICT DO NOTHING;
      INSERT INTO user_achievements (user_id, achievement_id) VALUES (v_uid, 'perfect_session');
      v_new_achievements := array_append(v_new_achievements, 'perfect_session');
      v_total_xp := v_total_xp + 50;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM user_achievements WHERE user_id = v_uid AND achievement_id = 'night_owl') THEN
    IF EXISTS (SELECT 1 FROM study_sessions WHERE user_id = v_uid AND EXTRACT(HOUR FROM completed_at) BETWEEN 0 AND 4) THEN
      INSERT INTO achievement_definitions (id, category, icon, required_value, xp_reward, sort_order)
      VALUES ('night_owl', 'milestone', '🦉', 1, 30, 71) ON CONFLICT DO NOTHING;
      INSERT INTO user_achievements (user_id, achievement_id) VALUES (v_uid, 'night_owl');
      v_new_achievements := array_append(v_new_achievements, 'night_owl');
      v_total_xp := v_total_xp + 30;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM user_achievements WHERE user_id = v_uid AND achievement_id = 'early_bird') THEN
    IF EXISTS (SELECT 1 FROM study_sessions WHERE user_id = v_uid AND EXTRACT(HOUR FROM completed_at) BETWEEN 5 AND 7) THEN
      INSERT INTO achievement_definitions (id, category, icon, required_value, xp_reward, sort_order)
      VALUES ('early_bird', 'milestone', '🐦', 1, 30, 72) ON CONFLICT DO NOTHING;
      INSERT INTO user_achievements (user_id, achievement_id) VALUES (v_uid, 'early_bird');
      v_new_achievements := array_append(v_new_achievements, 'early_bird');
      v_total_xp := v_total_xp + 30;
    END IF;
  END IF;

  -- Award XP and recalculate level
  IF v_total_xp > 0 THEN
    UPDATE profiles
    SET xp = xp + v_total_xp,
        level = GREATEST(1, FLOOR(SQRT((xp + v_total_xp) / 50.0))::INT + 1)
    WHERE id = v_uid;
  END IF;

  RETURN json_build_object(
    'new_achievements', v_new_achievements,
    'xp_earned', v_total_xp,
    'current_stats', json_build_object(
      'streak', v_stats.streak,
      'cards', v_stats.total_cards,
      'sessions', v_stats.total_sessions,
      'time_min', v_stats.total_time_min,
      'mastery', v_stats.mastered_cards
    )
  );
END;
$$;

-- ─── Get next goals for dashboard display ──────────

CREATE OR REPLACE FUNCTION get_next_goals(p_user_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_stats RECORD;
BEGIN
  SELECT
    COALESCE((SELECT current_streak FROM study_streaks WHERE user_id = v_uid), 0) as streak,
    COALESCE((SELECT SUM(cards_studied) FROM study_sessions WHERE user_id = v_uid), 0) as total_cards,
    (SELECT COUNT(*) FROM study_sessions WHERE user_id = v_uid) as total_sessions,
    COALESCE((SELECT SUM(total_duration_ms)/60000 FROM study_sessions WHERE user_id = v_uid), 0) as total_time_min,
    (SELECT COUNT(*) FROM cards WHERE user_id = v_uid AND ease_factor > 2.5 AND srs_status = 'review') as mastered_cards
  INTO v_stats;

  RETURN json_build_object('goals', (
    SELECT json_agg(json_build_object(
      'category', t.category,
      'current', t.current_value,
      'target', m.milestone_value,
      'icon', m.milestone_icon,
      'xp', m.milestone_xp,
      'progress', CASE WHEN m.milestone_value > 0 THEN ROUND(t.current_value::numeric / m.milestone_value * 100) ELSE 0 END
    ))
    FROM (VALUES
      ('streak', v_stats.streak),
      ('cards', v_stats.total_cards),
      ('sessions', v_stats.total_sessions),
      ('time', v_stats.total_time_min),
      ('mastery', v_stats.mastered_cards)
    ) AS t(category, current_value),
    LATERAL get_next_milestone(t.category, t.current_value) m
  ));
END;
$$;
