/**
 * Navigation-state persistence — IO adapter.
 *
 * Uses `expo-file-system` (already bundled in the native build → OTA-safe;
 * AsyncStorage is NOT a dependency and adding it would force a native rebuild).
 * Matches the legacy file-system API already used in `services/file-transfer.ts`.
 *
 * All operations are best-effort: failures resolve to a safe default so a
 * storage hiccup never blocks app boot or navigation.
 */
import * as FileSystem from 'expo-file-system/legacy'
import {
  isFreshNavState,
  parsePersistedNavState,
  sanitizeNavState,
  serializeNavState,
} from './nav-persistence-core'

const NAV_STATE_FILE = `${FileSystem.documentDirectory}nav-state-v1.json`

/**
 * Load the persisted navigation state if present and fresh.
 * Returns `undefined` (→ NavigationContainer uses its default initial route)
 * when there is no saved state, it is stale, or any error occurs.
 */
export async function loadNavState(now: number = Date.now()): Promise<object | undefined> {
  try {
    const info = await FileSystem.getInfoAsync(NAV_STATE_FILE)
    if (!info.exists) return undefined
    const raw = await FileSystem.readAsStringAsync(NAV_STATE_FILE)
    const saved = parsePersistedNavState(raw)
    if (saved && isFreshNavState(saved, now)) {
      // Strip volatile screens (e.g. StudySession) whose required in-memory
      // state was lost across the cold start. Without this, restoring straight
      // into StudySession traps the user on a "Loading…" fallback forever
      // because the zustand study store starts empty after a process restart.
      return sanitizeNavState(saved.state) as object | undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Persist the current navigation state. Best-effort, non-blocking. */
export async function saveNavState(state: unknown, now: number = Date.now()): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(NAV_STATE_FILE, serializeNavState(state, now))
  } catch {
    // Non-fatal — losing a single snapshot only costs one resume.
  }
}

/** Remove the persisted state (e.g. on explicit logout). Best-effort. */
export async function clearNavState(): Promise<void> {
  try {
    await FileSystem.deleteAsync(NAV_STATE_FILE, { idempotent: true })
  } catch {
    // ignore
  }
}
