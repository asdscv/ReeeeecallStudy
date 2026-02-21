-- ═══════════════════════════════════════════════════════
-- Migration 037: Fix get_deck_stats RLS consistency
-- ═══════════════════════════════════════════════════════
-- Problem:
--   get_deck_stats is SECURITY DEFINER (bypasses RLS) but joins
--   cards without filtering by user_id. This causes:
--   1. Cards belonging to OTHER users (e.g. from sharing/copy bugs)
--      to be counted, inflating total_cards.
--   2. LEFT JOIN study_logs can multiply card counts when a card
--      has multiple study log entries.
--
-- Fix:
--   1. Add c.user_id = p_user_id to the cards JOIN
--   2. Replace study_logs JOIN with a correlated subquery to avoid
--      count inflation
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_deck_stats(p_user_id UUID)
RETURNS TABLE (
  deck_id UUID,
  deck_name TEXT,
  total_cards BIGINT,
  new_cards BIGINT,
  review_cards BIGINT,
  learning_cards BIGINT,
  last_studied TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.name,
    COUNT(c.id),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'new'),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'review' AND c.next_review_at <= NOW()),
    COUNT(c.id) FILTER (WHERE c.srs_status = 'learning' AND c.next_review_at <= NOW()),
    (SELECT MAX(sl.studied_at)
     FROM study_logs sl
     WHERE sl.deck_id = d.id AND sl.user_id = p_user_id
    )
  FROM decks d
  LEFT JOIN cards c ON c.deck_id = d.id AND c.user_id = p_user_id
  WHERE d.user_id = p_user_id AND d.is_archived = false
  GROUP BY d.id, d.name
  ORDER BY d.sort_order, d.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;
