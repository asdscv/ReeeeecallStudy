-- ═══════════════════════════════════════════════════════
-- Migration 046: SRS Bug Fixes
-- ═══════════════════════════════════════════════════════
-- 1. Add prev_srs_status to study_logs (Issue 2: accurate new-card detection)
-- 2. Redefine get_deck_stats with user_card_progress COALESCE (Issue 5: subscribed decks)
-- ═══════════════════════════════════════════════════════

-- ── Issue 2: prev_srs_status column ──────────────────────
-- Nullable TEXT so existing rows remain NULL (backward-compatible).
-- New study_log inserts will populate this with the card's srs_status
-- at the time of rating, enabling accurate "new card" counting.
ALTER TABLE study_logs ADD COLUMN IF NOT EXISTS prev_srs_status TEXT;

-- Index for the new-card-count query:
-- WHERE deck_id=? AND user_id=? AND study_mode='srs' AND studied_at>=? AND prev_srs_status='new'
CREATE INDEX IF NOT EXISTS idx_study_logs_prev_srs_status
  ON study_logs (deck_id, user_id, study_mode, studied_at)
  WHERE prev_srs_status = 'new';

-- ── Issue 5: get_deck_stats with user_card_progress ──────
-- Subscribed decks store SRS state in user_card_progress, not cards.
-- COALESCE ensures we read the user's actual progress when available.
--
-- Cards JOIN uses COALESCE(d.source_owner_id, p_user_id) so that:
--   - Owned decks: cards filtered by c.user_id = p_user_id (same as before)
--   - Subscribed decks: cards filtered by c.user_id = source_owner_id
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
    COUNT(c.id) FILTER (WHERE COALESCE(ucp.srs_status, c.srs_status) = 'new'),
    COUNT(c.id) FILTER (WHERE COALESCE(ucp.srs_status, c.srs_status) = 'review'
      AND COALESCE(ucp.next_review_at, c.next_review_at) <= NOW()),
    COUNT(c.id) FILTER (WHERE COALESCE(ucp.srs_status, c.srs_status) = 'learning'
      AND COALESCE(ucp.next_review_at, c.next_review_at) <= NOW()),
    (SELECT MAX(sl.studied_at)
     FROM study_logs sl
     WHERE sl.deck_id = d.id AND sl.user_id = p_user_id
    )
  FROM decks d
  LEFT JOIN cards c
    ON c.deck_id = d.id
    AND c.user_id = COALESCE(d.source_owner_id, p_user_id)
  LEFT JOIN user_card_progress ucp
    ON ucp.card_id = c.id AND ucp.user_id = p_user_id
  WHERE d.user_id = p_user_id AND d.is_archived = false
  GROUP BY d.id, d.name
  ORDER BY d.sort_order, d.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;
