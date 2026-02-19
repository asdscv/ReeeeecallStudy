-- ═══════════════════════════════════════════════════════════════════
-- 029 – Page Views Analytics Enterprise Fixes
--
--   • admin_page_views_analytics(): add 30-day date bounds to all
--     aggregate queries (matches admin_content_analytics pattern)
--   • page_views: add UNIQUE INDEX on (session_id, page_path) for
--     session-level dedup
--   • record_page_view(): add ON CONFLICT ... DO NOTHING dedup
-- ═══════════════════════════════════════════════════════════════════

-- ─── Fix 1: page_views session dedup index ───────────────────────

-- Delete existing duplicates before creating unique index
DELETE FROM page_views a
USING page_views b
WHERE a.id > b.id
  AND a.session_id IS NOT NULL
  AND a.session_id = b.session_id
  AND a.page_path = b.page_path;

CREATE UNIQUE INDEX IF NOT EXISTS idx_page_views_session_path_uniq
  ON page_views (session_id, page_path)
  WHERE session_id IS NOT NULL;


-- ─── Fix 2: record_page_view with ON CONFLICT dedup ─────────────

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
  v_session TEXT;
BEGIN
  v_session := LEFT(p_session_id, 100);

  INSERT INTO page_views (
    page_path, viewer_id, session_id, referrer,
    referrer_domain, referrer_category,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    device_type, viewport_width
  )
  VALUES (
    LEFT(p_page_path, 500),
    auth.uid(),
    v_session,
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
  ON CONFLICT (session_id, page_path) WHERE session_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  -- If INSERT was skipped (duplicate), fetch existing view id
  IF v_id IS NULL AND v_session IS NOT NULL THEN
    SELECT id INTO v_id
    FROM page_views
    WHERE session_id = v_session AND page_path = LEFT(p_page_path, 500)
    LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;


-- ─── Fix 3: admin_page_views_analytics with 30-day bounds ────────

CREATE OR REPLACE FUNCTION admin_page_views_analytics()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_since TIMESTAMPTZ := now() - interval '30 days';
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
      (SELECT count(*)::int FROM page_views WHERE created_at >= v_since),
    'unique_visitors',
      (SELECT count(DISTINCT COALESCE(viewer_id::text, session_id))::int
       FROM page_views WHERE created_at >= v_since),
    'top_pages',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            page_path,
            count(*)::int AS view_count,
            count(DISTINCT COALESCE(viewer_id::text, session_id))::int AS unique_visitors
          FROM page_views
          WHERE created_at >= v_since
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
          WHERE created_at >= v_since
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
          WHERE created_at >= v_since
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
          WHERE created_at >= v_since
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
          WHERE utm_source IS NOT NULL AND created_at >= v_since
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
        WHERE created_at >= v_since
      ), json_build_object('total_content_views', 0, 'bounced_views', 0, 'engaged_views', 0))
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_page_views_analytics() FROM anon;
