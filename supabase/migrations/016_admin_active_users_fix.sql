-- ═══════════════════════════════════════════════════════
-- 016_admin_active_users_fix.sql — Fix active user metrics
--
-- Problem: DAU/WAU/MAU and retention were based solely on
-- study_sessions.completed_at. Users who logged in but
-- didn't complete a study session showed as inactive.
--
-- Fix: Use auth.users.last_sign_in_at (login-based) as
-- the primary activity indicator — the industry standard
-- for business dashboards.
--
-- 1. admin_active_users() — login-based DAU/WAU/MAU
-- 2. admin_retention_metrics() — login-based retention
-- ═══════════════════════════════════════════════════════

-- ─── 1. Active Users (login-based) ────────────────────

CREATE OR REPLACE FUNCTION admin_active_users()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
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

-- ─── 2. Retention Metrics (login-based) ───────────────
-- "Active" = signed in during the period.
-- "New users this month" = created account this month
--   (regardless of study activity).

CREATE OR REPLACE FUNCTION admin_retention_metrics()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  curr_month_start TIMESTAMPTZ;
  prev_month_start TIMESTAMPTZ;
  prev_active INT;
  retained INT;
  new_users_this_month INT;
  churned INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  curr_month_start := DATE_TRUNC('month', NOW());
  prev_month_start := DATE_TRUNC('month', NOW()) - INTERVAL '1 month';

  -- Users who signed in last month
  SELECT COUNT(*) INTO prev_active
  FROM auth.users
  WHERE last_sign_in_at >= prev_month_start
    AND last_sign_in_at < curr_month_start;

  -- Users who signed in BOTH last month and this month (retained)
  SELECT COUNT(*) INTO retained
  FROM (
    SELECT id FROM auth.users
    WHERE last_sign_in_at >= prev_month_start
      AND last_sign_in_at < curr_month_start
    INTERSECT
    SELECT id FROM auth.users
    WHERE last_sign_in_at >= curr_month_start
  ) t;

  -- New users this month = created account this month
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
