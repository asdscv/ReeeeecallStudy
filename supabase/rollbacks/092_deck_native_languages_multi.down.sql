-- Rollback for migration 092 — deck native_languages[]
-- Additive change: drop the new array columns + constraints + indexes.
-- NOTE: the scalar native_language corrections (step 6) are NOT reverted — they
-- are independently valid (reverse vocab decks should be 'en' regardless). If a
-- full revert of native_language is required, re-run migration 091's backfill.

BEGIN;

DROP INDEX IF EXISTS idx_decks_native_languages;
DROP INDEX IF EXISTS idx_listings_native_languages;

ALTER TABLE decks                DROP CONSTRAINT IF EXISTS chk_decks_native_languages;
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS chk_listings_native_languages;

ALTER TABLE decks                DROP COLUMN IF EXISTS native_languages;
ALTER TABLE marketplace_listings DROP COLUMN IF EXISTS native_languages;

COMMIT;
