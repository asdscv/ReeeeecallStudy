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
