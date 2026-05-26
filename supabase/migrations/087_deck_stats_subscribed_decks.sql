-- ═══════════════════════════════════════════════════════
-- Migration 087: get_deck_stats includes subscribed decks
-- ═══════════════════════════════════════════════════════
-- Problem:
--   Subscribe-mode marketplace decks are owned by the publisher.
--   acquire_listing() does NOT copy the deck for the subscriber —
--   it creates a deck_shares row (recipient_id = subscriber,
--   share_mode = 'subscribe') and seeds per-user SRS state in
--   user_card_progress. The deck row itself keeps user_id = publisher.
--
--   get_deck_stats() only returned rows for decks the user OWNS
--   (WHERE d.user_id = p_user_id) and counted cards filtered by
--   c.user_id = p_user_id. So subscribed decks were excluded entirely,
--   surfacing as "0 cards" in the deck list and Quick Study.
--
-- Fix:
--   Add a second branch that returns stats for decks the user is
--   actively subscribed to. Cards are counted by deck_id (they belong
--   to the publisher) and SRS buckets are read from user_card_progress
--   (the subscriber's per-user progress; absent rows = new).
--
--   The owned-deck branch is unchanged from migration 037.
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
  -- ── Owned decks: embedded SRS lives on the cards row ──
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

  UNION ALL

  -- ── Subscribed decks: per-user SRS lives in user_card_progress ──
  -- Cards are owned by the publisher, so they are NOT filtered by user_id.
  SELECT
    d.id,
    d.name,
    COUNT(c.id),
    COUNT(c.id) FILTER (WHERE COALESCE(ucp.srs_status, 'new') = 'new'),
    COUNT(c.id) FILTER (WHERE ucp.srs_status = 'review' AND ucp.next_review_at <= NOW()),
    COUNT(c.id) FILTER (WHERE ucp.srs_status = 'learning' AND ucp.next_review_at <= NOW()),
    (SELECT MAX(sl.studied_at)
     FROM study_logs sl
     WHERE sl.deck_id = d.id AND sl.user_id = p_user_id
    )
  FROM deck_shares ds
  JOIN decks d ON d.id = ds.deck_id
  LEFT JOIN cards c ON c.deck_id = d.id
  LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = p_user_id
  WHERE ds.recipient_id = p_user_id
    AND ds.share_mode = 'subscribe'
    AND ds.status = 'active'
    AND d.is_archived = false
    AND d.user_id <> p_user_id   -- never double-count an owned deck
  GROUP BY d.id, d.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;
