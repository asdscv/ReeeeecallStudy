-- ============================================================================
-- Migration 092 — Deck native_languages[] (multi-select)
--
-- Adds native_languages TEXT[] to decks + marketplace_listings, ALONGSIDE the
-- existing scalar native_language (kept populated for backward compatibility:
-- marketplace filtering is client-side — `select('*')` + JS filterListings —
-- so deployed/installed clients read native_language as a scalar. Changing the
-- column type in place would break them, hence this additive design).
--
-- Backfill of official decks (via official_deck_manifest):
--   • forward       (source='en')               → [target]   (EN→KO ⇒ ['ko'])
--   • reverse conv  (target='en', cat=conversation) → [source] (Real Conversation
--                     KO→EN: a Korean-native English-production deck ⇒ ['ko'])
--   • reverse vocab (target='en', cat≠conversation) → ['en']  (X→EN word deck:
--                     the explanation/back side is English ⇒ for English natives)
--
-- The scalar native_language is then corrected to native_languages[1], so legacy
-- clients immediately classify reverse vocab decks under 'en' (fixes the reports:
-- "verified deck answers are English-only" / "KO→EN should be for English natives").
--
-- Idempotent (IF NOT EXISTS / guarded constraints / WHERE native_languages IS NULL).
-- ============================================================================

BEGIN;

-- ─── 1. Columns (additive, nullable) ───────────────────────────────────────
ALTER TABLE decks                ADD COLUMN IF NOT EXISTS native_languages TEXT[];
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS native_languages TEXT[];

-- ─── 2. CHECK: every element ∈ supported language set ──────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_decks_native_languages') THEN
    ALTER TABLE decks ADD CONSTRAINT chk_decks_native_languages
      CHECK (native_languages IS NULL
             OR native_languages <@ ARRAY['en','ko','zh','ja','es','vi','th','id']::TEXT[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_listings_native_languages') THEN
    ALTER TABLE marketplace_listings ADD CONSTRAINT chk_listings_native_languages
      CHECK (native_languages IS NULL
             OR native_languages <@ ARRAY['en','ko','zh','ja','es','vi','th','id']::TEXT[]);
  END IF;
END $$;

-- ─── 3. GIN indexes for array membership (future server-side filtering) ────
CREATE INDEX IF NOT EXISTS idx_decks_native_languages
  ON decks USING GIN (native_languages);
CREATE INDEX IF NOT EXISTS idx_listings_native_languages
  ON marketplace_listings USING GIN (native_languages);

-- ─── 4. Backfill official decks via manifest ───────────────────────────────
UPDATE decks d
SET native_languages = CASE
  WHEN m.source_language = 'en'      THEN ARRAY[m.target_language]
  WHEN m.category = 'conversation'   THEN ARRAY[m.source_language]
  ELSE ARRAY['en']
END
FROM official_deck_manifest m
WHERE m.deck_id = d.id
  AND d.user_id = '00000000-0000-0000-0000-000000000001'
  AND d.native_languages IS NULL;

UPDATE marketplace_listings ml
SET native_languages = CASE
  WHEN m.source_language = 'en'      THEN ARRAY[m.target_language]
  WHEN m.category = 'conversation'   THEN ARRAY[m.source_language]
  ELSE ARRAY['en']
END
FROM official_deck_manifest m
WHERE m.deck_id = ml.deck_id
  AND ml.owner_id = '00000000-0000-0000-0000-000000000001'
  AND ml.native_languages IS NULL;

-- ─── 5. Backfill user decks: wrap the existing scalar ──────────────────────
UPDATE decks
SET native_languages = ARRAY[native_language]
WHERE native_languages IS NULL AND native_language IS NOT NULL;

UPDATE marketplace_listings
SET native_languages = ARRAY[native_language]
WHERE native_languages IS NULL AND native_language IS NOT NULL;

-- ─── 6. Correct scalar native_language = primary (array[1]) ────────────────
-- Reverse vocab decks flip 'ko'/'ja'/… → 'en' for legacy clients.
UPDATE decks
SET native_language = native_languages[1]
WHERE native_languages IS NOT NULL
  AND native_language IS DISTINCT FROM native_languages[1];

UPDATE marketplace_listings
SET native_language = native_languages[1]
WHERE native_languages IS NOT NULL
  AND native_language IS DISTINCT FROM native_languages[1];

COMMIT;
