-- ============================================================================
-- Migration 094 — Align official reverse-vocab decks' native_language(s) to the
--                 learner's mother tongue (the non-English side).
--
-- Background: migration 092 tagged reverse vocabulary decks (X→EN word decks)
-- with native_languages = ['en'], reasoning that the back/answer side is English
-- and so the deck is "for English natives". But these decks teach ENGLISH
-- vocabulary to speakers of X (front = X prompt, back = English word to produce),
-- and migration 091/relocalization renders their title in X (the mother tongue).
-- That left the marketplace native filter inconsistent with the display title:
-- a learner filtering by their own language (e.g. ko) would NOT see the reverse
-- (production) decks, only the forward (recognition) ones.
--
-- This migration re-backfills reverse-vocab official decks to
-- native_languages = [source_language] (= the non-English side, the mother
-- tongue), matching forward and conversation decks. Forward (EN→X ⇒ [X]) and
-- conversation (X→EN ⇒ [source]) decks are already correct and untouched.
--
-- Idempotent: guarded by IS DISTINCT FROM. Re-runnable.
-- Deploy: DB migration (not OTA) — apply via `supabase db push` or the
-- management SQL endpoint after merge to main.
-- ============================================================================

BEGIN;

-- ─── 1. decks: reverse vocab (target='en', category≠conversation) → [source] ─
UPDATE decks d
SET native_languages = ARRAY[m.source_language]
FROM official_deck_manifest m
WHERE m.deck_id = d.id
  AND d.user_id = '00000000-0000-0000-0000-000000000001'
  AND m.target_language = 'en'
  AND m.category <> 'conversation'
  AND d.native_languages IS DISTINCT FROM ARRAY[m.source_language];

-- ─── 2. marketplace_listings: same ─────────────────────────────────────────
UPDATE marketplace_listings ml
SET native_languages = ARRAY[m.source_language]
FROM official_deck_manifest m
WHERE m.deck_id = ml.deck_id
  AND ml.owner_id = '00000000-0000-0000-0000-000000000001'
  AND m.target_language = 'en'
  AND m.category <> 'conversation'
  AND ml.native_languages IS DISTINCT FROM ARRAY[m.source_language];

-- ─── 3. Correct the scalar native_language = native_languages[1] ───────────
UPDATE decks
SET native_language = native_languages[1]
WHERE native_languages IS NOT NULL
  AND native_language IS DISTINCT FROM native_languages[1];

UPDATE marketplace_listings
SET native_language = native_languages[1]
WHERE native_languages IS NOT NULL
  AND native_language IS DISTINCT FROM native_languages[1];

COMMIT;
