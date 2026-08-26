/**
 * Unit tests for in-progress card-entry (draft) persistence core logic.
 * Run with: npx tsx src/utils/card-draft-core.test.ts
 *
 * Pure module (no RN/expo) — exercises the real form-identity guard, freshness
 * rule, and parser that decide whether a half-typed card is poured back into a
 * form. The failure this protects against is silent: restoring the wrong draft
 * overwrites content the user did not ask to change.
 */
import {
  CARD_DRAFT_MAX_AGE_MS,
  cardDraftKey,
  hasDraftContent,
  isRestorableDraft,
  parseCardDraft,
  serializeCardDraft,
  type CardDraft,
} from './card-draft-core'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

const NOW = 1_700_000_000_000
const KEY = cardDraftKey('deck-1', null)
const draft = (over: Partial<CardDraft> = {}): CardDraft => ({
  key: KEY,
  fieldValues: { field_1: '고양이' },
  tags: '',
  savedAt: NOW,
  ...over,
})

// ── cardDraftKey ──
check('key: create mode has no card id', cardDraftKey('deck-1') === 'deck-1:new')
check('key: null card id === create mode', cardDraftKey('deck-1', null) === 'deck-1:new')
check('key: edit mode names the card', cardDraftKey('deck-1', 'card-9') === 'deck-1:card-9')
check('key: different decks never collide', cardDraftKey('deck-1') !== cardDraftKey('deck-2'))
check('key: create mode differs from editing a card in the same deck',
  cardDraftKey('deck-1') !== cardDraftKey('deck-1', 'card-9'))

// ── hasDraftContent ──
check('content: a typed field counts', hasDraftContent({ field_1: 'a' }, ''))
check('content: tags alone count', hasDraftContent({}, 'kanji'))
check('content: empty form does not', !hasDraftContent({}, ''))
check('content: blank strings do not', !hasDraftContent({ field_1: '', field_2: '' }, ''))
check('content: whitespace is not content', !hasDraftContent({ field_1: '   ' }, '  \n '))
check('content: whitespace + real text counts', hasDraftContent({ field_1: ' ', field_2: 'x' }, ''))

// ── serialize / parse round-trip ──
check('round-trip: preserves values, tags and key', (() => {
  const raw = serializeCardDraft(KEY, { field_1: '  spaced  ', field_2: '뜻' }, 'n5, verb', NOW)
  const back = parseCardDraft(raw)
  return back?.key === KEY
    && back.fieldValues.field_1 === '  spaced  '   // exact text, untrimmed
    && back.fieldValues.field_2 === '뜻'
    && back.tags === 'n5, verb'
    && back.savedAt === NOW
})())

// ── parseCardDraft ──
check('parse: null input → null', parseCardDraft(null) === null)
check('parse: empty string → null', parseCardDraft('') === null)
check('parse: invalid JSON → null', parseCardDraft('{not json') === null)
check('parse: missing key → null', parseCardDraft('{"fieldValues":{},"savedAt":1}') === null)
check('parse: empty key → null', parseCardDraft('{"key":"","fieldValues":{},"savedAt":1}') === null)
check('parse: missing savedAt → null', parseCardDraft('{"key":"k","fieldValues":{}}') === null)
check('parse: non-number savedAt → null', parseCardDraft('{"key":"k","fieldValues":{},"savedAt":"1"}') === null)
check('parse: missing fieldValues → null', parseCardDraft('{"key":"k","savedAt":1}') === null)
check('parse: array fieldValues → null', parseCardDraft('{"key":"k","fieldValues":[],"savedAt":1}') === null)
check('parse: missing tags → empty string (not a crash)',
  parseCardDraft('{"key":"k","fieldValues":{},"savedAt":1}')?.tags === '')
check('parse: drops non-string field values, keeps the rest', (() => {
  // A non-string would be handed straight to a TextInput `value` and crash the
  // very screen this rescue exists for — drop the entry, keep the typing.
  const back = parseCardDraft('{"key":"k","fieldValues":{"a":"kept","b":7,"c":null},"savedAt":1}')
  return back !== null
    && back.fieldValues.a === 'kept'
    && !('b' in back.fieldValues)
    && !('c' in back.fieldValues)
})())

// ── isRestorableDraft ──
check('restore: just saved', isRestorableDraft(draft(), KEY, NOW))
check('restore: an hour ago', isRestorableDraft(draft({ savedAt: NOW - 3600_000 }), KEY, NOW))
check('restore: exactly at max age (boundary inclusive)',
  isRestorableDraft(draft({ savedAt: NOW - CARD_DRAFT_MAX_AGE_MS }), KEY, NOW))
check('reject: 1 ms past max age',
  !isRestorableDraft(draft({ savedAt: NOW - CARD_DRAFT_MAX_AGE_MS - 1 }), KEY, NOW))
check('reject: future timestamp (clock skew)',
  !isRestorableDraft(draft({ savedAt: NOW + 5_000 }), KEY, NOW))
check('reject: null / undefined',
  !isRestorableDraft(null, KEY, NOW) && !isRestorableDraft(undefined, KEY, NOW))
check('reject: NaN savedAt',
  !isRestorableDraft(draft({ savedAt: Number.NaN }), KEY, NOW))
check('reject: another deck’s draft',
  !isRestorableDraft(draft({ key: cardDraftKey('deck-2') }), KEY, NOW))
check('reject: a new-card draft in the edit form of an existing card',
  !isRestorableDraft(draft(), cardDraftKey('deck-1', 'card-9'), NOW))
check('reject: an existing card’s draft in the create form',
  !isRestorableDraft(draft({ key: cardDraftKey('deck-1', 'card-9') }), KEY, NOW))
check('reject: empty draft (nothing to restore, and it would blank a seeded form)',
  !isRestorableDraft(draft({ fieldValues: {}, tags: '' }), KEY, NOW))
check('reject: whitespace-only draft',
  !isRestorableDraft(draft({ fieldValues: { field_1: '  ' }, tags: ' ' }), KEY, NOW))
check('restore: tags-only draft is still worth keeping',
  isRestorableDraft(draft({ fieldValues: {}, tags: 'n5' }), KEY, NOW))
check('respects a custom maxAge',
  isRestorableDraft(draft({ savedAt: NOW - 500 }), KEY, NOW, 1000)
  && !isRestorableDraft(draft({ savedAt: NOW - 1500 }), KEY, NOW, 1000))

console.log(`\ncard-draft-core: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
