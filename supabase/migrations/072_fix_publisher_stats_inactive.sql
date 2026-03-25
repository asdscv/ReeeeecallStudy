-- ═══════════════════════════════════════════════════════
-- Migration 072: Fix get_publisher_stats to exclude inactive listings
-- ═══════════════════════════════════════════════════════
-- Problem: listings array included inactive/unpublished decks
-- because it lacked is_active filter (unlike total_listings).
-- Also affected: total_views, total_acquires, avg_conversion_rate
-- counted inactive listings' stats.
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_publisher_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result JSON;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT json_build_object(
    'total_listings',
      (SELECT count(*)::int FROM marketplace_listings WHERE owner_id = v_user_id AND is_active = true),
    'total_views',
      (SELECT COALESCE(sum(view_count), 0)::int FROM marketplace_listings WHERE owner_id = v_user_id AND is_active = true),
    'total_acquires',
      (SELECT COALESCE(sum(acquire_count), 0)::int FROM marketplace_listings WHERE owner_id = v_user_id AND is_active = true),
    'avg_conversion_rate',
      (SELECT CASE
        WHEN COALESCE(sum(view_count), 0) = 0 THEN 0
        ELSE ROUND((COALESCE(sum(acquire_count), 0)::numeric / sum(view_count) * 100), 2)
      END FROM marketplace_listings WHERE owner_id = v_user_id AND is_active = true),
    'listings',
      COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.created_at DESC)
        FROM (
          SELECT
            ml.id,
            ml.title,
            ml.is_active,
            ml.view_count,
            ml.acquire_count,
            ml.card_count,
            ml.share_mode,
            ml.category,
            COALESCE(ml.avg_rating, 0) AS avg_rating,
            COALESCE(ml.review_count, 0) AS review_count,
            ml.created_at,
            CASE
              WHEN COALESCE(ml.view_count, 0) = 0 THEN 0
              ELSE ROUND((COALESCE(ml.acquire_count, 0)::numeric / ml.view_count * 100), 2)
            END AS conversion_rate
          FROM marketplace_listings ml
          WHERE ml.owner_id = v_user_id AND ml.is_active = true
        ) t
      ), '[]'::json),
    'daily_views',
      COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.date)
        FROM (
          SELECT
            mv.created_at::date::text AS date,
            count(*)::int AS views,
            count(DISTINCT COALESCE(mv.viewer_id::text, mv.session_id))::int AS unique_viewers
          FROM marketplace_views mv
          JOIN marketplace_listings ml ON ml.id = mv.listing_id
          WHERE ml.owner_id = v_user_id AND ml.is_active = true
            AND mv.created_at >= (NOW() - INTERVAL '30 days')
          GROUP BY mv.created_at::date
        ) t
      ), '[]'::json),
    'top_listings',
      COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.view_count DESC)
        FROM (
          SELECT ml.title, ml.view_count
          FROM marketplace_listings ml
          WHERE ml.owner_id = v_user_id AND ml.is_active = true
          ORDER BY ml.view_count DESC
          LIMIT 5
        ) t
      ), '[]'::json),
    'recent_acquisitions',
      COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.created_at DESC)
        FROM (
          SELECT
            ds.created_at,
            ml.title AS deck_title,
            p.display_name AS subscriber_name
          FROM deck_shares ds
          JOIN marketplace_listings ml ON ml.deck_id = ds.deck_id
          JOIN profiles p ON p.id = ds.user_id
          WHERE ml.owner_id = v_user_id AND ml.is_active = true
            AND ds.share_mode = 'subscribe'
            AND ds.status = 'active'
          ORDER BY ds.created_at DESC
          LIMIT 10
        ) t
      ), '[]'::json),
    'recent_reviews',
      COALESCE((
        SELECT json_agg(row_to_json(t) ORDER BY t.created_at DESC)
        FROM (
          SELECT
            mr.rating,
            mr.comment,
            mr.created_at,
            ml.title AS deck_title,
            p.display_name AS reviewer_name
          FROM marketplace_reviews mr
          JOIN marketplace_listings ml ON ml.id = mr.listing_id
          JOIN profiles p ON p.id = mr.user_id
          WHERE ml.owner_id = v_user_id AND ml.is_active = true
          ORDER BY mr.created_at DESC
          LIMIT 10
        ) t
      ), '[]'::json)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
