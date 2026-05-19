-- ============================================================================
-- Down migration for 082_official_decks_system
-- For local/dev rollback. Not auto-applied; run manually if needed.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS get_official_deck_manifest();
DROP FUNCTION IF EXISTS mark_official_deck_failed(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS import_official_deck(TEXT, TEXT, JSONB, JSONB);

-- Deck rows owned by system user will cascade delete cards + marketplace_listings + manifest
DELETE FROM decks WHERE user_id = '00000000-0000-0000-0000-000000000001';

DROP TABLE IF EXISTS official_deck_manifest;

DELETE FROM card_templates WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

DELETE FROM official_account_settings
  WHERE user_id = '00000000-0000-0000-0000-000000000001';

DELETE FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001';
DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001';

COMMIT;
