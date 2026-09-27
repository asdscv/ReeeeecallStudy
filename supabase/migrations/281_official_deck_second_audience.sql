-- Official decks have two audiences, and we only ever recorded one.
--
-- Every official deck is an en<->X pair shipped in both directions. The import
-- pipeline labelled each row from one side only -- `native_languages = ['ko']` for a
-- Korean deck -- because DeckMetadataI18n's rule is that the audience is always the
-- non-English speaker practising English.
--
-- The other side was always there in the cards. A `ko -> en` deck shows Korean and
-- answers in English, which is what an English speaker learning Korean needs; an
-- `en -> ko` deck is the same pair in the production direction. 649 decks and roughly
-- 192,000 cards, and an English speaker filtering the marketplace got exactly zero,
-- because no row listed `en` as a mother tongue.
--
-- This records both sides. `native_languages` becomes the deck's language pair, read
-- from the `source:`/`target:` tags the importer already writes. Nothing is created and
-- no card moves; the singular `native_language` column is left untouched so existing
-- readers keep the behaviour they have.
--
-- Safe to re-run. `card_count` is not touched, so trg_auto_version_on_listing_update
-- returns early and no deck_versions rows are written.

-- ── marketplace_listings ──────────────────────────────────────────────────────
WITH pair AS (
  SELECT
    ml.id,
    ARRAY(
      SELECT DISTINCT substring(t FROM position(':' IN t) + 1)
      FROM unnest(ml.tags) t
      WHERE t LIKE 'source:%' OR t LIKE 'target:%'
      ORDER BY 1
    ) AS langs
  FROM marketplace_listings ml
  WHERE ml.owner_is_official
)
UPDATE marketplace_listings ml
SET native_languages = pair.langs
FROM pair
WHERE ml.id = pair.id
  AND array_length(pair.langs, 1) = 2          -- both sides present, or we know nothing
  AND ml.native_languages IS DISTINCT FROM pair.langs;

-- ── decks (kept in step; nothing syncs these two automatically) ───────────────
WITH pair AS (
  SELECT
    ml.deck_id,
    ARRAY(
      SELECT DISTINCT substring(t FROM position(':' IN t) + 1)
      FROM unnest(ml.tags) t
      WHERE t LIKE 'source:%' OR t LIKE 'target:%'
      ORDER BY 1
    ) AS langs
  FROM marketplace_listings ml
  WHERE ml.owner_is_official
)
UPDATE decks d
SET native_languages = pair.langs
FROM pair
WHERE d.id = pair.deck_id
  AND array_length(pair.langs, 1) = 2
  AND d.native_languages IS DISTINCT FROM pair.langs;

-- An English speaker must now find decks. If this is 0 the migration did nothing and
-- the tags are not shaped the way we think.
DO $$
DECLARE
  v_en INTEGER;
BEGIN
  SELECT count(*) INTO v_en
  FROM marketplace_listings
  WHERE is_active AND owner_is_official AND 'en' = ANY(native_languages);

  IF v_en = 0 THEN
    RAISE EXCEPTION 'migration 281 left zero official decks addressable to English speakers';
  END IF;

  RAISE NOTICE 'migration 281: % official listings now list en as a mother tongue', v_en;
END $$;
