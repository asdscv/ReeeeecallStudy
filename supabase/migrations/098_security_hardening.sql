-- ============================================================================
-- Migration 093: Security Hardening
-- ----------------------------------------------------------------------------
-- Following the SECURITY DEFINER audit (db-audit dumps), this migration closes
-- a set of security holes WITHOUT changing any business logic:
--
--   1. IDOR fixes — several SECURITY DEFINER functions accept a caller-supplied
--      p_user_id and use it without comparing to auth.uid(), letting any
--      authenticated user read/write another user's data. Each now carries an
--      authorization guard.
--        * Variant A: param is REQUIRED / used directly  -> reject when
--          p_user_id <> auth.uid() (unless admin or service_role).
--        * Variant B: param is OPTIONAL (COALESCE(p_user_id, auth.uid())) ->
--          allow NULL, otherwise reject mismatch (unless admin or service_role).
--      Some of these are also invoked by Edge Functions under the service_role,
--      so every guard explicitly allows auth.role() = 'service_role'.
--      get_upload_dates() takes a DECK id, so it gets a deck-entitlement guard
--      (owner OR active subscriber) mirroring get_deck_versions().
--
--   2. search_path pinning — 6 SECURITY DEFINER functions lacked a fixed
--      search_path; pin them to 'public' to prevent search_path hijacking.
--
--   3. EXECUTE revokes — resolve_api_key() and increment_acquire_count() should
--      not be directly callable by anon/authenticated/PUBLIC.
--
--   4. View hardening — contents_missing_locales recreated with
--      security_invoker = on so it honors the caller's RLS.
--
--   5. card_templates de-dup safety — add a UNIQUE(user_id, name) index (there
--      are currently ZERO duplicate rows, so this is safe) and convert
--      _seed_default_templates() to ON CONFLICT DO NOTHING to remove its TOCTOU
--      race window.
--
-- Bodies of every CREATE OR REPLACE FUNCTION below are copied verbatim from the
-- live prod definitions; only the guard (and, for _seed_default_templates, the
-- documented INSERT/ON CONFLICT change) was inserted. Safe to run once on prod.
-- ============================================================================


-- ============================================================================
-- 1. IDOR GUARDS
-- ============================================================================

-- ─── get_deck_stats(p_user_id uuid) — Variant A (p_user_id used in WHERE) ───
CREATE OR REPLACE FUNCTION public.get_deck_stats(p_user_id uuid)
 RETURNS TABLE(deck_id uuid, deck_name text, total_cards bigint, new_cards bigint, review_cards bigint, learning_cards bigint, last_studied timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  -- ── Owned decks: embedded SRS lives on the cards row ──
  SELECT
    d.id,
    d.name,
    COUNT(c.id),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'new'),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'review' AND c.next_review_at <= NOW()),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'learning' AND c.next_review_at <= NOW()),
    (SELECT MAX(sl.studied_at)
     FROM study_logs sl
     WHERE sl.deck_id = d.id AND sl.user_id = p_user_id
    )
  FROM decks d
  LEFT JOIN cards c ON c.deck_id = d.id AND c.user_id = p_user_id
  WHERE d.user_id = p_user_id AND d.is_archived = false
  GROUP BY d.id, d.name

  UNION ALL

  -- ── Subscribed decks: per-user SRS lives in user_card_progress ──
  -- Cards are owned by the publisher, so they are NOT filtered by user_id.
  SELECT
    d.id,
    d.name,
    COUNT(c.id),
    COUNT(c.id) FILTER (WHERE COALESCE(ucp.srs_status, 'new') = 'new'),
    COUNT(c.id) FILTER (WHERE ucp.srs_status = 'review' AND ucp.next_review_at <= NOW()),
    COUNT(c.id) FILTER (WHERE ucp.srs_status = 'learning' AND ucp.next_review_at <= NOW()),
    (SELECT MAX(sl.studied_at)
     FROM study_logs sl
     WHERE sl.deck_id = d.id AND sl.user_id = p_user_id
    )
  FROM deck_shares ds
  JOIN decks d ON d.id = ds.deck_id
  LEFT JOIN cards c ON c.deck_id = d.id
  LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = p_user_id
  WHERE ds.recipient_id = p_user_id
    AND ds.share_mode = 'subscribe'
    AND ds.status = 'active'
    AND d.is_archived = false
    AND d.user_id <> p_user_id   -- never double-count an owned deck
  GROUP BY d.id, d.name;
END;
$function$;


-- ─── get_user_study_stats(p_user_id uuid) — Variant B (COALESCE param) ───
CREATE OR REPLACE FUNCTION public.get_user_study_stats(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_result JSON;
BEGIN
  IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

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
$function$;


-- ─── get_user_achievements(p_user_id uuid) — Variant B (COALESCE param) ───
CREATE OR REPLACE FUNCTION public.get_user_achievements(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
BEGIN
  IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

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
$function$;


-- ─── get_next_goals(p_user_id uuid) — Variant B (COALESCE param) ───
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


-- ─── check_achievements(p_user_id uuid) — Variant B (COALESCE param) ───
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


-- ─── update_study_streak(p_user_id uuid) — Variant A (p_user_id used directly) ───
CREATE OR REPLACE FUNCTION public.update_study_streak(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_row study_streaks%ROWTYPE;
  v_new_current INTEGER;
  v_new_longest INTEGER;
  v_freeze_used BOOLEAN := false;
  v_freezes_remaining INTEGER;
  v_new_freezes INTEGER;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

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
$function$;


-- ─── get_pending_sync_count(p_user_id uuid, p_deck_id uuid) — Variant A ───
CREATE OR REPLACE FUNCTION public.get_pending_sync_count(p_user_id uuid, p_deck_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last_synced TIMESTAMPTZ;
  v_count INT;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get last sync time
  SELECT COALESCE(last_synced_at, accepted_at, created_at)
  INTO v_last_synced
  FROM deck_shares
  WHERE deck_id = p_deck_id
    AND recipient_id = p_user_id
    AND share_mode = 'subscribe'
    AND status = 'active'
  LIMIT 1;

  IF v_last_synced IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::INT INTO v_count
  FROM deck_change_log
  WHERE deck_id = p_deck_id
    AND created_at > v_last_synced;

  RETURN v_count;
END;
$function$;


-- ─── init_subscriber_progress(p_user_id uuid, p_deck_id uuid) — Variant A ───
--     (Edge Functions call this under service_role; the auth.role() clause is essential)
CREATE OR REPLACE FUNCTION public.init_subscriber_progress(p_user_id uuid, p_deck_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO user_card_progress (user_id, card_id, deck_id, srs_status)
  SELECT p_user_id, id, deck_id, 'new'
  FROM cards
  WHERE deck_id = p_deck_id
  ON CONFLICT (user_id, card_id) DO NOTHING;
END;
$function$;


-- ─── sync_subscriber_deck(p_user_id uuid, p_deck_id uuid) — Variant A ───
CREATE OR REPLACE FUNCTION public.sync_subscriber_deck(p_user_id uuid, p_deck_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_share RECORD;
  v_last_synced TIMESTAMPTZ;
  v_added INT := 0;
  v_removed INT := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT is_admin() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Verify active subscription exists
  SELECT * INTO v_share
  FROM deck_shares
  WHERE deck_id = p_deck_id
    AND recipient_id = p_user_id
    AND share_mode = 'subscribe'
    AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active subscription found for this deck';
  END IF;

  v_last_synced := COALESCE(v_share.last_synced_at, v_share.accepted_at, v_share.created_at);

  -- Process card_added: insert missing user_card_progress rows
  -- We don't rely solely on the changelog — we reconcile against actual cards
  -- This makes the sync idempotent
  INSERT INTO user_card_progress (user_id, card_id, deck_id, srs_status)
  SELECT p_user_id, c.id, c.deck_id, 'new'
  FROM cards c
  WHERE c.deck_id = p_deck_id
    AND NOT EXISTS (
      SELECT 1 FROM user_card_progress ucp
      WHERE ucp.user_id = p_user_id AND ucp.card_id = c.id
    )
  ON CONFLICT (user_id, card_id) DO NOTHING;

  GET DIAGNOSTICS v_added = ROW_COUNT;

  -- Process card_removed: delete progress for cards that no longer exist
  DELETE FROM user_card_progress
  WHERE user_id = p_user_id
    AND deck_id = p_deck_id
    AND NOT EXISTS (
      SELECT 1 FROM cards c WHERE c.id = user_card_progress.card_id
    );

  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Update last_synced_at on the share record
  UPDATE deck_shares
  SET last_synced_at = v_now
  WHERE id = v_share.id;

  RETURN jsonb_build_object(
    'added', v_added,
    'removed', v_removed,
    'last_synced', v_now
  );
END;
$function$;


-- ─── get_upload_dates(p_deck_id uuid, p_timezone text) — deck-entitlement guard ───
--     p_deck_id is a DECK id, not a user id. The guard mirrors get_deck_versions()
--     (caller must own the deck OR have an active deck_share), plus an explicit
--     service_role bypass for Edge Functions.
CREATE OR REPLACE FUNCTION public.get_upload_dates(p_deck_id uuid, p_timezone text DEFAULT 'Asia/Seoul'::text)
 RETURNS TABLE(upload_date date, card_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM decks WHERE id = p_deck_id AND user_id = auth.uid())
     AND NOT EXISTS (
       SELECT 1 FROM deck_shares
       WHERE deck_shares.deck_id = p_deck_id
         AND deck_shares.recipient_id = auth.uid()
         AND deck_shares.status = 'active'
     )
     AND NOT EXISTS (SELECT 1 FROM marketplace_listings WHERE deck_id = p_deck_id AND is_active = true)
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    DATE(c.created_at AT TIME ZONE p_timezone),
    COUNT(*)
  FROM cards c
  WHERE c.deck_id = p_deck_id
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$function$;


-- ============================================================================
-- 2. SEARCH_PATH PINNING (SECURITY DEFINER functions that lacked it)
-- ============================================================================
ALTER FUNCTION public.admin_set_subscription(uuid, text, text, timestamptz) SET search_path = public;
ALTER FUNCTION public.admin_set_session_override(uuid, integer) SET search_path = public;
ALTER FUNCTION public.bulk_insert_cards(uuid, uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.get_user_sessions() SET search_path = public;
ALTER FUNCTION public.get_user_subscription() SET search_path = public;
ALTER FUNCTION public.session_heartbeat(text) SET search_path = public;


-- ============================================================================
-- 3. EXECUTE REVOKES
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.resolve_api_key(text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_acquire_count(uuid) FROM anon, authenticated, PUBLIC;


-- ============================================================================
-- 4. VIEW HARDENING — contents_missing_locales with security_invoker
-- ============================================================================
CREATE OR REPLACE VIEW public.contents_missing_locales WITH (security_invoker = on) AS
 SELECT slug,
    array_agg(locale ORDER BY locale) AS existing_locales,
    ARRAY( SELECT l.l
           FROM unnest(ARRAY['en'::text, 'ko'::text, 'zh'::text, 'ja'::text, 'es'::text]) l(l)
          WHERE (NOT (l.l IN ( SELECT c2.locale
                   FROM contents c2
                  WHERE ((c2.slug = c.slug) AND (c2.is_published = true)))))) AS missing_locales
   FROM contents c
  WHERE (is_published = true)
  GROUP BY slug
 HAVING (count(*) < 5);


-- ============================================================================
-- 5. card_templates DE-DUP SAFETY + CONCURRENCY
-- ============================================================================
-- Currently ZERO duplicate (user_id, name) rows, so the unique index is safe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_templates_user_name
  ON public.card_templates(user_id, name);

-- Convert _seed_default_templates() from IF-NOT-EXISTS/INSERT (TOCTOU race) to
-- INSERT ... ON CONFLICT (user_id, name) DO NOTHING. Body otherwise verbatim;
-- keeps SECURITY DEFINER, SET search_path = public, extensions, and the
-- p_user_id IS NULL guard.
CREATE OR REPLACE FUNCTION public._seed_default_templates(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- 기본 (앞/뒤) — the simplest preset: one front, one back.
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    p_user_id, '기본 (앞/뒤)',
    '[{"key":"field_1","name":"앞면","type":"text","order":0},{"key":"field_2","name":"뒷면","type":"text","order":1}]'::jsonb,
    '[{"field_key":"field_1","style":"primary"}]'::jsonb,
    '[{"field_key":"field_2","style":"primary"}]'::jsonb,
    true
  )
  ON CONFLICT (user_id, name) DO NOTHING;

  -- 영어 단어 — Word / Meaning / Pronunciation / Example.
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    p_user_id, '영어 단어',
    '[{"key":"field_1","name":"Word","type":"text","order":0},{"key":"field_2","name":"Meaning","type":"text","order":1},{"key":"field_3","name":"Pronunciation","type":"text","order":2},{"key":"field_4","name":"Example","type":"text","order":3}]'::jsonb,
    '[{"field_key":"field_1","style":"primary"}]'::jsonb,
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"}]'::jsonb,
    true
  )
  ON CONFLICT (user_id, name) DO NOTHING;

  -- 중국어 단어 — 한자 / 뜻 / 병음 / 예문 / 오디오.
  INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, is_default)
  VALUES (
    p_user_id, '중국어 단어',
    '[{"key":"field_1","name":"한자","type":"text","order":0},{"key":"field_2","name":"뜻","type":"text","order":1},{"key":"field_3","name":"병음","type":"text","order":2},{"key":"field_4","name":"예문","type":"text","order":3},{"key":"field_5","name":"오디오","type":"audio","order":4}]'::jsonb,
    '[{"field_key":"field_1","style":"primary"}]'::jsonb,
    '[{"field_key":"field_2","style":"primary"},{"field_key":"field_3","style":"hint"},{"field_key":"field_4","style":"detail"},{"field_key":"field_5","style":"media"}]'::jsonb,
    true
  )
  ON CONFLICT (user_id, name) DO NOTHING;
END;
$function$;
