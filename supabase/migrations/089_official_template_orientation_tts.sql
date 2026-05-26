-- ============================================================================
-- Migration 089 — Official Template TTS + Reverse-direction template
--
-- TEMPLATE-ONLY edit. No card data is touched.
--
-- Context: official decks teach English. We keep BOTH study directions so the
-- marketplace can offer each:
--   • Forward  (existing) — word template 1111: card "front" holds ENGLISH,
--     "back" holds the learner's native language. Shown English-first.
--   • Reverse  (new)      — word template 3333: cards are generated native-first
--     (front = native, back = ENGLISH), so the learner sees the native prompt
--     and reveals/【hears】the English answer. This matches the reference
--     `영어 회화!` deck (native prompt → English answer, English voiced).
--
-- WHY each change:
--   1. Word template 1111 — KEEP the English-first layout (do NOT swap). Add TTS
--      to the ENGLISH fields ("front","example_front") so English is voiced.
--   2. Phrase template 2222 — KEEP layout (front already shows Korean first).
--      Add TTS to the ENGLISH fields ("back","alt").
--   3. NEW reverse word template 3333 — standard layout (front shown first); in
--      reverse cards the ENGLISH lives in "back"/"example_back", so TTS goes
--      there. Used by the reverse-direction word decks.
--
-- All statements are idempotent (UPDATE / INSERT ... ON CONFLICT DO UPDATE).
-- ============================================================================

BEGIN;

-- ─── Word template (1111-...) — forward / English-first ────────────────────
-- Layout unchanged from migration 082 (English first). Only add TTS to the
-- English fields (front, example_front); leave native fields without TTS.
UPDATE card_templates
SET fields = '[
    {"key":"front","name":"Front","type":"text","order":0,"tts_lang":"en-US","tts_enabled":true},
    {"key":"back","name":"Back","type":"text","order":1},
    {"key":"example_front","name":"Front Example","type":"text","order":2,"tts_lang":"en-US","tts_enabled":true},
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

-- ─── Phrase template (2222-...) ────────────────────────────────────────────
-- KEEP front_layout/back_layout as-is (front already shows Korean first).
-- Add TTS to the English fields (back, alt); leave front, situation, note
-- without TTS.
UPDATE card_templates
SET fields = '[
    {"key":"front","name":"Front","type":"text","order":0},
    {"key":"back","name":"Back","type":"text","order":1,"tts_lang":"en-US","tts_enabled":true},
    {"key":"alt","name":"Alt","type":"text","order":2,"tts_lang":"en-US","tts_enabled":true},
    {"key":"situation","name":"Situation","type":"text","order":3},
    {"key":"note","name":"Note","type":"text","order":4}
  ]'::jsonb,
    updated_at = NOW()
WHERE id = '22222222-2222-2222-2222-222222222222';

-- ─── Reverse word template (3333-...) — native-first / English voiced ──────
-- Mirror of the word template but for reverse-direction decks whose cards are
-- generated native-first (front = native, back = ENGLISH). Standard layout
-- (front shown first); TTS on the English fields (back, example_back).
INSERT INTO card_templates (
  id, user_id, name, fields, front_layout, back_layout, is_default
) VALUES (
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000001',
  'Official Bilingual Word (Reverse)',
  '[
    {"key":"front","name":"Front","type":"text","order":0},
    {"key":"back","name":"Back","type":"text","order":1,"tts_lang":"en-US","tts_enabled":true},
    {"key":"example_front","name":"Front Example","type":"text","order":2},
    {"key":"example_back","name":"Back Example","type":"text","order":3,"tts_lang":"en-US","tts_enabled":true}
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

COMMIT;
