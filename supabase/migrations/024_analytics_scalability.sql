-- ═══════════════════════════════════════════════════════════════════
-- 024 – Analytics Scalability
--
-- Phase 4: Scalability
--   • content_views_daily_summary table
--   • aggregate_daily_views() — daily rollup function
--   • archive_old_content_views() — purge old raw data
--   • Updated admin_content_analytics() — hybrid summary+live
-- ═══════════════════════════════════════════════════════════════════

-- ─── 4A. Daily Summary Table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_views_daily_summary (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id        UUID NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  view_count        INTEGER NOT NULL DEFAULT 0,
  unique_sessions   INTEGER NOT NULL DEFAULT 0,
  unique_viewers    INTEGER NOT NULL DEFAULT 0,
  avg_duration_ms   INTEGER NOT NULL DEFAULT 0,
  max_scroll_depth  INTEGER NOT NULL DEFAULT 0,
  referrer_direct   INTEGER NOT NULL DEFAULT 0,
  referrer_search   INTEGER NOT NULL DEFAULT 0,
  referrer_social   INTEGER NOT NULL DEFAULT 0,
  referrer_other    INTEGER NOT NULL DEFAULT 0,
  device_mobile     INTEGER NOT NULL DEFAULT 0,
  device_tablet     INTEGER NOT NULL DEFAULT 0,
  device_desktop    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_id, date)
);

CREATE INDEX idx_daily_summary_date ON content_views_daily_summary (date DESC);
CREATE INDEX idx_daily_summary_content ON content_views_daily_summary (content_id, date DESC);

ALTER TABLE content_views_daily_summary ENABLE ROW LEVEL SECURITY;

-- Admin-only read access
CREATE POLICY "Admins can read daily summaries"
  ON content_views_daily_summary FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );


-- ─── 4B. Aggregation Function ────────────────────────────────────

CREATE OR REPLACE FUNCTION aggregate_daily_views(p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- Admin check
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  INSERT INTO content_views_daily_summary (
    content_id, date, view_count, unique_sessions, unique_viewers,
    avg_duration_ms, max_scroll_depth,
    referrer_direct, referrer_search, referrer_social, referrer_other,
    device_mobile, device_tablet, device_desktop
  )
  SELECT
    cv.content_id,
    p_date,
    count(*)::int,
    count(DISTINCT cv.session_id)::int,
    count(DISTINCT COALESCE(cv.viewer_id::text, cv.session_id))::int,
    COALESCE(round(avg(cv.view_duration_ms) FILTER (WHERE cv.view_duration_ms > 0)), 0)::int,
    COALESCE(max(cv.scroll_depth_percent), 0)::int,
    count(*) FILTER (WHERE COALESCE(cv.referrer_category, 'direct') = 'direct')::int,
    count(*) FILTER (WHERE cv.referrer_category = 'search')::int,
    count(*) FILTER (WHERE cv.referrer_category = 'social')::int,
    count(*) FILTER (WHERE cv.referrer_category = 'other')::int,
    count(*) FILTER (WHERE cv.device_type = 'mobile')::int,
    count(*) FILTER (WHERE cv.device_type = 'tablet')::int,
    count(*) FILTER (WHERE COALESCE(cv.device_type, 'desktop') = 'desktop')::int
  FROM content_views cv
  WHERE cv.created_at::date = p_date
  GROUP BY cv.content_id
  ON CONFLICT (content_id, date) DO UPDATE SET
    view_count       = EXCLUDED.view_count,
    unique_sessions  = EXCLUDED.unique_sessions,
    unique_viewers   = EXCLUDED.unique_viewers,
    avg_duration_ms  = EXCLUDED.avg_duration_ms,
    max_scroll_depth = EXCLUDED.max_scroll_depth,
    referrer_direct  = EXCLUDED.referrer_direct,
    referrer_search  = EXCLUDED.referrer_search,
    referrer_social  = EXCLUDED.referrer_social,
    referrer_other   = EXCLUDED.referrer_other,
    device_mobile    = EXCLUDED.device_mobile,
    device_tablet    = EXCLUDED.device_tablet,
    device_desktop   = EXCLUDED.device_desktop;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


-- ─── 4B. Archive Function ────────────────────────────────────────

CREATE OR REPLACE FUNCTION archive_old_content_views(p_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- Admin check
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Only delete raw views that have been aggregated into daily summaries
  DELETE FROM content_views cv
  WHERE cv.created_at < now() - (p_days || ' days')::interval
    AND EXISTS (
      SELECT 1 FROM content_views_daily_summary s
      WHERE s.content_id = cv.content_id
        AND s.date = cv.created_at::date
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Revoke from anon
REVOKE EXECUTE ON FUNCTION aggregate_daily_views(DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION archive_old_content_views(INTEGER) FROM anon;
