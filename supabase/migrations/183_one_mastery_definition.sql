-- ============================================================================
-- 183: mastery means the same thing everywhere.
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
-- and adopting it makes the two definitions ONE.
--
-- WHAT LEARNERS WILL SEE. No badge is lost — `user_achievements` rows persist once inserted —
-- but the visible COUNT drops for anyone who had banked cards under the old rule, and the count
-- is not monotone either way: a lapse sets `interval_days` to 0, so a card can leave the mature
-- set. `get_next_milestone` reads only the current count, so without help it would offer someone
-- holding `mastery_1000` a next goal of 50. `get_next_goals` below is therefore changed to floor
-- the category at the highest milestone already earned, so the next goal is always the next
-- UNEARNED one.
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
  SET search_path = public
AS $$
  SELECT count(*) FROM cards
  WHERE user_id = p_user_id
    AND srs_status = 'review'
    AND interval_days >= 21;
$$;

-- INVOKER, not DEFINER, and not reachable from PostgREST at all.
--
-- The first draft copied 181's REVOKE/GRANT pair without copying what makes it safe: 181's
-- `get_goal_knowledge` checks ownership in its body, and this helper takes a uuid and checks
-- nothing. As SECURITY DEFINER granted to `authenticated` it therefore bypassed RLS on `cards`
-- for ANY id a caller supplied, and user ids are enumerable (`get_leaderboard` returns them).
-- An authenticated attacker could read a stranger's mature-card count while RLS correctly showed
-- them zero of the rows behind it — confirmed against a live database before this line changed.
--
-- SECURITY INVOKER fixes it properly rather than papering over it with a guard: a direct caller
-- now sees only what RLS allows them to see, and the two SECURITY DEFINER functions below still
-- get the full count because they execute as the owner. `service_role` keeps EXECUTE because the
-- blanket REVOKE would otherwise strip the grant it inherits from PUBLIC.
REVOKE EXECUTE ON FUNCTION public.mature_card_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mature_card_count(uuid) TO service_role;

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
  -- `p_user_id <> auth.uid()` evaluates to NULL for an unauthenticated caller, so the whole
  -- conjunction was NULL and this IF never fired: as `anon`, `check_achievements('<any uuid>')`
  -- awarded badges and XP to a stranger's account. Confirmed against a live database. Requiring
  -- a caller identity first is what closes it; `IS DISTINCT FROM` keeps the comparison honest
  -- even if auth.uid() is somehow null past this point.
  IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid()
     AND NOT is_admin() AND auth.role() IS DISTINCT FROM 'service_role' THEN
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
    -- Floored at the highest milestone this learner already HOLDS, not just at their current
    -- count. `get_next_milestone` reads the count alone, so tightening the mastery rule would
    -- otherwise hand someone wearing the 1,000-card badge a next goal of 50 — verified before
    -- this line existed. Achievement ids are `<category>_<value>`, which is how 070 mints them.
    LATERAL get_next_milestone(
      t.category,
      GREATEST(
        t.current_value,
        COALESCE((
          SELECT MAX(NULLIF(regexp_replace(ua.achievement_id, '^' || t.category || '_', ''), ua.achievement_id)::bigint)
          FROM user_achievements ua
          WHERE ua.user_id = v_uid
            AND ua.achievement_id ~ ('^' || t.category || '_[0-9]+$')
        ), 0)
      )
    ) m
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
  -- `p_user_id <> auth.uid()` evaluates to NULL for an unauthenticated caller, so the whole
  -- conjunction was NULL and this IF never fired: as `anon`, `check_achievements('<any uuid>')`
  -- awarded badges and XP to a stranger's account. Confirmed against a live database. Requiring
  -- a caller identity first is what closes it; `IS DISTINCT FROM` keeps the comparison honest
  -- even if auth.uid() is somehow null past this point.
  IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid()
     AND NOT is_admin() AND auth.role() IS DISTINCT FROM 'service_role' THEN
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
