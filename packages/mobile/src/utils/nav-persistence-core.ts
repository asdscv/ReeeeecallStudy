/**
 * Navigation-state persistence — PURE core (no RN / expo imports).
 *
 * Split from the IO adapter (`nav-persistence.ts`) so the decision logic
 * (serialization, parsing, freshness guard) can be unit-tested with plain tsx.
 *
 * Why this exists: the app has no navigation-state persistence, so when iOS
 * cold-starts a backgrounded app the navigator resets to its initial route
 * (dashboard), dropping the user out of an in-progress study session.
 */

export interface PersistedNavState<T = unknown> {
  /** Serialized React Navigation state tree. */
  state: T
  /** Epoch ms when the state was written. */
  savedAt: number
}

/**
 * Max age for a restorable state. Beyond this we ignore the saved state and let
 * the app open on its initial route — reopening hours later landing mid-session
 * would feel broken, while reopening minutes later should resume.
 */
export const NAV_STATE_MAX_AGE_MS = 2 * 60 * 60 * 1000 // 2 hours

/**
 * True when a saved state is recent enough to restore.
 * Rejects null, malformed timestamps, future timestamps (clock skew / tampering),
 * and anything older than `maxAge`.
 */
export function isFreshNavState(
  saved: PersistedNavState | null | undefined,
  now: number,
  maxAge: number = NAV_STATE_MAX_AGE_MS,
): boolean {
  if (!saved || typeof saved.savedAt !== 'number' || !Number.isFinite(saved.savedAt)) {
    return false
  }
  const age = now - saved.savedAt
  return age >= 0 && age <= maxAge
}

/**
 * Parse a persisted-state string. Returns null on empty input, invalid JSON, or
 * a shape that doesn't match `PersistedNavState` — never throws.
 */
export function parsePersistedNavState(raw: string | null | undefined): PersistedNavState | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'state' in parsed &&
      'savedAt' in parsed &&
      typeof (parsed as { savedAt: unknown }).savedAt === 'number'
    ) {
      return parsed as PersistedNavState
    }
    return null
  } catch {
    return null
  }
}

/** Serialize a navigation state tree with its save timestamp. */
export function serializeNavState(state: unknown, now: number): string {
  const payload: PersistedNavState = { state, savedAt: now }
  return JSON.stringify(payload)
}

// ─── Volatile-screen sanitization ───────────────────────────────────────────
// Some screens depend on in-memory store state that does NOT survive a cold
// restart (e.g. `StudySession` requires `useStudyStore.phase === 'studying'`,
// a non-null `currentCard`, queue, template, etc.). If we restore the user
// straight into one of those screens, the screen renders a fallback "Loading…"
// state forever because the store is empty and the screen has no way to
// re-derive its required state from route params alone. The X/exit button
// lives on the rendered card, not on the loading fallback, so the user is
// trapped and force-killing the app just reproduces the same restored route.
//
// We therefore drop these screens from the restored tree at boot, and rewind
// the affected stack to its initial route so the user lands on a safe screen
// instead of an unrecoverable loader.

/**
 * Route names that must NOT be restored because their content depends on
 * volatile in-memory state (zustand stores) that is lost across cold starts.
 */
export const VOLATILE_ROUTE_NAMES: readonly string[] = ['StudySession']

interface NavStateLike {
  index?: number
  routes?: Array<NavRouteLike>
  history?: Array<unknown>
}
interface NavRouteLike {
  name?: string
  state?: NavStateLike
  params?: unknown
  key?: string
}

/**
 * Recursively prune any route whose `name` is in {@link VOLATILE_ROUTE_NAMES}
 * from a React Navigation state tree. If pruning empties a stack, return
 * `null` so the caller can clamp it. The returned object is a NEW tree —
 * never mutates the input.
 *
 * Pure / no React-Navigation imports → unit-testable with a plain object tree.
 */
export function sanitizeNavState<T>(state: T, volatile: ReadonlySet<string> = new Set(VOLATILE_ROUTE_NAMES)): T | undefined {
  const pruned = pruneState(state as unknown as NavStateLike | undefined, volatile)
  return pruned as unknown as T | undefined
}

function pruneState(state: NavStateLike | undefined, volatile: ReadonlySet<string>): NavStateLike | undefined {
  if (!state || !Array.isArray(state.routes)) return state
  const keptRoutes: NavRouteLike[] = []
  for (const route of state.routes) {
    if (!route || typeof route.name !== 'string') continue
    if (volatile.has(route.name)) continue // drop volatile leaves
    let nextChild = route.state
    if (route.state) {
      const childPruned = pruneState(route.state, volatile)
      // If the child stack became empty, clear the nested state so React
      // Navigation falls back to the child's initial route. We KEEP the parent
      // route — the user still lands in the right tab, just on its home screen.
      nextChild = childPruned && Array.isArray(childPruned.routes) && childPruned.routes.length > 0 ? childPruned : undefined
    }
    keptRoutes.push({ ...route, state: nextChild })
  }
  if (keptRoutes.length === 0) return undefined
  const safeIndex = Math.min(Math.max(0, state.index ?? 0), keptRoutes.length - 1)
  // Drop `history` (drawer/tab focus log) — React Navigation rebuilds it from
  // `routes`; stale entries pointing at pruned keys would crash the navigator.
  return { ...state, routes: keptRoutes, index: safeIndex, history: undefined }
}
