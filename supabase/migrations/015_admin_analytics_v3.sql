-- ═══════════════════════════════════════════════════════
-- 015_admin_analytics_v3.sql — Enterprise analytics functions
--
-- 1. admin_srs_status_breakdown() — cards by SRS status
-- 2. admin_retention_metrics() — monthly retention rate
-- ═══════════════════════════════════════════════════════

-- ─── 1. SRS Status Breakdown ─────────────────────────

CREATE OR REPLACE FUNCTION admin_srs_status_breakdown()
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

-- ─── 2. Retention Metrics ────────────────────────────
-- Returns monthly retention rate: % of last month's active users
-- who are also active this month.

CREATE OR REPLACE FUNCTION admin_retention_metrics()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  prev_month_start DATE;
  prev_month_end DATE;
  curr_month_start DATE;
  curr_month_end DATE;
  prev_active INT;
  retained INT;
  new_users_this_month INT;
  churned INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  curr_month_start := DATE_TRUNC('month', NOW())::DATE;
  curr_month_end := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  prev_month_start := (DATE_TRUNC('month', NOW()) - INTERVAL '1 month')::DATE;
  prev_month_end := (curr_month_start - INTERVAL '1 day')::DATE;

  -- Users active last month
  SELECT COUNT(DISTINCT user_id) INTO prev_active
  FROM study_sessions
  WHERE completed_at >= prev_month_start AND completed_at < curr_month_start;

  -- Users active BOTH last month and this month (retained)
  SELECT COUNT(*) INTO retained
  FROM (
    SELECT DISTINCT user_id FROM study_sessions
    WHERE completed_at >= prev_month_start AND completed_at < curr_month_start
    INTERSECT
    SELECT DISTINCT user_id FROM study_sessions
    WHERE completed_at >= curr_month_start
  ) t;

  -- New users this month (signed up this month AND studied)
  SELECT COUNT(DISTINCT ss.user_id) INTO new_users_this_month
  FROM study_sessions ss
  JOIN profiles p ON p.id = ss.user_id
  WHERE ss.completed_at >= curr_month_start
    AND p.created_at >= curr_month_start;

  -- Churned = prev active - retained
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
