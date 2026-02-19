-- ═══════════════════════════════════════════════════════════════════
-- 027 – UTM Source Attribution & CTA Click Tracking
--
-- Adds:
--   • utm_source_breakdown to admin_content_analytics()
--   • cta_clicks query from analytics_events
-- ═══════════════════════════════════════════════════════════════════

-- ─── Update admin_content_analytics() with UTM & CTA data ──────

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
      ),
    -- NEW: UTM source attribution
    'utm_source_breakdown',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT COALESCE(utm_source, 'organic') AS source,
                 count(*)::int AS count
          FROM content_views
          GROUP BY COALESCE(utm_source, 'organic')
          ORDER BY count DESC
          LIMIT 15
        ) t
      ), '[]'::json),
    -- NEW: CTA click count from analytics_events
    'cta_clicks',
      COALESCE((
        SELECT count(*)::int
        FROM analytics_events
        WHERE category = 'content' AND action = 'cta_click'
      ), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_content_analytics() FROM anon;
