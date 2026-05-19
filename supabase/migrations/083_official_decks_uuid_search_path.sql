-- ============================================================================
-- Migration 083 — Fix uuid_generate_v5 visibility for import_official_deck
--
-- Root cause: 082 set `search_path = public`, but on Supabase production the
-- uuid-ossp extension is installed in the `extensions` schema, not `public`.
-- The RPC therefore fails with "function uuid_generate_v5(uuid, text) does not exist".
--
-- Fix: extend search_path to include `extensions` so the function resolves
-- in both local (where it's in public) and production (where it's in extensions).
-- ============================================================================

BEGIN;

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

  v_source_file := p_deck->>'source_file';
  v_source_lang := p_deck->>'source_language';
  v_target_lang := p_deck->>'target_language';
  v_category    := p_deck->>'category';
  v_name        := p_deck->>'name';
  v_description := p_deck->>'description';
  v_color       := COALESCE(p_deck->>'color', '#3B82F6');
  v_icon        := COALESCE(p_deck->>'icon', '📚');
  v_template_id := (p_deck->>'template_id')::UUID;
  v_tags        := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(p_deck->'tags', '[]'::jsonb))
  );
  v_card_count  := jsonb_array_length(p_cards);

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

  -- Fully-qualified call works regardless of search_path; the SET above also
  -- helps when planner caches the function lookup.
  v_deck_id := extensions.uuid_generate_v5(v_deck_namespace, p_manifest_key);

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
    color, icon, share_mode, is_readonly, sort_order, next_position
  ) VALUES (
    v_deck_id, v_system_user_id, v_name, v_description, v_template_id,
    v_color, v_icon, 'subscribe', true, 0, v_card_count
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
    share_mode, card_count, is_active
  ) VALUES (
    v_deck_id, v_system_user_id, v_name, v_description, v_tags, v_category,
    'subscribe', v_card_count, true
  )
  ON CONFLICT (deck_id) DO UPDATE SET
    title       = EXCLUDED.title,
    description = EXCLUDED.description,
    tags        = EXCLUDED.tags,
    category    = EXCLUDED.category,
    card_count  = EXCLUDED.card_count,
    is_active   = true,
    updated_at  = NOW()
  RETURNING id INTO v_listing_id;

  INSERT INTO official_deck_manifest (
    manifest_key, deck_id, source_file, source_language, target_language,
    category, card_count, last_applied_checksum, last_applied_at,
    last_status, last_error
  ) VALUES (
    p_manifest_key, v_deck_id, v_source_file, v_source_lang, v_target_lang,
    v_category, v_card_count, p_checksum, NOW(),
    'applied', NULL
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

-- Same fix for mark_official_deck_failed
CREATE OR REPLACE FUNCTION mark_official_deck_failed(
  p_manifest_key    TEXT,
  p_source_file     TEXT,
  p_source_language TEXT,
  p_target_language TEXT,
  p_category        TEXT,
  p_error           TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role            TEXT := auth.role();
  v_caller_id       UUID := auth.uid();
  v_deck_namespace  CONSTANT UUID := '6f7d8a9b-3c4e-4d6f-8a8b-9c0d1e2f3a4b';
  v_deck_id         UUID;
BEGIN
  IF v_role IN ('authenticated', 'anon') THEN
    IF v_caller_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = v_caller_id AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_source_language = p_target_language THEN
    RAISE EXCEPTION 'source_language must differ from target_language';
  END IF;

  v_deck_id := extensions.uuid_generate_v5(v_deck_namespace, p_manifest_key);

  INSERT INTO decks (
    id, user_id, name, description, share_mode, is_readonly
  ) VALUES (
    v_deck_id,
    '00000000-0000-0000-0000-000000000001',
    '[FAILED IMPORT] ' || p_manifest_key,
    'Awaiting retry — last import failed',
    'subscribe',
    true
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO official_deck_manifest (
    manifest_key, deck_id, source_file, source_language, target_language,
    category, card_count, last_status, last_error, last_applied_at
  ) VALUES (
    p_manifest_key, v_deck_id, p_source_file, p_source_language, p_target_language,
    p_category, 0, 'failed', p_error, NOW()
  )
  ON CONFLICT (manifest_key) DO UPDATE SET
    last_status     = 'failed',
    last_error      = EXCLUDED.last_error,
    last_applied_at = NOW(),
    updated_at      = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION mark_official_deck_failed(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

COMMIT;
