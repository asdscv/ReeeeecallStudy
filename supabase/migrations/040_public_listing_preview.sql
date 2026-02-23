-- Migration 040: Public listing preview RPC
-- Allows anonymous users to fetch a limited preview of active marketplace listings
-- for SEO-friendly public pages (/d/:listingId).

CREATE OR REPLACE FUNCTION get_public_listing_preview(p_listing_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'id', ml.id,
    'title', ml.title,
    'description', ml.description,
    'tags', ml.tags,
    'category', ml.category,
    'card_count', ml.card_count,
    'acquire_count', ml.acquire_count,
    'share_mode', ml.share_mode,
    'created_at', ml.created_at,
    'owner_name', p.display_name,
    'owner_is_official', p.is_official,
    'sample_fields', (
      SELECT COALESCE(json_agg(
        json_build_object('field_values', c.field_values)
        ORDER BY c.sort_position
      ), '[]'::json)
      FROM (
        SELECT c2.field_values, c2.sort_position
        FROM cards c2
        WHERE c2.deck_id = ml.deck_id
        ORDER BY c2.sort_position
        LIMIT 3
      ) c
    )
  ) INTO result
  FROM marketplace_listings ml
  JOIN profiles p ON p.id = ml.owner_id
  WHERE ml.id = p_listing_id
    AND ml.is_active = true;

  RETURN result;
END;
$$;

-- Allow anonymous and authenticated users to call this function
GRANT EXECUTE ON FUNCTION get_public_listing_preview(UUID) TO anon, authenticated;
