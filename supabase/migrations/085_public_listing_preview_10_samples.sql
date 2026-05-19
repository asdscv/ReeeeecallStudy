-- ============================================================================
-- Migration 085 — get_public_listing_preview: 3 → 10 sample cards
--
-- Why:
--   The UI says "카드 미리보기 (최대 10장)" but the RPC was returning only 3.
--   Bumping to 10 also gives crawlers more learning content to index in the
--   bot-served SSR page (more long-tail vocabulary surface).
--
--   Cost: negligible — RPC is called once per page load and Cloudflare caches
--   the resulting HTML for an hour.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION get_public_listing_preview(p_listing_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
        LIMIT 10
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

GRANT EXECUTE ON FUNCTION get_public_listing_preview(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
