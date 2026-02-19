-- ═══════════════════════════════════════════════════════════════════
-- 023 – Analytics Depth
--
-- Phase 3: Analysis Depth
--   • UTM parameter columns on content_views
--   • Scroll depth tracking
--   • Device/browser metadata
--   • Referrer domain extraction
--   • Extended admin_content_analytics() with new aggregations
-- ═══════════════════════════════════════════════════════════════════

-- ─── 3A. UTM Parameter Columns ───────────────────────────────────

ALTER TABLE content_views ADD COLUMN IF NOT EXISTS utm_source  TEXT;
ALTER TABLE content_views ADD COLUMN IF NOT EXISTS utm_medium  TEXT;
ALTER TABLE content_views ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE content_views ADD COLUMN IF NOT EXISTS utm_term    TEXT;
ALTER TABLE content_views ADD COLUMN IF NOT EXISTS utm_content TEXT;

-- ─── 3B. Scroll Depth ────────────────────────────────────────────

ALTER TABLE content_views ADD COLUMN IF NOT EXISTS scroll_depth_percent INTEGER DEFAULT 0;

-- ─── 3C. Device/Browser Metadata ─────────────────────────────────

ALTER TABLE content_views ADD COLUMN IF NOT EXISTS device_type     TEXT;
ALTER TABLE content_views ADD COLUMN IF NOT EXISTS viewport_width  INTEGER;

-- ─── 3D. Referrer Domain Extraction ──────────────────────────────

ALTER TABLE content_views ADD COLUMN IF NOT EXISTS referrer_domain   TEXT;
ALTER TABLE content_views ADD COLUMN IF NOT EXISTS referrer_category TEXT;

-- Indexes for new columns used in aggregation
CREATE INDEX IF NOT EXISTS idx_content_views_device ON content_views (device_type) WHERE device_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_views_referrer_cat ON content_views (referrer_category) WHERE referrer_category IS NOT NULL;


-- ─── 3A+3C+3D. Update record_content_view ───────────────────────

CREATE OR REPLACE FUNCTION record_content_view(
  p_content_id     UUID,
  p_session_id     TEXT DEFAULT NULL,
  p_referrer       TEXT DEFAULT NULL,
  p_utm_source     TEXT DEFAULT NULL,
  p_utm_medium     TEXT DEFAULT NULL,
  p_utm_campaign   TEXT DEFAULT NULL,
  p_utm_term       TEXT DEFAULT NULL,
  p_utm_content    TEXT DEFAULT NULL,
  p_device_type    TEXT DEFAULT NULL,
  p_viewport_width INTEGER DEFAULT NULL
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
  v_ref_domain TEXT;
  v_ref_category TEXT;
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

  -- Extract referrer domain
  BEGIN
    IF v_referrer IS NOT NULL AND v_referrer <> '' THEN
      v_ref_domain := substring(v_referrer from '://([^/]+)');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ref_domain := NULL;
  END;

  -- Categorize referrer
  IF v_ref_domain IS NULL OR v_ref_domain = '' THEN
    v_ref_category := 'direct';
  ELSIF v_ref_domain ~* '(google|bing|yahoo|duckduckgo|baidu|yandex|naver|daum)' THEN
    v_ref_category := 'search';
  ELSIF v_ref_domain ~* '(facebook|twitter|t\.co|instagram|linkedin|reddit|youtube|tiktok)' THEN
    v_ref_category := 'social';
  ELSE
    v_ref_category := 'other';
  END IF;

  -- Dedup — if same session+content already exists, return existing id
  INSERT INTO content_views (
    content_id, viewer_id, session_id, referrer,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    device_type, viewport_width,
    referrer_domain, referrer_category
  )
  VALUES (
    p_content_id, auth.uid(), v_session, v_referrer,
    LEFT(p_utm_source, 200), LEFT(p_utm_medium, 200), LEFT(p_utm_campaign, 200),
    LEFT(p_utm_term, 200), LEFT(p_utm_content, 200),
    p_device_type, p_viewport_width,
    v_ref_domain, v_ref_category
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


-- ─── 3B. Update update_content_view_duration to include scroll depth ──

CREATE OR REPLACE FUNCTION update_content_view_duration(
  p_view_id      UUID,
  p_duration_ms  INTEGER,
  p_scroll_depth INTEGER DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Minimum 2s duration filter
  IF p_duration_ms < 2000 THEN
    RETURN;
  END IF;

  -- Ownership check + duration cap + scroll depth
  UPDATE content_views
  SET
    view_duration_ms = LEAST(p_duration_ms, 3600000),
    scroll_depth_percent = GREATEST(
      COALESCE(scroll_depth_percent, 0),
      LEAST(COALESCE(p_scroll_depth, 0), 100)
    )
  WHERE id = p_view_id
    AND (viewer_id = auth.uid() OR viewer_id IS NULL);
END;
$$;


-- ─── 3E. Extended admin_content_analytics() ──────────────────────

CREATE OR REPLACE FUNCTION admin_content_analytics()
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
    'total_contents',
      (SELECT count(*) FROM contents),
    'published_contents',
      (SELECT count(*) FROM contents WHERE is_published = true),
    'draft_contents',
      (SELECT count(*) FROM contents WHERE is_published = false),
    'by_locale',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT locale, count(*)::int AS count,
                 count(*) FILTER (WHERE is_published = true)::int AS published
          FROM contents GROUP BY locale ORDER BY count DESC
        ) t
      ), '[]'::json),
    'top_tags',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT tag, count(*)::int AS count
          FROM contents, unnest(tags) AS tag
          GROUP BY tag ORDER BY count DESC LIMIT 15
        ) t
      ), '[]'::json),
    'publishing_timeline',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT to_char(published_at, 'YYYY-MM') AS month, count(*)::int AS count
          FROM contents WHERE published_at IS NOT NULL
          GROUP BY to_char(published_at, 'YYYY-MM') ORDER BY month
        ) t
      ), '[]'::json),
    'avg_reading_time_minutes',
      COALESCE((SELECT round(avg(reading_time_minutes)::numeric, 1) FROM contents WHERE is_published = true), 0),
    'total_views',
      (SELECT count(*)::int FROM content_views),
    'unique_viewers',
      (SELECT count(DISTINCT COALESCE(viewer_id::text, session_id))::int FROM content_views),
    'avg_view_duration_ms',
      COALESCE((SELECT round(avg(view_duration_ms)) FROM content_views WHERE view_duration_ms > 0), 0),
    'popular_content',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT c.id, c.title, c.slug, c.locale,
                 count(cv.id)::int AS view_count,
                 count(DISTINCT COALESCE(cv.viewer_id::text, cv.session_id))::int AS unique_viewers,
                 COALESCE(round(avg(cv.view_duration_ms) FILTER (WHERE cv.view_duration_ms > 0)), 0)::int AS avg_duration_ms
          FROM contents c LEFT JOIN content_views cv ON cv.content_id = c.id
          GROUP BY c.id ORDER BY view_count DESC LIMIT 10
        ) t
      ), '[]'::json),
    'daily_views',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT created_at::date::text AS date,
                 count(*)::int AS views,
                 count(DISTINCT COALESCE(viewer_id::text, session_id))::int AS unique_viewers
          FROM content_views WHERE created_at >= now() - interval '30 days'
          GROUP BY created_at::date ORDER BY date
        ) t
      ), '[]'::json),
    'recent_published',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT id, title, slug, locale, published_at, reading_time_minutes, tags
          FROM contents WHERE is_published = true
          ORDER BY published_at DESC LIMIT 5
        ) t
      ), '[]'::json),
    -- Phase 3 additions
    'referrer_breakdown',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT COALESCE(referrer_category, 'direct') AS category, count(*)::int AS count
          FROM content_views
          GROUP BY COALESCE(referrer_category, 'direct')
          ORDER BY count DESC
        ) t
      ), '[]'::json),
    'device_breakdown',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT COALESCE(device_type, 'desktop') AS device_type, count(*)::int AS count
          FROM content_views
          GROUP BY COALESCE(device_type, 'desktop')
          ORDER BY count DESC
        ) t
      ), '[]'::json),
    'scroll_depth',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            CASE
              WHEN scroll_depth_percent >= 100 THEN 100
              WHEN scroll_depth_percent >= 75 THEN 75
              WHEN scroll_depth_percent >= 50 THEN 50
              WHEN scroll_depth_percent >= 25 THEN 25
              ELSE 0
            END AS milestone,
            count(*)::int AS count
          FROM content_views
          GROUP BY milestone
          ORDER BY milestone
        ) t
      ), '[]'::json),
    'conversion_funnel',
      json_build_object(
        'content_viewers',
          (SELECT count(DISTINCT COALESCE(viewer_id::text, session_id))::int FROM content_views),
        'signed_up',
          (SELECT count(DISTINCT viewer_id)::int FROM content_views WHERE viewer_id IS NOT NULL),
        'created_deck',
          (SELECT count(DISTINCT user_id)::int FROM decks
           WHERE user_id IN (SELECT DISTINCT viewer_id FROM content_views WHERE viewer_id IS NOT NULL)),
        'studied_cards',
          (SELECT count(DISTINCT user_id)::int FROM study_logs
           WHERE user_id IN (SELECT DISTINCT viewer_id FROM content_views WHERE viewer_id IS NOT NULL))
      )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Revoke from anon
REVOKE EXECUTE ON FUNCTION admin_content_analytics() FROM anon;
