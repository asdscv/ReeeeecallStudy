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
  sanitizeNavState,
  serializeNavState,
  NAV_STATE_MAX_AGE_MS,
  VOLATILE_ROUTE_NAMES,
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

// ── sanitizeNavState ─────────────────────────────────────────────────────
// Guards against the "trapped in Loading…" bug: restoring straight into
// StudySession leaves the user on a permanent loading fallback because the
// study store is in-memory only and starts empty on cold restart.

check('sanitize: VOLATILE_ROUTE_NAMES includes StudySession',
  VOLATILE_ROUTE_NAMES.includes('StudySession'))

check('sanitize: leaves a clean stack untouched (no volatile routes)', (() => {
  const tree = { index: 0, routes: [{ name: 'Dashboard' }, { name: 'Decks' }] }
  const out = sanitizeNavState(tree) as typeof tree
  return out.routes.length === 2 && out.routes[0].name === 'Dashboard' && out.index === 0
})())

check('sanitize: prunes StudySession nested deep inside a tab stack', (() => {
  // Mirrors the real production tree: Drawer (StudyTab) → Stack (StudySetup → StudySession)
  const tree = {
    index: 0,
    routes: [{
      name: 'Main',
      state: {
        index: 1,
        routes: [
          { name: 'HomeTab' },
          { name: 'StudyTab', state: {
            index: 1,
            routes: [
              { name: 'StudySetup' },
              { name: 'StudySession', params: undefined },
            ],
          }},
        ],
      },
    }],
  }
  const out = sanitizeNavState(tree) as typeof tree
  const studyTab = (out.routes[0]!.state!.routes as Array<{name:string;state?:{routes:Array<{name:string}>;index:number}}>)[1]
  return (
    studyTab.name === 'StudyTab' &&
    studyTab.state!.routes.length === 1 &&
    studyTab.state!.routes[0]!.name === 'StudySetup' &&
    studyTab.state!.index === 0
  )
})())

check('sanitize: empties nested state to undefined when all routes were volatile', (() => {
  // If StudySession was the ONLY route under StudyTab, clear that nested state
  // so React Navigation falls back to the stack's initial route (StudySetup).
  const tree = {
    index: 0,
    routes: [{
      name: 'StudyTab',
      state: { index: 0, routes: [{ name: 'StudySession' }] },
    }],
  }
  const out = sanitizeNavState(tree) as typeof tree
  return out.routes.length === 1 && out.routes[0].name === 'StudyTab' && out.routes[0].state === undefined
})())

check('sanitize: returns undefined when EVERY top-level route is volatile', (() => {
  // Nothing left to restore → boot fresh.
  const tree = { index: 0, routes: [{ name: 'StudySession' }] }
  return sanitizeNavState(tree) === undefined
})())

check('sanitize: clamps parent index when removed route was selected', (() => {
  // index=2 pointed at the now-pruned route → must clamp to a valid index, not crash.
  const tree = {
    index: 2,
    routes: [
      { name: 'A' }, { name: 'B' }, { name: 'StudySession' }, { name: 'C' },
    ],
  }
  const out = sanitizeNavState(tree) as { index: number; routes: Array<{name:string}> }
  return out.routes.length === 3 && out.index >= 0 && out.index <= 2
})())

check('sanitize: strips history (drawer/tab focus log) so stale keys cannot crash navigator', (() => {
  const tree = {
    index: 0,
    routes: [{ name: 'A' }],
    history: [{ type: 'route', key: 'old-pruned-key' }],
  }
  const out = sanitizeNavState(tree) as { history?: unknown[] }
  return out.history === undefined
})())

check('sanitize: does NOT mutate the input', (() => {
  const tree = { index: 0, routes: [{ name: 'StudySession' }, { name: 'Keep' }] }
  const snapshot = JSON.stringify(tree)
  sanitizeNavState(tree)
  return JSON.stringify(tree) === snapshot
})())

check('sanitize: idempotent (re-running yields the same result)', (() => {
  const tree = {
    index: 0,
    routes: [{ name: 'Main', state: {
      index: 0,
      routes: [{ name: 'StudyTab', state: {
        index: 1, routes: [{ name: 'StudySetup' }, { name: 'StudySession' }],
      }}],
    }}],
  }
  const once = sanitizeNavState(tree)
  const twice = sanitizeNavState(once)
  return JSON.stringify(once) === JSON.stringify(twice)
})())

check('sanitize: handles malformed input without throwing (no routes field)', (() => {
  // A persisted blob without `routes` is returned as-is (it has nothing to prune).
  const out = sanitizeNavState({ index: 0 }) as { index: number }
  return out !== undefined && out.index === 0
})())

check('sanitize: drops routes with missing name', (() => {
  // Defensive: a corrupt route entry must not crash the pruner, and is removed
  // (we cannot decide whether it is volatile, so the safe default is to drop it).
  const tree = { index: 0, routes: [{ /* no name */ }, { name: 'Keep' }] }
  const out = sanitizeNavState(tree) as { routes: Array<{name:string}> }
  return out.routes.length === 1 && out.routes[0]!.name === 'Keep'
})())

console.log(`\nnav-persistence-core: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
