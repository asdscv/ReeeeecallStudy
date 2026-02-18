-- ═══════════════════════════════════════════════════════
-- 020_admin_content_stats_contents.sql
--
-- Problem: admin_content_stats() only returned marketplace
-- listing/share data. The `contents` table (learning
-- insights / blog posts visible on /content) was tracked
-- only in admin_system_stats(), causing confusion in
-- the admin Content tab.
--
-- Fix: Add total_contents and published_contents to
-- admin_content_stats() so all content metrics appear
-- in one place.
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_content_stats()
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_listings', (SELECT COUNT(*) FROM marketplace_listings),
    'active_listings', (SELECT COUNT(*) FROM marketplace_listings WHERE is_active = true),
    'total_acquires', (SELECT COALESCE(SUM(acquire_count), 0) FROM marketplace_listings),
    'total_shares', (SELECT COUNT(*) FROM deck_shares),
    'active_shares', (SELECT COUNT(*) FROM deck_shares WHERE status = 'active'),
    'share_by_mode', COALESCE((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT share_mode AS mode, COUNT(*) AS count
        FROM deck_shares
        GROUP BY share_mode
      ) t
    ), '[]'::JSON),
    'top_categories', COALESCE((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT category, COUNT(*) AS count
        FROM marketplace_listings
        WHERE is_active = true
        GROUP BY category
        ORDER BY count DESC
        LIMIT 10
      ) t
    ), '[]'::JSON),
    'total_contents', (SELECT COUNT(*) FROM contents),
    'published_contents', (SELECT COUNT(*) FROM contents WHERE is_published = true)
  ) INTO result;

  RETURN COALESCE(result, '{}'::JSON);
END;
$$;
