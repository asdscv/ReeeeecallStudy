/**
 * Unit tests for "빠른 만들기" draft persistence core logic.
 * Run with: npx tsx src/utils/quick-create-draft-core.test.ts
 *
 * Pure module (no RN/expo) — exercises the freshness rule, the parser, and the two
 * judgements that keep a restored draft from doing damage: a card shape that no longer
 * exists, and a deck that no longer exists.
 */
import {
  QUICK_CREATE_DRAFT_MAX_AGE_MS,
  hasQuickCreateContent,
  isRestorableQuickCreateDraft,
  parseQuickCreateDraft,
  reconcileQuickCreateDraft,
  restoredDeckIsUsable,
  serializeQuickCreateDraft,
  type QuickCreateDraft,
} from './quick-create-draft-core'

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
const draft = (over: Partial<QuickCreateDraft> = {}): QuickCreateDraft => ({
  deckName: 'HSK 5급',
  deckDescription: '',
  presetId: 'basic',
  rows: [{ front_1: '苹果', back_1: '사과' }],
  createdDeckId: null,
  createdCardCount: 0,
  savedAt: NOW,
  ...over,
})

// ── hasQuickCreateContent ──
check('content: deck name alone counts', hasQuickCreateContent('HSK', '', []))
check('content: description alone counts', hasQuickCreateContent('', '설명', []))
check('content: a filled cell counts', hasQuickCreateContent('', '', [{ front_1: '苹果' }]))
check('content: empty form does not', !hasQuickCreateContent('', '', []))
check('content: empty rows do not', !hasQuickCreateContent('', '', [{}, {}]))
check('content: whitespace is not content',
  !hasQuickCreateContent('   ', ' \n ', [{ front_1: '  ' }]))
check('content: one filled cell among blanks counts',
  hasQuickCreateContent('', '', [{ front_1: '' }, { back_1: '뜻' }]))

// ── serialize / parse round-trip ──
check('round-trip: keeps text, shape and created traces', (() => {
  const raw = serializeQuickCreateDraft({
    deckName: '  HSK 5급 ', deckDescription: '단어장', presetId: 'basic',
    rows: [{ front_1: '苹果' }, { front_1: '香蕉', back_1: '바나나' }],
    createdDeckId: 'deck-1', createdCardCount: 2,
  }, NOW)
  const back = parseQuickCreateDraft(raw)
  return back?.deckName === '  HSK 5급 '   // exact text, untrimmed
    && back.deckDescription === '단어장'
    && back.presetId === 'basic'
    && back.rows.length === 2
    && back.rows[1]!.back_1 === '바나나'
    && back.createdDeckId === 'deck-1'
    && back.createdCardCount === 2
    && back.savedAt === NOW
})())

// ── parseQuickCreateDraft ──
check('parse: null input → null', parseQuickCreateDraft(null) === null)
check('parse: invalid JSON → null', parseQuickCreateDraft('{not json') === null)
check('parse: missing savedAt → null',
  parseQuickCreateDraft('{"presetId":"basic","rows":[]}') === null)
check('parse: missing presetId → null',
  parseQuickCreateDraft('{"rows":[],"savedAt":1}') === null)
check('parse: rows not an array → null',
  parseQuickCreateDraft('{"presetId":"basic","rows":{},"savedAt":1}') === null)
check('parse: missing name/description → empty strings, not a crash', (() => {
  const b = parseQuickCreateDraft('{"presetId":"basic","rows":[],"savedAt":1}')
  return b !== null && b.deckName === '' && b.deckDescription === ''
})())
check('parse: drops non-string cells, keeps the rest', (() => {
  // A non-string would be handed to a TextInput `value` and crash the screen this
  // rescue exists for — drop the cell, keep the typing.
  const b = parseQuickCreateDraft('{"presetId":"basic","rows":[{"a":"kept","b":7,"c":null}],"savedAt":1}')
  return b !== null && b.rows[0]!.a === 'kept' && !('b' in b.rows[0]!) && !('c' in b.rows[0]!)
})())
check('parse: skips a corrupt row but keeps the others', (() => {
  const b = parseQuickCreateDraft('{"presetId":"basic","rows":[null,{"a":"kept"},[]],"savedAt":1}')
  return b !== null && b.rows.length === 1 && b.rows[0]!.a === 'kept'
})())
check('parse: negative / fractional card count is floored to a sane value', (() => {
  const b = parseQuickCreateDraft('{"presetId":"basic","rows":[],"savedAt":1,"createdCardCount":-3}')
  const c = parseQuickCreateDraft('{"presetId":"basic","rows":[],"savedAt":1,"createdCardCount":2.7}')
  return b?.createdCardCount === 0 && c?.createdCardCount === 2
})())
check('parse: empty createdDeckId → null (never an empty id)',
  parseQuickCreateDraft('{"presetId":"basic","rows":[],"savedAt":1,"createdDeckId":""}')?.createdDeckId === null)

// ── isRestorableQuickCreateDraft ──
check('restore: just saved', isRestorableQuickCreateDraft(draft(), NOW))
check('restore: exactly at max age (boundary inclusive)',
  isRestorableQuickCreateDraft(draft({ savedAt: NOW - QUICK_CREATE_DRAFT_MAX_AGE_MS }), NOW))
check('reject: 1 ms past max age',
  !isRestorableQuickCreateDraft(draft({ savedAt: NOW - QUICK_CREATE_DRAFT_MAX_AGE_MS - 1 }), NOW))
check('reject: future timestamp (clock skew)',
  !isRestorableQuickCreateDraft(draft({ savedAt: NOW + 5_000 }), NOW))
check('reject: null / undefined',
  !isRestorableQuickCreateDraft(null, NOW) && !isRestorableQuickCreateDraft(undefined, NOW))
check('reject: nothing typed',
  !isRestorableQuickCreateDraft(draft({ deckName: '', rows: [{}] }), NOW))
check('restore: rows typed but deck unnamed (still worth keeping)',
  isRestorableQuickCreateDraft(draft({ deckName: '' }), NOW))

// ── reconcileQuickCreateDraft: the card shape ──
check('reconcile: known preset is left alone', (() => {
  const d = draft({ createdDeckId: 'deck-1', createdCardCount: 2 })
  const out = reconcileQuickCreateDraft(d, { presetExists: true })
  return out.rows.length === 1 && out.createdDeckId === 'deck-1' && out.createdCardCount === 2
})())
check('reconcile: a preset that no longer exists drops rows AND the deck traces', (() => {
  // Field keys mean what the preset says they mean; a vanished shape would pour cells
  // into different meanings, and the deck built on it cannot be continued.
  const out = reconcileQuickCreateDraft(
    draft({ presetId: 'gone', createdDeckId: 'deck-1', createdCardCount: 2 }),
    { presetExists: false })
  return out.rows.length === 0 && out.createdDeckId === null && out.createdCardCount === 0
})())
check('reconcile: keeps the deck name even when the shape is gone',
  reconcileQuickCreateDraft(draft({ presetId: 'gone' }), { presetExists: false }).deckName === 'HSK 5급')
check('reconcile: never mutates its input', (() => {
  const d = draft({ presetId: 'gone', createdDeckId: 'deck-1' })
  reconcileQuickCreateDraft(d, { presetExists: false })
  return d.rows.length === 1 && d.createdDeckId === 'deck-1'
})())

// ── restoredDeckIsUsable: the deck ──
check('deck: still in the list → reuse it (no duplicate deck)',
  restoredDeckIsUsable('deck-1', ['deck-9', 'deck-1']))
check('deck: gone from a loaded list → do not write into it',
  !restoredDeckIsUsable('deck-1', ['deck-9']))
check('deck: list not loaded yet → do not judge (absent ≠ deleted)',
  restoredDeckIsUsable('deck-1', []))

console.log(`\nquick-create-draft-core: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
