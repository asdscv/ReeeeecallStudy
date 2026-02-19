-- ═══════════════════════════════════════════════════════════════════
-- 026 – Analytics Completeness Fix
--
-- Fixes identified in data collection audit:
--   • page_views: add missing utm_term/content, referrer_domain/category
--   • analytics_events: add session_id param to RPC
--   • record_content_view: accept client-side referrer_domain/category
--   • CHECK constraints on content_views (duration, scroll)
--   • page_views_daily_summary table + aggregation
--   • admin_page_views_analytics() RPC
-- ═══════════════════════════════════════════════════════════════════

-- ─── Fix 1: page_views missing columns ───────────────────────────

ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_term          TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_content       TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS referrer_domain   TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS referrer_category TEXT;

CREATE INDEX IF NOT EXISTS idx_page_views_referrer_cat ON page_views (referrer_category) WHERE referrer_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_page_views_device ON page_views (device_type) WHERE device_type IS NOT NULL;


-- ─── Fix 2: CHECK constraints on content_views ──────────────────

ALTER TABLE content_views
  ADD CONSTRAINT chk_content_views_duration
    CHECK (view_duration_ms >= 0 AND view_duration_ms <= 3600000);

ALTER TABLE content_views
  ADD CONSTRAINT chk_content_views_scroll
    CHECK (scroll_depth_percent >= 0 AND scroll_depth_percent <= 100);


-- ─── Fix 3: record_page_view with all columns ───────────────────

CREATE OR REPLACE FUNCTION record_page_view(
  p_page_path        TEXT,
  p_session_id       TEXT DEFAULT NULL,
  p_referrer         TEXT DEFAULT NULL,
  p_referrer_domain  TEXT DEFAULT NULL,
  p_referrer_category TEXT DEFAULT NULL,
  p_utm_source       TEXT DEFAULT NULL,
  p_utm_medium       TEXT DEFAULT NULL,
  p_utm_campaign     TEXT DEFAULT NULL,
  p_utm_term         TEXT DEFAULT NULL,
  p_utm_content      TEXT DEFAULT NULL,
  p_device_type      TEXT DEFAULT NULL,
  p_viewport_width   INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO page_views (
    page_path, viewer_id, session_id, referrer,
    referrer_domain, referrer_category,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    device_type, viewport_width
  )
  VALUES (
    LEFT(p_page_path, 500),
    auth.uid(),
    LEFT(p_session_id, 100),
    LEFT(p_referrer, 2048),
    LEFT(p_referrer_domain, 255),
    COALESCE(p_referrer_category, 'direct'),
    LEFT(p_utm_source, 200),
    LEFT(p_utm_medium, 200),
    LEFT(p_utm_campaign, 200),
    LEFT(p_utm_term, 200),
    LEFT(p_utm_content, 200),
    p_device_type,
    p_viewport_width
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- ─── Fix 4: record_content_view accepts client-side referrer ─────

CREATE OR REPLACE FUNCTION record_content_view(
  p_content_id       UUID,
  p_session_id       TEXT DEFAULT NULL,
  p_referrer         TEXT DEFAULT NULL,
  p_referrer_domain  TEXT DEFAULT NULL,
  p_referrer_category TEXT DEFAULT NULL,
  p_utm_source       TEXT DEFAULT NULL,
  p_utm_medium       TEXT DEFAULT NULL,
  p_utm_campaign     TEXT DEFAULT NULL,
  p_utm_term         TEXT DEFAULT NULL,
  p_utm_content      TEXT DEFAULT NULL,
  p_device_type      TEXT DEFAULT NULL,
  p_viewport_width   INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_session TEXT;
  v_referrer TEXT;
BEGIN
  -- Validate content exists and is published
  IF NOT EXISTS (
    SELECT 1 FROM contents
    WHERE id = p_content_id AND is_published = true
  ) THEN
    RETURN NULL;
  END IF;

  -- Truncate inputs
  v_session  := LEFT(p_session_id, 100);
  v_referrer := LEFT(p_referrer, 2048);

  -- Dedup — if same session+content already exists, return existing id
  INSERT INTO content_views (
    content_id, viewer_id, session_id, referrer,
    referrer_domain, referrer_category,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    device_type, viewport_width
  )
  VALUES (
    p_content_id, auth.uid(), v_session, v_referrer,
    LEFT(p_referrer_domain, 255),
    COALESCE(p_referrer_category, 'direct'),
    LEFT(p_utm_source, 200), LEFT(p_utm_medium, 200), LEFT(p_utm_campaign, 200),
    LEFT(p_utm_term, 200), LEFT(p_utm_content, 200),
    p_device_type, p_viewport_width
  )
  ON CONFLICT (session_id, content_id) WHERE session_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  -- If INSERT was skipped (duplicate), fetch existing view id
  IF v_id IS NULL AND v_session IS NOT NULL THEN
    SELECT id INTO v_id
    FROM content_views
    WHERE session_id = v_session AND content_id = p_content_id
    LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;


-- ─── Fix 5: record_analytics_event with session_id ───────────────

CREATE OR REPLACE FUNCTION record_analytics_event(
  p_category    TEXT,
  p_action      TEXT,
  p_label       TEXT DEFAULT NULL,
  p_value       NUMERIC DEFAULT NULL,
  p_page_path   TEXT DEFAULT NULL,
  p_session_id  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Validate required fields
  IF p_category IS NULL OR TRIM(p_category) = '' OR p_action IS NULL OR TRIM(p_action) = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO analytics_events (
    user_id, session_id, category, action, label, value, page_path
  )
  VALUES (
    auth.uid(),
    LEFT(p_session_id, 100),
    LEFT(TRIM(p_category), 100),
    LEFT(TRIM(p_action), 100),
    LEFT(p_label, 200),
    p_value,
    LEFT(p_page_path, 500)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- ─── Fix 6: page_views_daily_summary ─────────────────────────────

CREATE TABLE IF NOT EXISTS page_views_daily_summary (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_path         TEXT NOT NULL,
  date              DATE NOT NULL,
  view_count        INTEGER NOT NULL DEFAULT 0,
  unique_sessions   INTEGER NOT NULL DEFAULT 0,
  unique_viewers    INTEGER NOT NULL DEFAULT 0,
  referrer_direct   INTEGER NOT NULL DEFAULT 0,
  referrer_search   INTEGER NOT NULL DEFAULT 0,
  referrer_social   INTEGER NOT NULL DEFAULT 0,
  referrer_other    INTEGER NOT NULL DEFAULT 0,
  device_mobile     INTEGER NOT NULL DEFAULT 0,
  device_tablet     INTEGER NOT NULL DEFAULT 0,
  device_desktop    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_path, date)
);

CREATE INDEX IF NOT EXISTS idx_page_daily_summary_date ON page_views_daily_summary (date DESC);

ALTER TABLE page_views_daily_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read page daily summaries"
  ON page_views_daily_summary FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );


-- ─── Fix 7: aggregate_daily_page_views ───────────────────────────

CREATE OR REPLACE FUNCTION aggregate_daily_page_views(p_date DATE)
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

  INSERT INTO page_views_daily_summary (
    page_path, date, view_count, unique_sessions, unique_viewers,
    referrer_direct, referrer_search, referrer_social, referrer_other,
    device_mobile, device_tablet, device_desktop
  )
  SELECT
    pv.page_path,
    p_date,
    count(*)::int,
    count(DISTINCT pv.session_id)::int,
    count(DISTINCT COALESCE(pv.viewer_id::text, pv.session_id))::int,
    count(*) FILTER (WHERE COALESCE(pv.referrer_category, 'direct') = 'direct')::int,
    count(*) FILTER (WHERE pv.referrer_category = 'search')::int,
    count(*) FILTER (WHERE pv.referrer_category = 'social')::int,
    count(*) FILTER (WHERE pv.referrer_category = 'other')::int,
    count(*) FILTER (WHERE pv.device_type = 'mobile')::int,
    count(*) FILTER (WHERE pv.device_type = 'tablet')::int,
    count(*) FILTER (WHERE COALESCE(pv.device_type, 'desktop') = 'desktop')::int
  FROM page_views pv
  WHERE pv.created_at::date = p_date
  GROUP BY pv.page_path
  ON CONFLICT (page_path, date) DO UPDATE SET
    view_count       = EXCLUDED.view_count,
    unique_sessions  = EXCLUDED.unique_sessions,
    unique_viewers   = EXCLUDED.unique_viewers,
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

REVOKE EXECUTE ON FUNCTION aggregate_daily_page_views(DATE) FROM anon;


-- ─── Fix 8: admin_page_views_analytics() ─────────────────────────

CREATE OR REPLACE FUNCTION admin_page_views_analytics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Admin check
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT json_build_object(
    'total_page_views',
      (SELECT count(*)::int FROM page_views),
    'unique_visitors',
      (SELECT count(DISTINCT COALESCE(viewer_id::text, session_id))::int FROM page_views),
    'top_pages',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            page_path,
            count(*)::int AS view_count,
            count(DISTINCT COALESCE(viewer_id::text, session_id))::int AS unique_visitors
          FROM page_views
          GROUP BY page_path
          ORDER BY view_count DESC
          LIMIT 20
        ) t
      ), '[]'::json),
    'daily_page_views',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            created_at::date::text AS date,
            count(*)::int AS views,
            count(DISTINCT COALESCE(viewer_id::text, session_id))::int AS unique_visitors
          FROM page_views
          WHERE created_at >= now() - interval '30 days'
          GROUP BY created_at::date
          ORDER BY date
        ) t
      ), '[]'::json),
    'referrer_breakdown',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT COALESCE(referrer_category, 'direct') AS category, count(*)::int AS count
          FROM page_views
          GROUP BY COALESCE(referrer_category, 'direct')
          ORDER BY count DESC
        ) t
      ), '[]'::json),
    'device_breakdown',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT COALESCE(device_type, 'desktop') AS device_type, count(*)::int AS count
          FROM page_views
          GROUP BY COALESCE(device_type, 'desktop')
          ORDER BY count DESC
        ) t
      ), '[]'::json),
    'utm_sources',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT utm_source, count(*)::int AS count
          FROM page_views
          WHERE utm_source IS NOT NULL
          GROUP BY utm_source
          ORDER BY count DESC
          LIMIT 10
        ) t
      ), '[]'::json),
    'bounce_rate',
      COALESCE((
        SELECT json_build_object(
          'total_content_views', count(*)::int,
          'bounced_views', count(*) FILTER (
            WHERE view_duration_ms < 2000 OR view_duration_ms IS NULL OR view_duration_ms = 0
          )::int,
          'engaged_views', count(*) FILTER (
            WHERE view_duration_ms >= 2000
          )::int
        )
        FROM content_views
      ), json_build_object('total_content_views', 0, 'bounced_views', 0, 'engaged_views', 0))
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_page_views_analytics() FROM anon;
