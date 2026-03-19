-- ============================================================
-- 052_subscribe_sync.sql
-- Real-time sync for Subscribe mode: change log + sync RPC
-- ============================================================

-- ─── 1. Add last_synced_at to deck_shares ──────────────────
ALTER TABLE deck_shares ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- ─── 2. deck_change_log table ──────────────────────────────
CREATE TABLE IF NOT EXISTS deck_change_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id     UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('card_added', 'card_removed', 'card_updated', 'deck_updated')),
  card_id     UUID REFERENCES cards(id) ON DELETE SET NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dcl_deck_created ON deck_change_log(deck_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dcl_deck_type ON deck_change_log(deck_id, change_type);

ALTER TABLE deck_change_log ENABLE ROW LEVEL SECURITY;

-- Subscribers can read change logs for decks they subscribe to
CREATE POLICY "Subscribers read change logs" ON deck_change_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deck_shares
      WHERE deck_shares.deck_id = deck_change_log.deck_id
        AND deck_shares.recipient_id = auth.uid()
        AND deck_shares.share_mode = 'subscribe'
        AND deck_shares.status = 'active'
    )
  );

-- Deck owners can read their own change logs
CREATE POLICY "Owners read change logs" ON deck_change_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM decks
      WHERE decks.id = deck_change_log.deck_id
        AND decks.user_id = auth.uid()
    )
  );

-- ─── 3. Trigger: auto-log card INSERT ──────────────────────
CREATE OR REPLACE FUNCTION fn_log_card_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log if the deck has active subscribers
  IF EXISTS (
    SELECT 1 FROM deck_shares
    WHERE deck_shares.deck_id = NEW.deck_id
      AND deck_shares.share_mode = 'subscribe'
      AND deck_shares.status = 'active'
  ) THEN
    INSERT INTO deck_change_log (deck_id, change_type, card_id, metadata)
    VALUES (NEW.deck_id, 'card_added', NEW.id, jsonb_build_object(
      'field_values', NEW.field_values,
      'sort_position', NEW.sort_position
    ));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_card_added ON cards;
CREATE TRIGGER trg_log_card_added
  AFTER INSERT ON cards
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_card_added();

-- ─── 4. Trigger: auto-log card DELETE ──────────────────────
CREATE OR REPLACE FUNCTION fn_log_card_removed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log if the deck has active subscribers
  IF EXISTS (
    SELECT 1 FROM deck_shares
    WHERE deck_shares.deck_id = OLD.deck_id
      AND deck_shares.share_mode = 'subscribe'
      AND deck_shares.status = 'active'
  ) THEN
    INSERT INTO deck_change_log (deck_id, change_type, card_id, metadata)
    VALUES (OLD.deck_id, 'card_removed', OLD.id, jsonb_build_object(
      'card_id', OLD.id,
      'field_values', OLD.field_values
    ));
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_card_removed ON cards;
CREATE TRIGGER trg_log_card_removed
  BEFORE DELETE ON cards
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_card_removed();

-- ─── 5. Trigger: auto-log card UPDATE ──────────────────────
CREATE OR REPLACE FUNCTION fn_log_card_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log meaningful changes (field_values or tags changed)
  IF (OLD.field_values IS DISTINCT FROM NEW.field_values
      OR OLD.tags IS DISTINCT FROM NEW.tags) THEN
    -- Only log if the deck has active subscribers
    IF EXISTS (
      SELECT 1 FROM deck_shares
      WHERE deck_shares.deck_id = NEW.deck_id
        AND deck_shares.share_mode = 'subscribe'
        AND deck_shares.status = 'active'
    ) THEN
      INSERT INTO deck_change_log (deck_id, change_type, card_id, metadata)
      VALUES (NEW.deck_id, 'card_updated', NEW.id, jsonb_build_object(
        'old_field_values', OLD.field_values,
        'new_field_values', NEW.field_values
      ));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_card_updated ON cards;
CREATE TRIGGER trg_log_card_updated
  AFTER UPDATE ON cards
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_card_updated();

-- ─── 6. RPC: sync_subscriber_deck ─────────────────────────
CREATE OR REPLACE FUNCTION sync_subscriber_deck(
  p_user_id UUID,
  p_deck_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share RECORD;
  v_last_synced TIMESTAMPTZ;
  v_added INT := 0;
  v_removed INT := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Verify active subscription exists
  SELECT * INTO v_share
  FROM deck_shares
  WHERE deck_id = p_deck_id
    AND recipient_id = p_user_id
    AND share_mode = 'subscribe'
    AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active subscription found for this deck';
  END IF;

  v_last_synced := COALESCE(v_share.last_synced_at, v_share.accepted_at, v_share.created_at);

  -- Process card_added: insert missing user_card_progress rows
  -- We don't rely solely on the changelog — we reconcile against actual cards
  -- This makes the sync idempotent
  INSERT INTO user_card_progress (user_id, card_id, deck_id, srs_status)
  SELECT p_user_id, c.id, c.deck_id, 'new'
  FROM cards c
  WHERE c.deck_id = p_deck_id
    AND NOT EXISTS (
      SELECT 1 FROM user_card_progress ucp
      WHERE ucp.user_id = p_user_id AND ucp.card_id = c.id
    )
  ON CONFLICT (user_id, card_id) DO NOTHING;

  GET DIAGNOSTICS v_added = ROW_COUNT;

  -- Process card_removed: delete progress for cards that no longer exist
  DELETE FROM user_card_progress
  WHERE user_id = p_user_id
    AND deck_id = p_deck_id
    AND NOT EXISTS (
      SELECT 1 FROM cards c WHERE c.id = user_card_progress.card_id
    );

  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Update last_synced_at on the share record
  UPDATE deck_shares
  SET last_synced_at = v_now
  WHERE id = v_share.id;

  RETURN jsonb_build_object(
    'added', v_added,
    'removed', v_removed,
    'last_synced', v_now
  );
END;
$$;

-- ─── 7. RPC: get_pending_sync_count ────────────────────────
-- Returns the number of pending changes for a subscribed deck
CREATE OR REPLACE FUNCTION get_pending_sync_count(
  p_user_id UUID,
  p_deck_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_synced TIMESTAMPTZ;
  v_count INT;
BEGIN
  -- Get last sync time
  SELECT COALESCE(last_synced_at, accepted_at, created_at)
  INTO v_last_synced
  FROM deck_shares
  WHERE deck_id = p_deck_id
    AND recipient_id = p_user_id
    AND share_mode = 'subscribe'
    AND status = 'active'
  LIMIT 1;

  IF v_last_synced IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::INT INTO v_count
  FROM deck_change_log
  WHERE deck_id = p_deck_id
    AND created_at > v_last_synced;

  RETURN v_count;
END;
$$;
