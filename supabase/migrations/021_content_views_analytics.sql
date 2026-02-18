-- ═══════════════════════════════════════════════════════════════════
-- 021 – Content Views & Analytics
--
-- Creates:
--   • content_views table (view tracking)
--   • record_content_view() RPC (public – needed for anonymous pages)
--   • update_content_view_duration() RPC (public – sendBeacon)
--   • admin_content_analytics() RPC (admin-only)
-- ═══════════════════════════════════════════════════════════════════

-- ─── 2A. content_views table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  UUID NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  viewer_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id  TEXT,
  view_duration_ms INTEGER DEFAULT 0,
  referrer    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_views_content_date ON content_views (content_id, created_at DESC);
CREATE INDEX idx_content_views_date         ON content_views (created_at DESC);
CREATE INDEX idx_content_views_content_viewer ON content_views (content_id, viewer_id);
CREATE INDEX idx_content_views_content_session ON content_views (content_id, session_id);

ALTER TABLE content_views ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (view tracking on public pages)
CREATE POLICY "Anyone can insert content views"
  ON content_views FOR INSERT
  WITH CHECK (true);

-- Only admins can read
CREATE POLICY "Admins can read content views"
  ON content_views FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );


-- ─── 2B. record_content_view() ──────────────────────────────────

CREATE OR REPLACE FUNCTION record_content_view(
  p_content_id UUID,
  p_session_id TEXT DEFAULT NULL,
  p_referrer   TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO content_views (content_id, viewer_id, session_id, referrer)
  VALUES (p_content_id, auth.uid(), p_session_id, p_referrer)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- ─── 2C. update_content_view_duration() ─────────────────────────

CREATE OR REPLACE FUNCTION update_content_view_duration(
  p_view_id     UUID,
  p_duration_ms INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE content_views
  SET view_duration_ms = LEAST(p_duration_ms, 3600000) -- cap at 1 hour
  WHERE id = p_view_id;
END;
$$;


-- ─── 2D. admin_content_analytics() ─────────────────────────────

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
          SELECT
            locale,
            count(*)::int AS count,
            count(*) FILTER (WHERE is_published = true)::int AS published
          FROM contents
          GROUP BY locale
          ORDER BY count DESC
        ) t
      ), '[]'::json),
    'top_tags',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT tag, count(*)::int AS count
          FROM contents, unnest(tags) AS tag
          GROUP BY tag
          ORDER BY count DESC
          LIMIT 15
        ) t
      ), '[]'::json),
    'publishing_timeline',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            to_char(published_at, 'YYYY-MM') AS month,
            count(*)::int AS count
          FROM contents
          WHERE published_at IS NOT NULL
          GROUP BY to_char(published_at, 'YYYY-MM')
          ORDER BY month
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
          SELECT
            c.id,
            c.title,
            c.slug,
            c.locale,
            count(cv.id)::int AS view_count,
            count(DISTINCT COALESCE(cv.viewer_id::text, cv.session_id))::int AS unique_viewers,
            COALESCE(round(avg(cv.view_duration_ms) FILTER (WHERE cv.view_duration_ms > 0)), 0)::int AS avg_duration_ms
          FROM contents c
          LEFT JOIN content_views cv ON cv.content_id = c.id
          GROUP BY c.id
          ORDER BY view_count DESC
          LIMIT 10
        ) t
      ), '[]'::json),
    'daily_views',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            created_at::date::text AS date,
            count(*)::int AS views,
            count(DISTINCT COALESCE(viewer_id::text, session_id))::int AS unique_viewers
          FROM content_views
          WHERE created_at >= now() - interval '30 days'
          GROUP BY created_at::date
          ORDER BY date
        ) t
      ), '[]'::json),
    'recent_published',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT
            id,
            title,
            slug,
            locale,
            published_at,
            reading_time_minutes,
            tags
          FROM contents
          WHERE is_published = true
          ORDER BY published_at DESC
          LIMIT 5
        ) t
      ), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Revoke admin_content_analytics from anon
REVOKE EXECUTE ON FUNCTION admin_content_analytics() FROM anon;
