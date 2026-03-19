-- ============================================================
-- 055_deck_versions.sql
-- Deck version history for subscribers and owners
-- ============================================================

-- ─── 1. deck_versions table ───────────────────────────────
CREATE TABLE IF NOT EXISTS deck_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id         UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  change_summary  TEXT,
  card_count      INTEGER NOT NULL,
  snapshot_data   JSONB,  -- optional: store card IDs at this version point
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(deck_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_dv_deck ON deck_versions(deck_id, version_number DESC);

-- ─── 2. RLS policies ──────────────────────────────────────
ALTER TABLE deck_versions ENABLE ROW LEVEL SECURITY;

-- Deck owners can read and manage versions
CREATE POLICY "Owners manage deck versions" ON deck_versions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM decks WHERE decks.id = deck_versions.deck_id AND decks.user_id = auth.uid())
  );

-- Subscribers can read versions of subscribed decks
CREATE POLICY "Subscribers read deck versions" ON deck_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deck_shares
      WHERE deck_shares.deck_id = deck_versions.deck_id
        AND deck_shares.recipient_id = auth.uid()
        AND deck_shares.status = 'active'
    )
  );

-- Admins can read all versions
CREATE POLICY "Admins read all deck versions" ON deck_versions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── 3. RPC: create_deck_version ──────────────────────────
CREATE OR REPLACE FUNCTION create_deck_version(
  p_deck_id       UUID,
  p_change_summary TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_next_version INTEGER;
  v_card_count INTEGER;
  v_card_ids JSONB;
  v_version_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify deck ownership
  IF NOT EXISTS (SELECT 1 FROM decks WHERE id = p_deck_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'Only the deck owner can create versions';
  END IF;

  -- Get next version number
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM deck_versions
  WHERE deck_id = p_deck_id;

  -- Capture current card count
  SELECT COUNT(*) INTO v_card_count
  FROM cards
  WHERE deck_id = p_deck_id;

  -- Capture card ID snapshot
  SELECT jsonb_agg(id ORDER BY sort_position) INTO v_card_ids
  FROM cards
  WHERE deck_id = p_deck_id;

  INSERT INTO deck_versions (deck_id, version_number, change_summary, card_count, snapshot_data, created_by)
  VALUES (p_deck_id, v_next_version, p_change_summary, v_card_count, v_card_ids, v_user_id)
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END;
$$;

-- ─── 4. RPC: get_deck_versions ────────────────────────────
CREATE OR REPLACE FUNCTION get_deck_versions(
  p_deck_id UUID
)
RETURNS TABLE (
  id UUID,
  deck_id UUID,
  version_number INTEGER,
  change_summary TEXT,
  card_count INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- User must be the deck owner or an active subscriber
  IF NOT EXISTS (
    SELECT 1 FROM decks WHERE id = p_deck_id AND user_id = v_user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM deck_shares
    WHERE deck_shares.deck_id = p_deck_id
      AND deck_shares.recipient_id = v_user_id
      AND deck_shares.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Access denied: not owner or subscriber';
  END IF;

  RETURN QUERY
  SELECT
    dv.id,
    dv.deck_id,
    dv.version_number,
    dv.change_summary,
    dv.card_count,
    dv.created_by,
    dv.created_at
  FROM deck_versions dv
  WHERE dv.deck_id = p_deck_id
  ORDER BY dv.version_number DESC;
END;
$$;

-- ─── 5. Auto-version trigger on marketplace listing update ─
CREATE OR REPLACE FUNCTION trg_auto_version_on_listing_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_count INTEGER;
  v_next_version INTEGER;
  v_card_ids JSONB;
BEGIN
  -- Only fire when card_count changes (indicating content update)
  IF OLD.card_count = NEW.card_count THEN
    RETURN NEW;
  END IF;

  -- Get current card count from actual cards table
  SELECT COUNT(*) INTO v_current_count
  FROM cards
  WHERE deck_id = NEW.deck_id;

  -- Get next version number
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM deck_versions
  WHERE deck_id = NEW.deck_id;

  -- Capture card ID snapshot
  SELECT jsonb_agg(id ORDER BY sort_position) INTO v_card_ids
  FROM cards
  WHERE deck_id = NEW.deck_id;

  INSERT INTO deck_versions (deck_id, version_number, change_summary, card_count, snapshot_data, created_by)
  VALUES (
    NEW.deck_id,
    v_next_version,
    'Auto-version: card count changed from ' || OLD.card_count || ' to ' || NEW.card_count,
    v_current_count,
    v_card_ids,
    NEW.owner_id
  )
  ON CONFLICT (deck_id, version_number) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_marketplace_listing_auto_version
  AFTER UPDATE ON marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION trg_auto_version_on_listing_update();
