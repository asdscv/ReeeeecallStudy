-- Rollback for 183. Restores the pre-182 mastery expression in both functions and drops the
-- helper. Idempotent: the dry-run applies and reverts repeatedly.
--
-- Deliberately re-creates the OLD rule rather than leaving the functions calling a dropped
-- helper — a rollback that leaves `check_achievements` unable to execute would take achievements
-- down with it.
BEGIN;
-- ── get_next_goals: restored to its migration-098 form ──
CREATE OR REPLACE FUNCTION public.get_next_goals(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_stats RECORD;
BEGIN
  IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

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
$function$;

-- ── check_achievements: restored to its migration-098 form ──
CREATE OR REPLACE FUNCTION public.check_achievements(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_new_achievements TEXT[] := '{}';
  v_total_xp INTEGER := 0;
  v_stats RECORD;
  v_cat RECORD;
  v_next RECORD;
  v_achievement_id TEXT;
BEGIN
  IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

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

  -- Award XP and recalculate level (flat formula: level = floor(xp/150) + 1)
  IF v_total_xp > 0 THEN
    UPDATE profiles
    SET xp = xp + v_total_xp,
        level = GREATEST(1, FLOOR((xp + v_total_xp) / 150.0)::INT + 1)
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
$function$;

DROP FUNCTION IF EXISTS public.mature_card_count(uuid);

COMMIT;
