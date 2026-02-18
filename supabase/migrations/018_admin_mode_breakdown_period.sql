-- ═══════════════════════════════════════════════════════
-- 018_admin_mode_breakdown_period.sql
--
-- Problem: admin_mode_breakdown() returned all-time data,
-- but the Study Activity page has a period selector
-- (7d/14d/30d/90d). Mode breakdown should match the
-- selected period for consistency.
--
-- Fix: Add p_days parameter to filter by period.
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_mode_breakdown(p_days INT DEFAULT 30)
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
