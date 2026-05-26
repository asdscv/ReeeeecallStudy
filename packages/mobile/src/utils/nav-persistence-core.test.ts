/**
 * Unit tests for navigation-state persistence core logic.
 * Run with: npx tsx src/utils/nav-persistence-core.test.ts
 *
 * Pure module (no RN/expo) — exercises the real freshness guard, parser, and
 * serializer that protect study-session resume from stale/corrupt state.
 */
import {
  isFreshNavState,
  parsePersistedNavState,
  serializeNavState,
  NAV_STATE_MAX_AGE_MS,
  type PersistedNavState,
} from './nav-persistence-core'

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

// ── isFreshNavState ──
check('fresh: just saved', isFreshNavState({ state: {}, savedAt: NOW }, NOW))
check('fresh: 1 min ago', isFreshNavState({ state: {}, savedAt: NOW - 60_000 }, NOW))
check('fresh: exactly at max age (boundary inclusive)',
  isFreshNavState({ state: {}, savedAt: NOW - NAV_STATE_MAX_AGE_MS }, NOW))
check('stale: 1 ms past max age',
  !isFreshNavState({ state: {}, savedAt: NOW - NAV_STATE_MAX_AGE_MS - 1 }, NOW))
check('stale: a day ago',
  !isFreshNavState({ state: {}, savedAt: NOW - 24 * 3600_000 }, NOW))
check('reject: future timestamp (clock skew)',
  !isFreshNavState({ state: {}, savedAt: NOW + 5_000 }, NOW))
check('reject: null', !isFreshNavState(null, NOW))
check('reject: undefined', !isFreshNavState(undefined, NOW))
check('reject: NaN savedAt',
  !isFreshNavState({ state: {}, savedAt: Number.NaN } as PersistedNavState, NOW))
check('reject: non-number savedAt',
  !isFreshNavState({ state: {}, savedAt: '123' as unknown as number }, NOW))
check('respects custom maxAge',
  isFreshNavState({ state: {}, savedAt: NOW - 500 }, NOW, 1000) &&
  !isFreshNavState({ state: {}, savedAt: NOW - 1500 }, NOW, 1000))

// ── parsePersistedNavState ──
check('parse: valid payload',
  parsePersistedNavState('{"state":{"index":0},"savedAt":123}')?.savedAt === 123)
check('parse: null input → null', parsePersistedNavState(null) === null)
check('parse: empty string → null', parsePersistedNavState('') === null)
check('parse: invalid JSON → null', parsePersistedNavState('{not json') === null)
check('parse: missing state → null', parsePersistedNavState('{"savedAt":1}') === null)
check('parse: missing savedAt → null', parsePersistedNavState('{"state":{}}') === null)
check('parse: savedAt wrong type → null',
  parsePersistedNavState('{"state":{},"savedAt":"x"}') === null)
check('parse: JSON primitive (not object) → null', parsePersistedNavState('42') === null)
check('parse: JSON null literal → null', parsePersistedNavState('null') === null)

// ── serialize round-trip ──
const original = { index: 1, routes: [{ name: 'StudyTab' }] }
const roundTrip = parsePersistedNavState(serializeNavState(original, NOW))
check('round-trip: state preserved',
  JSON.stringify(roundTrip?.state) === JSON.stringify(original))
check('round-trip: savedAt set', roundTrip?.savedAt === NOW)
check('round-trip: result is fresh', isFreshNavState(roundTrip, NOW))

console.log(`\nnav-persistence-core: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
