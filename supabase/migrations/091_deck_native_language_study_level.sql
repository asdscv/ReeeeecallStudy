-- ============================================================================
-- Migration 091 — Deck native_language + study_level (optional, user-settable)
--
-- Adds two OPTIONAL deck-authoring fields:
--   • native_language — the learner's mother tongue (the "explanation" side of a
--     bilingual deck). Completes the existing marketplace native-language filter
--     (which until now only derived a value from the official `source:<lang>`
--     tag): user-created decks can now declare their native language explicitly.
--   • study_level — a 5-level study scale (초급/초중급/중급/중고급/고급).
--
-- NOTE: no RPC change. import_official_deck upserts decks/listings with
-- ON CONFLICT DO UPDATE that only sets listed columns, so these backfilled
-- values survive re-imports. Existing decks are populated by the backfill below;
-- user decks set the values via createDeck/updateDeck. This migration is purely
-- additive (new nullable columns + check constraints + index + backfill).
--
-- study_level codes map to labels:
--   beginner=초급, upper_beginner=초중급, intermediate=중급,
--   upper_intermediate=중고급, advanced=고급
--
-- Idempotent (IF NOT EXISTS / guarded constraints / WHERE … IS NULL).
-- ============================================================================

BEGIN;

-- ─── 1. decks.native_language ──────────────────────────────────────────────
ALTER TABLE decks ADD COLUMN IF NOT EXISTS native_language TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_decks_native_language') THEN
    ALTER TABLE decks ADD CONSTRAINT chk_decks_native_language
      CHECK (native_language IS NULL OR native_language IN
        ('en','ko','zh','ja','es','vi','th','id'));
  END IF;
END $$;

-- ─── 2. decks.study_level (5-level scale) ──────────────────────────────────
ALTER TABLE decks ADD COLUMN IF NOT EXISTS study_level TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_decks_study_level') THEN
    ALTER TABLE decks ADD CONSTRAINT chk_decks_study_level
      CHECK (study_level IS NULL OR study_level IN
        ('beginner','upper_beginner','intermediate','upper_intermediate','advanced'));
  END IF;
END $$;

-- ─── 3. marketplace_listings.native_language (feeds the native filter) ─────
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS native_language TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ml_native_language') THEN
    ALTER TABLE marketplace_listings ADD CONSTRAINT chk_ml_native_language
      CHECK (native_language IS NULL OR native_language IN
        ('en','ko','zh','ja','es','vi','th','id'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ml_native_language
  ON marketplace_listings(native_language)
  WHERE native_language IS NOT NULL;

-- ─── 3b. marketplace_listings.study_level (feeds the study-level filter) ───
ALTER TABLE marketplace_listings ADD COLUMN IF NOT EXISTS study_level TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ml_study_level') THEN
    ALTER TABLE marketplace_listings ADD CONSTRAINT chk_ml_study_level
      CHECK (study_level IS NULL OR study_level IN
        ('beginner','upper_beginner','intermediate','upper_intermediate','advanced'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ml_study_level
  ON marketplace_listings(study_level)
  WHERE study_level IS NOT NULL;

-- ─── 4. Backfill official decks: native_language = non-English side ────────
-- Forward (en→ko): native=target(ko). Reverse (ko→en): native=source(ko).
-- Phrase (ko→en): native=source(ko). Always the non-'en' language.
UPDATE decks d
SET native_language = CASE WHEN m.source_language = 'en'
                          THEN m.target_language ELSE m.source_language END
FROM official_deck_manifest m
WHERE m.deck_id = d.id
  AND d.user_id = '00000000-0000-0000-0000-000000000001'
  AND d.native_language IS NULL;

UPDATE marketplace_listings ml
SET native_language = CASE WHEN m.source_language = 'en'
                          THEN m.target_language ELSE m.source_language END
FROM official_deck_manifest m
WHERE m.deck_id = ml.deck_id
  AND ml.owner_id = '00000000-0000-0000-0000-000000000001'
  AND ml.native_language IS NULL;

-- ─── 5. Backfill official decks: study_level ───────────────────────────────
-- Vocab tiers map directly; exam decks map by score tier (section 5b).
-- Conversation decks have no clean level → left NULL (optional).
UPDATE decks d
SET study_level = CASE m.category
  WHEN 'beginner'     THEN 'beginner'
  WHEN 'intermediate' THEN 'intermediate'
  WHEN 'advanced'     THEN 'advanced'
END
FROM official_deck_manifest m
WHERE m.deck_id = d.id
  AND d.user_id = '00000000-0000-0000-0000-000000000001'
  AND d.study_level IS NULL
  AND m.category IN ('beginner','intermediate','advanced');

UPDATE marketplace_listings ml
SET study_level = CASE m.category
  WHEN 'beginner'     THEN 'beginner'
  WHEN 'intermediate' THEN 'intermediate'
  WHEN 'advanced'     THEN 'advanced'
END
FROM official_deck_manifest m
WHERE m.deck_id = ml.deck_id
  AND ml.owner_id = '00000000-0000-0000-0000-000000000001'
  AND ml.study_level IS NULL
  AND m.category IN ('beginner','intermediate','advanced');

-- ─── 5b. Backfill exam decks: study_level by score tier (per source_file) ──
-- IELTS 5.x→중급, 6.x→중고급, 7.x→고급. TOEFL 60/80→중급, 100/110→중고급,
-- 120→고급. TOEIC 600/700→중급, 800→중고급, 900/990→고급.
UPDATE decks d
SET study_level = CASE
  WHEN m.source_file LIKE 'ielts-5.%'  THEN 'intermediate'
  WHEN m.source_file LIKE 'ielts-6.%'  THEN 'upper_intermediate'
  WHEN m.source_file LIKE 'ielts-7.%'  THEN 'advanced'
  WHEN m.source_file LIKE 'toefl-60-%'  OR m.source_file LIKE 'toefl-80-%'  THEN 'intermediate'
  WHEN m.source_file LIKE 'toefl-100-%' OR m.source_file LIKE 'toefl-110-%' THEN 'upper_intermediate'
  WHEN m.source_file LIKE 'toefl-120-%' THEN 'advanced'
  WHEN m.source_file LIKE 'toeic-600-%' OR m.source_file LIKE 'toeic-700-%' THEN 'intermediate'
  WHEN m.source_file LIKE 'toeic-800-%' THEN 'upper_intermediate'
  WHEN m.source_file LIKE 'toeic-900-%' OR m.source_file LIKE 'toeic-990-%' THEN 'advanced'
END
FROM official_deck_manifest m
WHERE m.deck_id = d.id
  AND d.user_id = '00000000-0000-0000-0000-000000000001'
  AND d.study_level IS NULL
  AND m.category IN ('ielts','toefl','toeic');

UPDATE marketplace_listings ml
SET study_level = CASE
  WHEN m.source_file LIKE 'ielts-5.%'  THEN 'intermediate'
  WHEN m.source_file LIKE 'ielts-6.%'  THEN 'upper_intermediate'
  WHEN m.source_file LIKE 'ielts-7.%'  THEN 'advanced'
  WHEN m.source_file LIKE 'toefl-60-%'  OR m.source_file LIKE 'toefl-80-%'  THEN 'intermediate'
  WHEN m.source_file LIKE 'toefl-100-%' OR m.source_file LIKE 'toefl-110-%' THEN 'upper_intermediate'
  WHEN m.source_file LIKE 'toefl-120-%' THEN 'advanced'
  WHEN m.source_file LIKE 'toeic-600-%' OR m.source_file LIKE 'toeic-700-%' THEN 'intermediate'
  WHEN m.source_file LIKE 'toeic-800-%' THEN 'upper_intermediate'
  WHEN m.source_file LIKE 'toeic-900-%' OR m.source_file LIKE 'toeic-990-%' THEN 'advanced'
END
FROM official_deck_manifest m
WHERE m.deck_id = ml.deck_id
  AND ml.owner_id = '00000000-0000-0000-0000-000000000001'
  AND ml.study_level IS NULL
  AND m.category IN ('ielts','toefl','toeic');

COMMIT;
