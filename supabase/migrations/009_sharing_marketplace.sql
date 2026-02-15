-- ============================================================
-- 009_sharing_marketplace.sql
-- Deck sharing + Marketplace system
-- ============================================================

-- ─── 1. Add sharing columns to decks ─────────────────────────

ALTER TABLE decks ADD COLUMN IF NOT EXISTS share_mode TEXT DEFAULT NULL
  CHECK (share_mode IS NULL OR share_mode IN ('copy','subscribe','snapshot'));
ALTER TABLE decks ADD COLUMN IF NOT EXISTS source_deck_id UUID REFERENCES decks ON DELETE SET NULL DEFAULT NULL;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS source_owner_id UUID REFERENCES auth.users ON DELETE SET NULL DEFAULT NULL;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS is_readonly BOOLEAN NOT NULL DEFAULT false;

-- ─── 2. user_card_progress ───────────────────────────────────

CREATE TABLE IF NOT EXISTS user_card_progress (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  card_id          UUID NOT NULL REFERENCES cards ON DELETE CASCADE,
  deck_id          UUID NOT NULL REFERENCES decks ON DELETE CASCADE,
  srs_status       TEXT NOT NULL DEFAULT 'new' CHECK (srs_status IN ('new','learning','review','suspended')),
  ease_factor      REAL NOT NULL DEFAULT 2.5,
  interval_days    INTEGER NOT NULL DEFAULT 0,
  repetitions      INTEGER NOT NULL DEFAULT 0,
  next_review_at   TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_ucp_user_deck ON user_card_progress (user_id, deck_id);
CREATE INDEX IF NOT EXISTS idx_ucp_user_review ON user_card_progress (user_id, next_review_at) WHERE srs_status IN ('learning', 'review');
CREATE INDEX IF NOT EXISTS idx_ucp_deck_status ON user_card_progress (deck_id, srs_status);

ALTER TABLE user_card_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own progress" ON user_card_progress
  FOR ALL USING (auth.uid() = user_id);

-- ─── 3. deck_shares ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deck_shares (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id          UUID NOT NULL REFERENCES decks ON DELETE CASCADE,
  owner_id         UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  recipient_id     UUID REFERENCES auth.users ON DELETE CASCADE,
  share_mode       TEXT NOT NULL CHECK (share_mode IN ('copy','subscribe','snapshot')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked','declined')),
  invite_code      TEXT UNIQUE,
  invite_email     TEXT,
  copied_deck_id   UUID REFERENCES decks ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ds_owner ON deck_shares (owner_id);
CREATE INDEX IF NOT EXISTS idx_ds_recipient ON deck_shares (recipient_id);
CREATE INDEX IF NOT EXISTS idx_ds_invite_code ON deck_shares (invite_code) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ds_deck_active ON deck_shares (deck_id, status) WHERE status = 'active';

ALTER TABLE deck_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage shares" ON deck_shares
  FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY "Recipients read shares" ON deck_shares
  FOR SELECT USING (auth.uid() = recipient_id);

CREATE POLICY "Anyone can read pending invites by code" ON deck_shares
  FOR SELECT USING (status = 'pending' AND invite_code IS NOT NULL);

CREATE POLICY "Recipients update shares" ON deck_shares
  FOR UPDATE USING (auth.uid() = recipient_id);

-- ─── 4. marketplace_listings ─────────────────────────────────

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id          UUID NOT NULL REFERENCES decks ON DELETE CASCADE UNIQUE,
  owner_id         UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  tags             TEXT[] DEFAULT '{}',
  category         TEXT DEFAULT 'general',
  share_mode       TEXT NOT NULL CHECK (share_mode IN ('copy','subscribe','snapshot')),
  card_count       INTEGER NOT NULL DEFAULT 0,
  acquire_count    INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_active_created ON marketplace_listings (is_active, created_at DESC) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ml_tags ON marketplace_listings USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_ml_owner ON marketplace_listings (owner_id);

ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone reads active listings" ON marketplace_listings
  FOR SELECT USING (is_active = true);

CREATE POLICY "Owners read own listings" ON marketplace_listings
  FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Owners manage listings" ON marketplace_listings
  FOR ALL USING (auth.uid() = owner_id);

-- ─── 5. Cross-table RLS: Subscribers read shared data ────────

CREATE POLICY "Subscribers read shared cards" ON cards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deck_shares
      WHERE deck_shares.deck_id = cards.deck_id
        AND deck_shares.recipient_id = auth.uid()
        AND deck_shares.share_mode = 'subscribe'
        AND deck_shares.status = 'active'
    )
  );

CREATE POLICY "Subscribers read shared templates" ON card_templates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM decks d
      JOIN deck_shares ds ON ds.deck_id = d.id
      WHERE d.default_template_id = card_templates.id
        AND ds.recipient_id = auth.uid()
        AND ds.share_mode = 'subscribe'
        AND ds.status = 'active'
    )
  );

CREATE POLICY "Subscribers read shared decks" ON decks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deck_shares
      WHERE deck_shares.deck_id = decks.id
        AND deck_shares.recipient_id = auth.uid()
        AND deck_shares.share_mode = 'subscribe'
        AND deck_shares.status = 'active'
    )
  );

-- ─── 6. RPC: copy_deck_for_user ──────────────────────────────

CREATE OR REPLACE FUNCTION copy_deck_for_user(
  p_source_deck_id UUID,
  p_recipient_id UUID,
  p_is_readonly BOOLEAN DEFAULT false,
  p_share_mode TEXT DEFAULT 'copy'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source_deck RECORD;
  v_new_deck_id UUID;
  v_new_template_id UUID;
BEGIN
  -- Get source deck
  SELECT * INTO v_source_deck FROM decks WHERE id = p_source_deck_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source deck not found';
  END IF;

  -- Copy template if exists
  IF v_source_deck.default_template_id IS NOT NULL THEN
    INSERT INTO card_templates (user_id, name, fields, front_layout, back_layout, layout_mode, front_html, back_html, is_default)
    SELECT p_recipient_id, name, fields, front_layout, back_layout, layout_mode, front_html, back_html, false
    FROM card_templates WHERE id = v_source_deck.default_template_id
    RETURNING id INTO v_new_template_id;
  END IF;

  -- Copy deck
  INSERT INTO decks (
    user_id, name, description, color, icon, default_template_id,
    srs_settings, share_mode, source_deck_id, source_owner_id, is_readonly
  )
  VALUES (
    p_recipient_id, v_source_deck.name, v_source_deck.description,
    v_source_deck.color, v_source_deck.icon,
    COALESCE(v_new_template_id, v_source_deck.default_template_id),
    v_source_deck.srs_settings, p_share_mode, p_source_deck_id,
    v_source_deck.user_id, p_is_readonly
  )
  RETURNING id INTO v_new_deck_id;

  -- Copy cards
  INSERT INTO cards (
    deck_id, user_id, template_id, field_values, tags, sort_position,
    srs_status, ease_factor, interval_days, repetitions
  )
  SELECT
    v_new_deck_id, p_recipient_id,
    COALESCE(v_new_template_id, template_id),
    field_values, tags, sort_position,
    'new', 2.5, 0, 0
  FROM cards WHERE deck_id = p_source_deck_id;

  -- Update next_position on new deck
  UPDATE decks SET next_position = (
    SELECT COALESCE(MAX(sort_position) + 1, 0) FROM cards WHERE deck_id = v_new_deck_id
  ) WHERE id = v_new_deck_id;

  RETURN v_new_deck_id;
END;
$$;

-- ─── 7. RPC: init_subscriber_progress ────────────────────────

CREATE OR REPLACE FUNCTION init_subscriber_progress(
  p_user_id UUID,
  p_deck_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO user_card_progress (user_id, card_id, deck_id, srs_status)
  SELECT p_user_id, id, deck_id, 'new'
  FROM cards
  WHERE deck_id = p_deck_id
  ON CONFLICT (user_id, card_id) DO NOTHING;
END;
$$;

-- ─── 8. RPC: increment_acquire_count ─────────────────────────

CREATE OR REPLACE FUNCTION increment_acquire_count(
  p_listing_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE marketplace_listings
  SET acquire_count = acquire_count + 1, updated_at = NOW()
  WHERE id = p_listing_id;
END;
$$;
