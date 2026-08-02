-- ============================================================================
-- 182: mastery means the same thing everywhere.
--
-- The app shipped TWO definitions of a "mastered" card and they disagreed:
--
--   packages/shared/lib/stats.ts   srs_status='review' AND interval_days >= 21   (dashboard)
--   migration 098 (achievements)   srs_status='review' AND ease_factor > 2.5
--
-- The second is not a mastery test. `ease_factor` STARTS at 2.5 and gains +0.05 on every
-- correct review (packages/shared/lib/srs.ts, calculateReview case 'good'), so a single right
-- answer in the review phase puts a card over the line. The 1,000-card mastery badge therefore
-- meant "answered 1,000 cards correctly once", and `get_next_goals` showed progress toward it on
-- the dashboard NEXT TO a mastery-rate tile computed the other way.
--
-- Both now call one helper, so the next change to this rule touches one place instead of three
-- copies across two functions.
--
-- WHY MATURITY AND NOT THE RETENTION RULE. Goal progress asks "will I recall this on the exam
-- date" (migration 181), which needs a date. An achievement has none — it is account-wide and
-- permanent — so the honest question is the one Anki's own statistics ask: has this survived
-- across weeks. 21 days is Anki's convention and admittedly arbitrary (its author: "there's
-- nothing special about 21 days in particular"), but it is the shipped dashboard's rule, it is
-- monotone in the way a badge needs, and adopting it makes the two definitions ONE.
--
-- Existing badges are unaffected: `user_achievements` rows persist once inserted, so nobody
-- loses an award. Tightening the rule only changes when the NEXT one fires.
-- ============================================================================

BEGIN;

/**
 * Cards this learner has retained across weeks.
 *
 * 21 days mirrors `LEGACY_MATURE_INTERVAL_DAYS` in
 * packages/shared/learning/adapters/knowledge-catalog.ts, and a test pins the two together —
 * the number living in two languages is exactly how the previous split started.
 */
CREATE OR REPLACE FUNCTION public.mature_card_count(p_user_id uuid)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT count(*) FROM cards
  WHERE user_id = p_user_id
    AND srs_status = 'review'
    AND interval_days >= 21;
$$;

REVOKE EXECUTE ON FUNCTION public.mature_card_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mature_card_count(uuid) TO authenticated;

-- ── get_next_goals: unchanged except the mastery expression (1 occurrence(s)) ──
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
    mature_card_count(v_uid) as mastered_cards
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

-- ── check_achievements: unchanged except the mastery expression (1 occurrence(s)) ──
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
    mature_card_count(v_uid) as mastered_cards,
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

COMMIT;
