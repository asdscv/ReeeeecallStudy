-- ============================================================================
-- Down migration for 089_official_template_orientation_tts
-- Restores templates 1111/2222 to their 082 definitions (no TTS flags) and
-- removes the reverse word template 3333. Template-only; no card data touched.
-- For local/dev rollback. Not auto-applied; run manually if needed.
-- NOTE: any decks/cards created with template 3333 must be removed first
-- (FK), or this DELETE will fail — intended for dev rollback before reverse
-- decks are imported.
-- ============================================================================

BEGIN;

-- ─── Word template (1111-...) — restore 082 fields + layouts ───────────────
UPDATE card_templates
SET fields = '[
    {"key":"front","name":"Front","type":"text","order":0},
    {"key":"back","name":"Back","type":"text","order":1},
    {"key":"example_front","name":"Front Example","type":"text","order":2},
    {"key":"example_back","name":"Back Example","type":"text","order":3}
  ]'::jsonb,
    front_layout = '[
    {"field_key":"front","style":"primary"},
    {"field_key":"example_front","style":"detail"}
  ]'::jsonb,
    back_layout = '[
    {"field_key":"back","style":"primary"},
    {"field_key":"example_back","style":"detail"}
  ]'::jsonb,
    updated_at = NOW()
WHERE id = '11111111-1111-1111-1111-111111111111';

-- ─── Phrase template (2222-...) — restore 082 fields (layouts unchanged) ───
UPDATE card_templates
SET fields = '[
    {"key":"front","name":"Front","type":"text","order":0},
    {"key":"back","name":"Back","type":"text","order":1},
    {"key":"alt","name":"Alt","type":"text","order":2},
    {"key":"situation","name":"Situation","type":"text","order":3},
    {"key":"note","name":"Note","type":"text","order":4}
  ]'::jsonb,
    updated_at = NOW()
WHERE id = '22222222-2222-2222-2222-222222222222';

-- ─── Remove reverse word template (3333-...) added by 089 ──────────────────
DELETE FROM card_templates
WHERE id = '33333333-3333-3333-3333-333333333333';

COMMIT;
