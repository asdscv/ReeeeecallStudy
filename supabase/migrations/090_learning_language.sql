-- ============================================================================
-- Migration 090 — Learning Language
--
-- Adds a deck-level "learning language" concept: the language a deck TEACHES.
-- This is distinct from source_language/target_language on the manifest (which
-- describe the bilingual CSV pair). `learning_language` answers "what is the
-- learner studying?" and powers UI filtering / discovery.
--
-- CONTRACT:
--   • Column name : learning_language TEXT, NULLABLE
--   • Allowed     : NULL or one of 'en','ko','zh','ja','es','vi','th','id'
--
-- Tables: decks, marketplace_listings, official_deck_manifest.
-- Functions updated: import_official_deck, get_official_listings.
-- Backfill: every existing official deck teaches English ('en').
--
-- All DDL is idempotent (IF NOT EXISTS + guarded CHECK constraints).
--
-- NOTE on import_official_deck: migration 083 superseded 082's definition of
-- this function (it added `search_path = public, extensions` and the
-- fully-qualified `extensions.uuid_generate_v5(...)` call to fix the prod
-- uuid-ossp visibility bug). We reproduce the 083 version verbatim here and add
-- learning_language only — reverting to the 082 body would re-break production.
-- ============================================================================

BEGIN;

-- ─── 1. decks.learning_language ────────────────────────────────────────────
ALTER TABLE decks ADD COLUMN IF NOT EXISTS learning_language TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_decks_learning_language') THEN
    ALTER TABLE decks ADD CONSTRAINT chk_decks_learning_language
      CHECK (learning_language IS NULL OR learning_language IN
        ('en','ko','zh','ja','es','vi','th','id'));
  END IF;
END $$;

-- ─── 2. marketplace_listings.learning_language ─────────────────────────────
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS learning_language TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ml_learning_language') THEN
    ALTER TABLE marketplace_listings ADD CONSTRAINT chk_ml_learning_language
      CHECK (learning_language IS NULL OR learning_language IN
        ('en','ko','zh','ja','es','vi','th','id'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ml_learning_language
  ON marketplace_listings(learning_language)
  WHERE learning_language IS NOT NULL;

-- ─── 3. official_deck_manifest.learning_language ───────────────────────────
ALTER TABLE official_deck_manifest ADD COLUMN IF NOT EXISTS learning_language TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_odm_learning_language') THEN
    ALTER TABLE official_deck_manifest ADD CONSTRAINT chk_odm_learning_language
      CHECK (learning_language IS NULL OR learning_language IN
        ('en','ko','zh','ja','es','vi','th','id'));
  END IF;
END $$;

-- ─── 4. import_official_deck (reproduced from 083 + learning_language) ──────
-- p_deck now also reads `learning_language`. It flows into the decks insert,
-- the marketplace_listings insert, and the official_deck_manifest upsert.
CREATE OR REPLACE FUNCTION import_official_deck(
  p_manifest_key TEXT,
  p_checksum     TEXT,
  p_deck         JSONB,
  p_cards        JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_system_user_id  CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  v_deck_namespace  CONSTANT UUID := '6f7d8a9b-3c4e-4d6f-8a8b-9c0d1e2f3a4b';

  v_role            TEXT;
  v_caller_id       UUID;
  v_deck_id         UUID;
  v_existing_check  TEXT;
  v_listing_id      UUID;

  v_source_file     TEXT;
  v_source_lang     TEXT;
  v_target_lang     TEXT;
  v_learning_lang   TEXT;
  v_category        TEXT;
  v_name            TEXT;
  v_description     TEXT;
  v_color           TEXT;
  v_icon            TEXT;
  v_template_id     UUID;
  v_tags            TEXT[];
  v_card_count      INTEGER;
  v_payload_ids     UUID[];

  v_inserted        INTEGER := 0;
  v_updated         INTEGER := 0;
  v_deleted         INTEGER := 0;
BEGIN
  v_role      := auth.role();
  v_caller_id := auth.uid();

  IF v_role IN ('authenticated', 'anon') THEN
    IF v_caller_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = v_caller_id AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Only admins or service role can import official decks'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_manifest_key IS NULL OR length(p_manifest_key) = 0 THEN
    RAISE EXCEPTION 'manifest_key required';
  END IF;
  IF p_checksum IS NULL OR length(p_checksum) = 0 THEN
    RAISE EXCEPTION 'checksum required';
  END IF;
  IF p_deck IS NULL OR p_cards IS NULL THEN
    RAISE EXCEPTION 'deck and cards payloads required';
  END IF;

  v_source_file   := p_deck->>'source_file';
  v_source_lang   := p_deck->>'source_language';
  v_target_lang   := p_deck->>'target_language';
  v_learning_lang := p_deck->>'learning_language';
  v_category      := p_deck->>'category';
  v_name          := p_deck->>'name';
  v_description   := p_deck->>'description';
  v_color         := COALESCE(p_deck->>'color', '#3B82F6');
  v_icon          := COALESCE(p_deck->>'icon', '📚');
  v_template_id   := (p_deck->>'template_id')::UUID;
  v_tags          := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(p_deck->'tags', '[]'::jsonb))
  );
  v_card_count    := jsonb_array_length(p_cards);

  IF v_source_file IS NULL OR v_source_lang IS NULL OR v_target_lang IS NULL THEN
    RAISE EXCEPTION 'deck.source_file / source_language / target_language required';
  END IF;
  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'deck.template_id required';
  END IF;
  IF v_source_lang = v_target_lang THEN
    RAISE EXCEPTION 'source_language must differ from target_language';
  END IF;
  IF v_name IS NULL OR length(v_name) = 0 THEN
    RAISE EXCEPTION 'deck.name required';
  END IF;
  IF v_category IS NULL OR length(v_category) = 0 THEN
    RAISE EXCEPTION 'deck.category required';
  END IF;

  -- Unqualified call resolves via the SET search_path above: `extensions` on
  -- Supabase prod (uuid-ossp lives there), `public` in CI/local (installed
  -- there). Hard-qualifying `extensions.` breaks CI where uuid-ossp is in
  -- public; the search_path fix from 083 is what actually matters on prod.
  v_deck_id := uuid_generate_v5(v_deck_namespace, p_manifest_key);

  SELECT last_applied_checksum INTO v_existing_check
  FROM official_deck_manifest
  WHERE manifest_key = p_manifest_key;

  IF v_existing_check IS NOT NULL AND v_existing_check = p_checksum THEN
    UPDATE official_deck_manifest
    SET last_applied_at = NOW(),
        last_status     = 'noop',
        updated_at      = NOW()
    WHERE manifest_key = p_manifest_key;

    RETURN jsonb_build_object(
      'deck_id',         v_deck_id,
      'status',          'noop',
      'cards_inserted',  0,
      'cards_updated',   0,
      'cards_deleted',   0,
      'card_count',      v_card_count
    );
  END IF;

  INSERT INTO decks (
    id, user_id, name, description, default_template_id,
    color, icon, share_mode, is_readonly, sort_order, next_position,
    learning_language
  ) VALUES (
    v_deck_id, v_system_user_id, v_name, v_description, v_template_id,
    v_color, v_icon, 'subscribe', true, 0, v_card_count,
    v_learning_lang
  )
  ON CONFLICT (id) DO UPDATE SET
    name                = EXCLUDED.name,
    description         = EXCLUDED.description,
    default_template_id = EXCLUDED.default_template_id,
    color               = EXCLUDED.color,
    icon                = EXCLUDED.icon,
    share_mode          = 'subscribe',
    is_readonly         = true,
    next_position       = EXCLUDED.next_position,
    learning_language   = EXCLUDED.learning_language,
    updated_at          = NOW();

  SELECT COALESCE(ARRAY_AGG((c->>'id')::UUID), ARRAY[]::UUID[])
  INTO v_payload_ids
  FROM jsonb_array_elements(p_cards) AS c;

  WITH deleted AS (
    DELETE FROM cards
    WHERE deck_id = v_deck_id
      AND id <> ALL(v_payload_ids)
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_deleted FROM deleted;

  WITH incoming AS (
    SELECT
      (c->>'id')::UUID                                            AS id,
      COALESCE(c->'field_values', '{}'::jsonb)                    AS field_values,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(c->'tags','[]'::jsonb))) AS tags,
      COALESCE((c->>'sort_position')::INTEGER, 0)                 AS sort_position
    FROM jsonb_array_elements(p_cards) AS c
  ),
  prior AS (
    SELECT id, field_values, tags, sort_position
    FROM cards
    WHERE deck_id = v_deck_id
  ),
  upserts AS (
    INSERT INTO cards (
      id, deck_id, user_id, template_id, field_values, tags, sort_position
    )
    SELECT i.id, v_deck_id, v_system_user_id, v_template_id,
           i.field_values, i.tags, i.sort_position
    FROM incoming i
    ON CONFLICT (id) DO UPDATE SET
      field_values  = EXCLUDED.field_values,
      tags          = EXCLUDED.tags,
      sort_position = EXCLUDED.sort_position,
      updated_at    = CASE
        WHEN cards.field_values  IS DISTINCT FROM EXCLUDED.field_values
          OR cards.tags          IS DISTINCT FROM EXCLUDED.tags
          OR cards.sort_position IS DISTINCT FROM EXCLUDED.sort_position
        THEN NOW()
        ELSE cards.updated_at
      END
    RETURNING id, (xmax = 0) AS was_insert
  )
  SELECT
    COALESCE(SUM(CASE WHEN was_insert THEN 1 ELSE 0 END), 0)::INTEGER,
    COALESCE(SUM(
      CASE
        WHEN was_insert THEN 0
        WHEN EXISTS (
          SELECT 1 FROM prior p, incoming i
          WHERE p.id = u.id
            AND i.id = u.id
            AND (p.field_values  IS DISTINCT FROM i.field_values
              OR p.tags          IS DISTINCT FROM i.tags
              OR p.sort_position IS DISTINCT FROM i.sort_position)
        ) THEN 1
        ELSE 0
      END
    ), 0)::INTEGER
  INTO v_inserted, v_updated
  FROM upserts u;

  INSERT INTO marketplace_listings (
    deck_id, owner_id, title, description, tags, category,
    share_mode, card_count, is_active, learning_language
  ) VALUES (
    v_deck_id, v_system_user_id, v_name, v_description, v_tags, v_category,
    'subscribe', v_card_count, true, v_learning_lang
  )
  ON CONFLICT (deck_id) DO UPDATE SET
    title             = EXCLUDED.title,
    description       = EXCLUDED.description,
    tags              = EXCLUDED.tags,
    category          = EXCLUDED.category,
    card_count        = EXCLUDED.card_count,
    is_active         = true,
    learning_language = EXCLUDED.learning_language,
    updated_at        = NOW()
  RETURNING id INTO v_listing_id;

  INSERT INTO official_deck_manifest (
    manifest_key, deck_id, source_file, source_language, target_language,
    category, card_count, last_applied_checksum, last_applied_at,
    last_status, last_error, learning_language
  ) VALUES (
    p_manifest_key, v_deck_id, v_source_file, v_source_lang, v_target_lang,
    v_category, v_card_count, p_checksum, NOW(),
    'applied', NULL, v_learning_lang
  )
  ON CONFLICT (manifest_key) DO UPDATE SET
    deck_id                = EXCLUDED.deck_id,
    source_file            = EXCLUDED.source_file,
    source_language        = EXCLUDED.source_language,
    target_language        = EXCLUDED.target_language,
    category               = EXCLUDED.category,
    card_count             = EXCLUDED.card_count,
    last_applied_checksum  = EXCLUDED.last_applied_checksum,
    last_applied_at        = EXCLUDED.last_applied_at,
    last_status            = 'applied',
    last_error             = NULL,
    learning_language      = EXCLUDED.learning_language,
    updated_at             = NOW();

  RETURN jsonb_build_object(
    'deck_id',        v_deck_id,
    'listing_id',     v_listing_id,
    'status',         'applied',
    'cards_inserted', v_inserted,
    'cards_updated',  v_updated,
    'cards_deleted',  v_deleted,
    'card_count',     v_card_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION import_official_deck(TEXT, TEXT, JSONB, JSONB)
  TO service_role;

-- ─── 5. get_official_listings (reproduced from 061 + learning_language) ─────
-- Adding learning_language changes the RETURNS TABLE row type, so CREATE OR
-- REPLACE alone fails ("cannot change return type of existing function").
-- Drop the old signature first.
DROP FUNCTION IF EXISTS get_official_listings(integer);
CREATE OR REPLACE FUNCTION get_official_listings(
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  deck_id UUID,
  owner_id UUID,
  title TEXT,
  description TEXT,
  tags TEXT[],
  category TEXT,
  share_mode TEXT,
  card_count INTEGER,
  acquire_count INTEGER,
  view_count INTEGER,
  avg_rating NUMERIC,
  review_count INTEGER,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  owner_display_name TEXT,
  owner_is_official BOOLEAN,
  badge_type TEXT,
  badge_color TEXT,
  organization_name TEXT,
  featured_priority INTEGER,
  learning_language TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ml.id,
    ml.deck_id,
    ml.owner_id,
    ml.title,
    ml.description,
    ml.tags,
    ml.category,
    ml.share_mode::TEXT,
    ml.card_count,
    ml.acquire_count,
    ml.view_count,
    ml.avg_rating,
    ml.review_count,
    ml.is_active,
    ml.created_at,
    p.display_name AS owner_display_name,
    p.is_official AS owner_is_official,
    COALESCE(oas.display_badge, 'verified') AS badge_type,
    COALESCE(oas.badge_color, '#3B82F6') AS badge_color,
    oas.organization_name,
    COALESCE(oas.featured_priority, 0) AS featured_priority,
    ml.learning_language
  FROM marketplace_listings ml
  JOIN profiles p ON p.id = ml.owner_id
  LEFT JOIN official_account_settings oas ON oas.user_id = ml.owner_id
  WHERE ml.is_active = true
    AND p.is_official = true
  ORDER BY COALESCE(oas.featured_priority, 0) DESC, ml.acquire_count DESC
  LIMIT p_limit;
END;
$$;

-- ─── 6. Backfill — every current official deck teaches English ─────────────
UPDATE decks
SET learning_language = 'en'
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND learning_language IS NULL;

UPDATE marketplace_listings
SET learning_language = 'en'
WHERE owner_id = '00000000-0000-0000-0000-000000000001'
  AND learning_language IS NULL;

UPDATE official_deck_manifest
SET learning_language = 'en'
WHERE learning_language IS NULL;

COMMIT;
