-- ═══════════════════════════════════════════════════════
-- 014_admin_functions_v2.sql — Additional admin RPC functions
--
-- Adds missing admin dashboard functions + fixes:
-- 1. is_admin() with COALESCE for null safety
-- 2. admin_rating_distribution() — rating analytics
-- 3. admin_recent_activity() — recent daily activity
-- 4. admin_system_stats() — API keys, contents, logs
-- 5. Performance indexes for study_logs and api_keys
-- ═══════════════════════════════════════════════════════

-- ─── 1. Fix is_admin() — add COALESCE for null safety ───

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )),
    false
  );
$$;

-- ─── 2. Rating distribution (for study analytics) ───────

CREATE OR REPLACE FUNCTION admin_rating_distribution(p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
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

-- ─── 3. Recent daily activity for overview (last 14 days) ──

CREATE OR REPLACE FUNCTION admin_recent_activity()
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

-- ─── 4. System stats (API keys, contents, logs) ─────────

CREATE OR REPLACE FUNCTION admin_system_stats()
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

-- ─── 5. Performance indexes ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_study_logs_studied_at
  ON study_logs (studied_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at
  ON api_keys (expires_at);
