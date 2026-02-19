-- ═══════════════════════════════════════════════════════════════════
-- 028 – Analytics Enterprise-Grade Fixes
--
-- Consolidated fixes:
--   • Performance: indexes on utm_source, created_at for content_views
--   • Performance: admin_content_analytics() with date-bounded queries
--   •              and EXISTS instead of IN for conversion funnel
--   • Cleanup: drop stale 2-param update_content_view_duration overload
--   • Logic: utm_source '(none)' label instead of misleading 'organic'
--   • Security: restrict direct INSERT on content_views, page_views,
--              analytics_events to only via SECURITY DEFINER RPCs
-- ═══════════════════════════════════════════════════════════════════


-- ─── 1. Performance indexes ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_content_views_utm_source
  ON content_views (utm_source) WHERE utm_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_views_created_at
  ON content_views (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_views_viewer_id
  ON content_views (viewer_id) WHERE viewer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_events_category_action
  ON analytics_events (category, action);


-- ─── 2. Drop stale 2-param overload of update_content_view_duration ─

DROP FUNCTION IF EXISTS update_content_view_duration(UUID, INTEGER);


-- ─── 3. Security: tighten INSERT policies ──────────────────────────
-- Replace open INSERT WITH CHECK (true) with restricted policies
-- that only allow inserts through the SECURITY DEFINER RPCs.
-- Since RPCs use SECURITY DEFINER, they bypass RLS, so we can safely
-- restrict direct INSERT access.

-- content_views: drop old open policy, create restrictive one
DROP POLICY IF EXISTS "Anyone can insert content views" ON content_views;
CREATE POLICY "Insert content views via RPC only"
  ON content_views FOR INSERT
  WITH CHECK (false);

-- page_views: same pattern
DROP POLICY IF EXISTS "Anyone can insert page views" ON page_views;
CREATE POLICY "Insert page views via RPC only"
  ON page_views FOR INSERT
  WITH CHECK (false);

-- analytics_events: same pattern
DROP POLICY IF EXISTS "Anyone can insert analytics events" ON analytics_events;
CREATE POLICY "Insert analytics events via RPC only"
  ON analytics_events FOR INSERT
  WITH CHECK (false);


-- ─── 4. admin_content_analytics() – enterprise rewrite ─────────────
-- Fixes:
--   • All aggregations bounded to 30 days (consistent with daily_views)
--   • Conversion funnel uses EXISTS (not IN) for performance
--   • utm_source NULL → '(none)' instead of 'organic'
--   • Includes utm_source_breakdown and cta_clicks

CREATE OR REPLACE FUNCTION admin_content_analytics()
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
    -- ── Content counts (all-time, fast on small table) ──
    'total_contents',
      (SELECT count(*)::int FROM contents),
    'published_contents',
      (SELECT count(*)::int FROM contents WHERE is_published = true),
    'draft_contents',
      (SELECT count(*)::int FROM contents WHERE is_published = false),

    -- ── Locale breakdown (all-time, small table) ──
    'by_locale',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT locale, count(*)::int AS count,
                 count(*) FILTER (WHERE is_published = true)::int AS published
          FROM contents GROUP BY locale ORDER BY count DESC
        ) t
      ), '[]'::json),

    -- ── Top tags (all-time, small table) ──
    'top_tags',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT tag, count(*)::int AS count
          FROM contents, unnest(tags) AS tag
          GROUP BY tag ORDER BY count DESC LIMIT 15
        ) t
      ), '[]'::json),

    -- ── Publishing timeline (all-time, small table) ──
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
      COALESCE((SELECT round(avg(reading_time_minutes)::numeric, 1)
                FROM contents WHERE is_published = true), 0),

    -- ── View stats (30 days for consistency) ──
    'total_views',
      (SELECT count(*)::int FROM content_views WHERE created_at >= v_since),
    'unique_viewers',
      (SELECT count(DISTINCT COALESCE(viewer_id::text, session_id))::int
       FROM content_views WHERE created_at >= v_since),
    'avg_view_duration_ms',
      COALESCE((SELECT round(avg(view_duration_ms))
                FROM content_views
                WHERE view_duration_ms > 0 AND created_at >= v_since), 0),

    -- ── Popular content (30 days) ──
    'popular_content',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT c.id, c.title, c.slug, c.locale,
                 count(cv.id)::int AS view_count,
                 count(DISTINCT COALESCE(cv.viewer_id::text, cv.session_id))::int AS unique_viewers,
                 COALESCE(round(avg(cv.view_duration_ms)
                   FILTER (WHERE cv.view_duration_ms > 0)), 0)::int AS avg_duration_ms
          FROM contents c
          LEFT JOIN content_views cv ON cv.content_id = c.id AND cv.created_at >= v_since
          GROUP BY c.id ORDER BY view_count DESC LIMIT 10
        ) t
      ), '[]'::json),

    -- ── Daily views (30 days) ──
    'daily_views',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT created_at::date::text AS date,
                 count(*)::int AS views,
                 count(DISTINCT COALESCE(viewer_id::text, session_id))::int AS unique_viewers
          FROM content_views WHERE created_at >= v_since
          GROUP BY created_at::date ORDER BY date
        ) t
      ), '[]'::json),

    -- ── Recent published (all-time, LIMIT 5) ──
    'recent_published',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT id, title, slug, locale, published_at, reading_time_minutes, tags
          FROM contents WHERE is_published = true
          ORDER BY published_at DESC LIMIT 5
        ) t
      ), '[]'::json),

    -- ── Referrer breakdown (30 days) ──
    'referrer_breakdown',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT COALESCE(referrer_category, 'direct') AS category,
                 count(*)::int AS count
          FROM content_views
          WHERE created_at >= v_since
          GROUP BY COALESCE(referrer_category, 'direct')
          ORDER BY count DESC
        ) t
      ), '[]'::json),

    -- ── Device breakdown (30 days) ──
    'device_breakdown',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT COALESCE(device_type, 'desktop') AS device_type,
                 count(*)::int AS count
          FROM content_views
          WHERE created_at >= v_since
          GROUP BY COALESCE(device_type, 'desktop')
          ORDER BY count DESC
        ) t
      ), '[]'::json),

    -- ── Scroll depth (30 days) ──
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
          WHERE created_at >= v_since
          GROUP BY milestone
          ORDER BY milestone
        ) t
      ), '[]'::json),

    -- ── Conversion funnel (all-time, uses EXISTS for performance) ──
    'conversion_funnel',
      json_build_object(
        'content_viewers',
          (SELECT count(DISTINCT COALESCE(viewer_id::text, session_id))::int
           FROM content_views),
        'signed_up',
          (SELECT count(DISTINCT viewer_id)::int
           FROM content_views WHERE viewer_id IS NOT NULL),
        'created_deck',
          (SELECT count(DISTINCT d.user_id)::int
           FROM decks d
           WHERE EXISTS (
             SELECT 1 FROM content_views cv
             WHERE cv.viewer_id = d.user_id AND cv.viewer_id IS NOT NULL
           )),
        'studied_cards',
          (SELECT count(DISTINCT sl.user_id)::int
           FROM study_logs sl
           WHERE EXISTS (
             SELECT 1 FROM content_views cv
             WHERE cv.viewer_id = sl.user_id AND cv.viewer_id IS NOT NULL
           ))
      ),

    -- ── UTM source breakdown (30 days) ──
    'utm_source_breakdown',
      COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT COALESCE(utm_source, '(none)') AS source,
                 count(*)::int AS count
          FROM content_views
          WHERE created_at >= v_since
          GROUP BY COALESCE(utm_source, '(none)')
          ORDER BY count DESC
          LIMIT 15
        ) t
      ), '[]'::json),

    -- ── CTA clicks (30 days) ──
    'cta_clicks',
      COALESCE((
        SELECT count(*)::int
        FROM analytics_events
        WHERE category = 'content'
          AND action = 'cta_click'
          AND created_at >= v_since
      ), 0)

  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_content_analytics() FROM anon;
