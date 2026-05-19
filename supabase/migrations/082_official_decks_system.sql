-- ============================================================================
-- Migration 082 — Official Decks System
-- Reference: DOCS/OFFICIAL-DECKS/IMPLEMENTATION-PLAN.md
--             DOCS/OFFICIAL-DECKS/ADR-001-clean-architecture-cli.md
--             DOCS/OFFICIAL-DECKS/ADR-002-identity-and-idempotency.md
--
-- Adds:
--   1. System "official" auth user + profile + official_account_settings
--   2. Two canonical card templates (Word + Phrase) with fixed UUIDs
--   3. official_deck_manifest table (audit + idempotency state)
--   4. import_official_deck(p_manifest_key, p_checksum, p_deck, p_cards) RPC
--      — atomic, idempotent upsert of deck + cards + marketplace listing + manifest
--   5. get_official_deck_manifest() read RPC
--
-- All writes go through SECURITY DEFINER RPCs. CLI uses Supabase service role.
-- ============================================================================

BEGIN;

-- ─── 0. Constants (documented; not enforced as DB objects) ─────────────────
-- system_user_id   = 00000000-0000-0000-0000-000000000001
-- word_template_id = 11111111-1111-1111-1111-111111111111
-- phrase_template_id = 22222222-2222-2222-2222-222222222222
-- deck_namespace   = 6f7d8a9b-3c4e-4d6f-8a8b-9c0d1e2f3a4b   (UUIDv5 namespace)
-- card_namespace   = 7e8f9a0b-1c2d-4e4f-8a6b-7c8d9e0f1a2b   (UUIDv5 namespace)

-- ─── 1. Seed system auth.users row ─────────────────────────────────────────
-- This user owns all official decks. It can never log in (no password).
-- The trigger `on_auth_user_created` (001) will fire and create a profile.
-- The trigger `on_profile_created_templates` (001) will create 3 default
-- templates owned by this user; that is harmless (they coexist with the
-- fixed-UUID templates we seed below).

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'official@reeeeecallstudy.local',
  NULL,
  NOW(),
  '{"provider":"system","providers":["system"]}'::jsonb,
  '{"display_name":"ReeeeecallStudy Official"}'::jsonb,
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Ensure profile exists (the handle_new_user trigger may have created it,
-- but if for any reason it didn't, we create it now). Direct INSERT bypasses
-- the prevent_official_escalation trigger (which only fires on UPDATE).
INSERT INTO profiles (id, display_name, role, is_official, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'ReeeeecallStudy Official',
  'user',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- If the trigger already created the profile with is_official=false, flip it.
-- The prevent_official_escalation trigger (039) blocks non-admin updates of
-- is_official. We disable it for this one statement, then re-enable.
ALTER TABLE profiles DISABLE TRIGGER trg_prevent_official_escalation;

UPDATE profiles
SET display_name = 'ReeeeecallStudy Official',
    is_official  = true,
    updated_at   = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001';

ALTER TABLE profiles ENABLE TRIGGER trg_prevent_official_escalation;

-- ─── 2. official_account_settings ──────────────────────────────────────────
INSERT INTO official_account_settings (
  user_id,
  display_badge,
  badge_color,
  organization_name,
  featured_priority,
  max_listings,
  can_feature_listings,
  verified_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'official',
  '#0ea5e9',
  'ReeeeecallStudy',
  100,
  1000,
  true,
  NOW()
)
ON CONFLICT (user_id) DO UPDATE SET
  display_badge        = EXCLUDED.display_badge,
  badge_color          = EXCLUDED.badge_color,
  organization_name    = EXCLUDED.organization_name,
  featured_priority    = EXCLUDED.featured_priority,
  max_listings         = EXCLUDED.max_listings,
  can_feature_listings = EXCLUDED.can_feature_listings,
  updated_at           = NOW();

-- ─── 3. Canonical card templates with fixed UUIDs ──────────────────────────
-- These are used by every official deck. The user-facing field names use the
-- target audience's display language at render time via i18n; the storage keys
-- are stable.

INSERT INTO card_templates (
  id, user_id, name, fields, front_layout, back_layout, is_default
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000001',
  'Official Bilingual Word',
  '[
    {"key":"front","name":"Front","type":"text","order":0},
    {"key":"back","name":"Back","type":"text","order":1},
    {"key":"example_front","name":"Front Example","type":"text","order":2},
    {"key":"example_back","name":"Back Example","type":"text","order":3}
  ]'::jsonb,
  '[
    {"field_key":"front","style":"primary"},
    {"field_key":"example_front","style":"detail"}
  ]'::jsonb,
  '[
    {"field_key":"back","style":"primary"},
    {"field_key":"example_back","style":"detail"}
  ]'::jsonb,
  false
)
ON CONFLICT (id) DO UPDATE SET
  name         = EXCLUDED.name,
  fields       = EXCLUDED.fields,
  front_layout = EXCLUDED.front_layout,
  back_layout  = EXCLUDED.back_layout,
  updated_at   = NOW();

INSERT INTO card_templates (
  id, user_id, name, fields, front_layout, back_layout, is_default
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000001',
  'Official Bilingual Phrase',
  '[
    {"key":"front","name":"Front","type":"text","order":0},
    {"key":"back","name":"Back","type":"text","order":1},
    {"key":"alt","name":"Alt","type":"text","order":2},
    {"key":"situation","name":"Situation","type":"text","order":3},
    {"key":"note","name":"Note","type":"text","order":4}
  ]'::jsonb,
  '[
    {"field_key":"front","style":"primary"},
    {"field_key":"situation","style":"hint"}
  ]'::jsonb,
  '[
    {"field_key":"back","style":"primary"},
    {"field_key":"alt","style":"detail"},
    {"field_key":"note","style":"detail"}
  ]'::jsonb,
  false
)
ON CONFLICT (id) DO UPDATE SET
  name         = EXCLUDED.name,
  fields       = EXCLUDED.fields,
  front_layout = EXCLUDED.front_layout,
  back_layout  = EXCLUDED.back_layout,
  updated_at   = NOW();

-- ─── 4. official_deck_manifest ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS official_deck_manifest (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_key           TEXT UNIQUE NOT NULL,
  deck_id                UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  source_file            TEXT NOT NULL,
  source_language        TEXT NOT NULL,
  target_language        TEXT NOT NULL,
  category               TEXT NOT NULL,
  card_count             INTEGER NOT NULL DEFAULT 0,
  last_applied_checksum  TEXT,
  last_applied_at        TIMESTAMPTZ,
  last_status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK (last_status IN ('pending','applied','failed','noop')),
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_odm_lang_pair_distinct CHECK (source_language <> target_language)
);

CREATE INDEX IF NOT EXISTS idx_odm_status   ON official_deck_manifest(last_status);
CREATE INDEX IF NOT EXISTS idx_odm_category ON official_deck_manifest(category);
CREATE INDEX IF NOT EXISTS idx_odm_lang_pair ON official_deck_manifest(source_language, target_language);
CREATE INDEX IF NOT EXISTS idx_odm_deck      ON official_deck_manifest(deck_id);

ALTER TABLE official_deck_manifest ENABLE ROW LEVEL SECURITY;

-- The manifest is public: anyone can read it (useful for admin dashboards
-- and for the CLI's `validate` command to compare DB state to CSV state).
DROP POLICY IF EXISTS "Anyone reads manifest" ON official_deck_manifest;
CREATE POLICY "Anyone reads manifest"
  ON official_deck_manifest FOR SELECT
  USING (true);

-- Writes only via SECURITY DEFINER RPC. As a defence-in-depth, allow admins
-- direct write access too (for emergency manual fixes).
DROP POLICY IF EXISTS "Admins manage manifest" ON official_deck_manifest;
CREATE POLICY "Admins manage manifest"
  ON official_deck_manifest FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── 5. import_official_deck RPC ───────────────────────────────────────────
-- p_deck   : {name, description, color, icon, template_id, category, tags[],
--             source_file, source_language, target_language}
-- p_cards  : [ {id, sort_position, field_values, tags[]} , ... ]
--
-- Permission: caller is service_role, anonymous JWT-less psql session, or
--             admin-role profile. Regular authenticated users are blocked.
--
-- Behaviour:
--   • Idempotent — same checksum + same manifest_key → noop.
--   • Atomic     — single transaction (function is a tx by definition).
--   • Diff-apply — cards in DB but absent from payload are deleted.
--                  cards in payload but absent from DB are inserted.
--                  cards present in both are updated (field_values, tags, sort_position).

CREATE OR REPLACE FUNCTION import_official_deck(
  p_manifest_key TEXT,
  p_checksum     TEXT,
  p_deck         JSONB,
  p_cards        JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  -- ─── Permission gate ─────────────────────────────────────────────────
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
  -- service_role and NULL (direct psql / migration) pass through.

  -- ─── Extract & validate payload ──────────────────────────────────────
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

  -- ─── Compute deterministic deck_id ───────────────────────────────────
  v_deck_id := uuid_generate_v5(v_deck_namespace, p_manifest_key);

  -- ─── Noop short-circuit on unchanged checksum ────────────────────────
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

  -- ─── Upsert deck ─────────────────────────────────────────────────────
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

  -- ─── Diff-apply cards ────────────────────────────────────────────────
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

  -- Diff-aware upsert: only mark rows as "updated" when the payload actually
  -- changes field_values / tags / sort_position. This makes the report
  -- granular (a single CSV edit → cards_updated = 1, not N).
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

  -- ─── Upsert marketplace listing ──────────────────────────────────────
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

  -- ─── Upsert manifest row ─────────────────────────────────────────────
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

-- ─── 6. mark_official_deck_failed RPC ──────────────────────────────────────
-- Lets the CLI record a failed import in the manifest after a rollback.
-- Accepts full deck metadata so the insert is valid even for first-attempt
-- failures (the check constraint requires source_language <> target_language).
-- Re-using the same deck_id namespace ensures a successful retry overwrites
-- the failed row in place.

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
SET search_path = public
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

  v_deck_id := uuid_generate_v5(v_deck_namespace, p_manifest_key);

  -- The deck row may not exist yet (first-ever attempt failed before the
  -- deck was inserted). Create a placeholder deck so the FK is valid; if it
  -- already exists, the retry will overwrite it on next success.
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

-- ─── 7. get_official_deck_manifest read RPC ────────────────────────────────
CREATE OR REPLACE FUNCTION get_official_deck_manifest()
RETURNS TABLE (
  manifest_key           TEXT,
  deck_id                UUID,
  source_file            TEXT,
  source_language        TEXT,
  target_language        TEXT,
  category               TEXT,
  card_count             INTEGER,
  last_applied_checksum  TEXT,
  last_applied_at        TIMESTAMPTZ,
  last_status            TEXT,
  last_error             TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.manifest_key,
    m.deck_id,
    m.source_file,
    m.source_language,
    m.target_language,
    m.category,
    m.card_count,
    m.last_applied_checksum,
    m.last_applied_at,
    m.last_status,
    m.last_error
  FROM official_deck_manifest m
  ORDER BY m.category, m.source_file, m.target_language;
END;
$$;

GRANT EXECUTE ON FUNCTION get_official_deck_manifest() TO authenticated, anon, service_role;

COMMIT;
