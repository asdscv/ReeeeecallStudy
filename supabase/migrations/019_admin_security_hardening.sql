-- ═══════════════════════════════════════════════════════
-- 019_admin_security_hardening.sql
--
-- Fixes three critical security & data issues:
--
-- 1. SET search_path = public on ALL SECURITY DEFINER
--    functions to prevent search-path injection attacks.
--
-- 2. REVOKE EXECUTE FROM anon on all admin RPC functions
--    to prevent unauthenticated users from invoking them.
--
-- 3. Fix admin_retention_metrics() — the INTERSECT on
--    auth.users.last_sign_in_at is mathematically broken
--    (single timestamp can't exist in two non-overlapping
--    ranges). Revert retention to study_sessions-based
--    INTERSECT (which works: a user can have sessions in
--    multiple months). Keep login-based DAU/WAU/MAU.
-- ═══════════════════════════════════════════════════════

-- ─── 1. is_admin() — add SET search_path ─────────────

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )),
    false
  );
$$;

-- ─── 2. prevent_role_escalation() — add SET search_path

CREATE OR REPLACE FUNCTION prevent_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT is_admin() THEN
      RAISE EXCEPTION 'Only admins can change user roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 3. admin_overview_stats() — add SET search_path ──

CREATE OR REPLACE FUNCTION admin_overview_stats()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_users',    (SELECT COUNT(*) FROM profiles),
    'total_decks',    (SELECT COUNT(*) FROM decks),
    'total_cards',    (SELECT COUNT(*) FROM cards),
    'total_sessions', (SELECT COUNT(*) FROM study_sessions),
    'total_study_time_ms', (SELECT COALESCE(SUM(total_duration_ms), 0) FROM study_sessions),
    'total_cards_studied', (SELECT COALESCE(SUM(cards_studied), 0) FROM study_sessions),
    'total_templates', (SELECT COUNT(*) FROM card_templates),
    'total_shared_decks', (SELECT COUNT(*) FROM deck_shares WHERE status = 'active'),
    'total_marketplace_listings', (SELECT COUNT(*) FROM marketplace_listings WHERE is_active = true)
  ) INTO result;

  RETURN result;
END;
$$;

-- ─── 4. admin_active_users() — login-based DAU/WAU/MAU

CREATE OR REPLACE FUNCTION admin_active_users()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'dau', (
      SELECT COUNT(*) FROM auth.users
      WHERE last_sign_in_at >= NOW() - INTERVAL '1 day'
    ),
    'wau', (
      SELECT COUNT(*) FROM auth.users
      WHERE last_sign_in_at >= NOW() - INTERVAL '7 days'
    ),
    'mau', (
      SELECT COUNT(*) FROM auth.users
      WHERE last_sign_in_at >= NOW() - INTERVAL '30 days'
    ),
    'total_users', (SELECT COUNT(*) FROM profiles)
  ) INTO result;

  RETURN result;
END;
$$;

-- ─── 5. admin_user_signups() — add SET search_path ────

CREATE OR REPLACE FUNCTION admin_user_signups(p_days INT DEFAULT 90)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  safe_days INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  safe_days := GREATEST(1, LEAST(p_days, 365));

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      DATE(created_at) AS date,
      COUNT(*) AS count
    FROM profiles
    WHERE created_at >= NOW() - INTERVAL '1 day' * safe_days
    GROUP BY DATE(created_at)
    ORDER BY date
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- ─── 6. admin_daily_study_activity() — add SET search_path

CREATE OR REPLACE FUNCTION admin_daily_study_activity(p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  safe_days INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  safe_days := GREATEST(1, LEAST(p_days, 365));

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      DATE(completed_at) AS date,
      COUNT(*) AS sessions,
      COALESCE(SUM(cards_studied), 0) AS cards,
      COALESCE(SUM(total_duration_ms), 0) AS total_duration_ms
    FROM study_sessions
    WHERE completed_at >= NOW() - INTERVAL '1 day' * safe_days
    GROUP BY DATE(completed_at)
    ORDER BY date
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- ─── 7. admin_mode_breakdown() — add SET search_path ──

CREATE OR REPLACE FUNCTION admin_mode_breakdown(p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  safe_days INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  safe_days := GREATEST(1, LEAST(p_days, 365));

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      study_mode AS mode,
      COUNT(*) AS session_count,
      COALESCE(SUM(cards_studied), 0) AS total_cards,
      COALESCE(SUM(total_duration_ms), 0) AS total_duration_ms
    FROM study_sessions
    WHERE completed_at >= NOW() - INTERVAL '1 day' * safe_days
    GROUP BY study_mode
    ORDER BY session_count DESC
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- ─── 8. admin_content_stats() — add SET search_path ───

CREATE OR REPLACE FUNCTION admin_content_stats()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_listings', (SELECT COUNT(*) FROM marketplace_listings),
    'active_listings', (SELECT COUNT(*) FROM marketplace_listings WHERE is_active = true),
    'total_acquires', (SELECT COALESCE(SUM(acquire_count), 0) FROM marketplace_listings),
    'total_shares', (SELECT COUNT(*) FROM deck_shares),
    'active_shares', (SELECT COUNT(*) FROM deck_shares WHERE status = 'active'),
    'share_by_mode', COALESCE((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT share_mode AS mode, COUNT(*) AS count
        FROM deck_shares
        GROUP BY share_mode
      ) t
    ), '[]'::JSON),
    'top_categories', COALESCE((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT category, COUNT(*) AS count
        FROM marketplace_listings
        WHERE is_active = true
        GROUP BY category
        ORDER BY count DESC
        LIMIT 10
      ) t
    ), '[]'::JSON)
  ) INTO result;

  RETURN COALESCE(result, '{}'::JSON);
END;
$$;

-- ─── 9. admin_rating_distribution() — add SET search_path

CREATE OR REPLACE FUNCTION admin_rating_distribution(p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  safe_days INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  safe_days := GREATEST(1, LEAST(p_days, 365));

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      rating,
      COUNT(*) AS count
    FROM study_logs
    WHERE studied_at >= NOW() - INTERVAL '1 day' * safe_days
    GROUP BY rating
    ORDER BY count DESC
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- ─── 10. admin_recent_activity() — add SET search_path ─

CREATE OR REPLACE FUNCTION admin_recent_activity()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      DATE(completed_at) AS date,
      COUNT(*) AS sessions,
      COUNT(DISTINCT user_id) AS active_users,
      COALESCE(SUM(cards_studied), 0) AS cards
    FROM study_sessions
    WHERE completed_at >= NOW() - INTERVAL '14 days'
    GROUP BY DATE(completed_at)
    ORDER BY date
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- ─── 11. admin_system_stats() — add SET search_path ────

CREATE OR REPLACE FUNCTION admin_system_stats()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_api_keys', (SELECT COUNT(*) FROM api_keys),
    'active_api_keys', (SELECT COUNT(*) FROM api_keys WHERE (expires_at IS NULL OR expires_at > NOW())),
    'expired_api_keys', (SELECT COUNT(*) FROM api_keys WHERE expires_at IS NOT NULL AND expires_at <= NOW()),
    'recently_used_keys', (SELECT COUNT(*) FROM api_keys WHERE last_used_at >= NOW() - INTERVAL '7 days'),
    'total_contents', (SELECT COUNT(*) FROM contents),
    'published_contents', (SELECT COUNT(*) FROM contents WHERE is_published = true),
    'total_study_logs', (SELECT COUNT(*) FROM study_logs)
  ) INTO result;

  RETURN result;
END;
$$;

-- ─── 12. admin_srs_status_breakdown() — add SET search_path

CREATE OR REPLACE FUNCTION admin_srs_status_breakdown()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_agg(row_to_json(t))
  FROM (
    SELECT
      srs_status AS status,
      COUNT(*) AS count
    FROM cards
    GROUP BY srs_status
    ORDER BY count DESC
  ) t INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$;

-- ─── 13. admin_retention_metrics() — FIX INTERSECT BUG ─
-- Problem: 016 used auth.users.last_sign_in_at (a single
-- overwritten timestamp). INTERSECT between "last month"
-- and "this month" always returned 0 because one value
-- can't be in two non-overlapping ranges.
--
-- Fix: Use study_sessions.completed_at for retention
-- (individual records exist across months — INTERSECT
-- works correctly). Keep profiles.created_at for new users.

CREATE OR REPLACE FUNCTION admin_retention_metrics()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  curr_month_start DATE;
  prev_month_start DATE;
  prev_active INT;
  retained INT;
  new_users_this_month INT;
  churned INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  curr_month_start := DATE_TRUNC('month', NOW())::DATE;
  prev_month_start := (DATE_TRUNC('month', NOW()) - INTERVAL '1 month')::DATE;

  -- Users who completed at least one study session last month
  SELECT COUNT(DISTINCT user_id) INTO prev_active
  FROM study_sessions
  WHERE completed_at >= prev_month_start
    AND completed_at < curr_month_start;

  -- Users active BOTH last month and this month (retained)
  SELECT COUNT(*) INTO retained
  FROM (
    SELECT DISTINCT user_id FROM study_sessions
    WHERE completed_at >= prev_month_start
      AND completed_at < curr_month_start
    INTERSECT
    SELECT DISTINCT user_id FROM study_sessions
    WHERE completed_at >= curr_month_start
  ) t;

  -- New users this month = signed up this month (no study requirement)
  SELECT COUNT(*) INTO new_users_this_month
  FROM profiles
  WHERE created_at >= curr_month_start;

  -- Churned = active last month but not this month
  churned := GREATEST(0, prev_active - retained);

  SELECT json_build_object(
    'prev_month_active', prev_active,
    'retained', retained,
    'retention_rate', CASE WHEN prev_active > 0 THEN ROUND((retained::NUMERIC / prev_active) * 100, 1) ELSE 0 END,
    'churned', churned,
    'churn_rate', CASE WHEN prev_active > 0 THEN ROUND((churned::NUMERIC / prev_active) * 100, 1) ELSE 0 END,
    'new_users_this_month', new_users_this_month
  ) INTO result;

  RETURN result;
END;
$$;

-- ─── 14. REVOKE EXECUTE FROM anon ─────────────────────
-- Prevent unauthenticated users from invoking admin RPCs.

REVOKE EXECUTE ON FUNCTION admin_overview_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION admin_active_users() FROM anon;
REVOKE EXECUTE ON FUNCTION admin_user_signups(INT) FROM anon;
REVOKE EXECUTE ON FUNCTION admin_daily_study_activity(INT) FROM anon;
REVOKE EXECUTE ON FUNCTION admin_mode_breakdown(INT) FROM anon;
REVOKE EXECUTE ON FUNCTION admin_content_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION admin_rating_distribution(INT) FROM anon;
REVOKE EXECUTE ON FUNCTION admin_recent_activity() FROM anon;
REVOKE EXECUTE ON FUNCTION admin_system_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION admin_srs_status_breakdown() FROM anon;
REVOKE EXECUTE ON FUNCTION admin_retention_metrics() FROM anon;
