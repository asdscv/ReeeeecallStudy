/**
 * Centralized local persistence for non-sensitive UI preferences that must be
 * read **synchronously before React renders** so the app never flashes the
 * wrong theme or language on launch.
 *
 * Backend: expo-secure-store.
 *   - Already bundled → OTA-safe. AsyncStorage / react-native-mmkv are native
 *     modules whose addition would force a native rebuild (see Mobile Pitfalls).
 *   - `getItem` / `setItem` are synchronous, which startup-time reads require.
 *   - It is technically a secrets store (Keychain/Keystore, ~2KB per key); fine
 *     for a handful of small scalar prefs. Server `profiles.*` stays the source
 *     of truth — these are caches kept in sync by Settings + the prefetch task.
 *
 * To add a preference: add a KEY and a typed get/set pair here. Do NOT scatter
 * raw SecureStore calls across screens/stores — route them through this module.
 */
import * as SecureStore from 'expo-secure-store'
import type { ThemeMode } from './color-scheme'

const KEYS = {
  language: 'app-language',
  // Legacy key — predates this module; keep the string so existing installs
  // don't lose their saved theme.
  theme: 'reeeeecall-user-theme',
  haptics: 'app-haptics-enabled',
  // Suffixed with the user id — SecureStore keys allow [A-Za-z0-9._-], which a UUID fits.
  brainProgress: 'brain-progress',
  brainHistory: 'brain-history',
  brainMeta: 'brain-meta',
} as const

function read(key: string): string | null {
  try {
    return SecureStore.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    SecureStore.setItem(key, value)
  } catch {
    // Non-fatal: a failed cache write just means we fall back to detection /
    // the server value on the next launch.
  }
}

export const localPrefs = {
  /** Persisted UI language code, or null on first launch (→ detect device locale). */
  getLanguage(): string | null {
    return read(KEYS.language)
  },
  setLanguage(code: string): void {
    write(KEYS.language, code)
  },

  /** Persisted theme choice, or null if never set (→ follow OS appearance). */
  getThemeMode(): ThemeMode | null {
    const v = read(KEYS.theme)
    return v === 'light' || v === 'dark' || v === 'system' ? v : null
  },
  setThemeMode(mode: ThemeMode): void {
    write(KEYS.theme, mode)
  },

  /** Whether tactile haptics are enabled. Defaults to true (opt-out). */
  getHapticsEnabled(): boolean {
    return read(KEYS.haptics) !== 'false'
  },
  setHapticsEnabled(enabled: boolean): void {
    write(KEYS.haptics, enabled ? 'true' : 'false')
  },

  /**
   * Brain-training progress (levels, streak), per user. A few hundred bytes of JSON — well
   * under SecureStore's ~2KB value limit (see `parseProgress` in shared/lib/brain-games).
   */
  getBrainProgress(userId: string): string | null {
    return read(`${KEYS.brainProgress}.${userId}`)
  },
  setBrainProgress(userId: string, raw: string): void {
    write(`${KEYS.brainProgress}.${userId}`, raw)
  },

  /**
   * Recent brain rounds per game (the trend lines), per user — kept apart from progress so each
   * stays under the ~2KB value limit (eight entries of three integers per game, see history.ts).
   */
  getBrainHistory(userId: string): string | null {
    return read(`${KEYS.brainHistory}.${userId}`)
  },
  setBrainHistory(userId: string, raw: string): void {
    write(`${KEYS.brainHistory}.${userId}`, raw)
  },

  /**
   * Brain-game meta (skill estimates, tiers, rules seen, achievements), per user — a third value,
   * because progress is already near SecureStore's ~2KB per value (see meta.ts; ~400B worst case).
   */
  getBrainMeta(userId: string): string | null {
    return read(`${KEYS.brainMeta}.${userId}`)
  },
  setBrainMeta(userId: string, raw: string): void {
    write(`${KEYS.brainMeta}.${userId}`, raw)
  },
  /** The account was deleted: its brain record leaves this device too. */
  clearBrain(userId: string): void {
    for (const k of [KEYS.brainProgress, KEYS.brainHistory, KEYS.brainMeta]) {
      SecureStore.deleteItemAsync(`${k}.${userId}`).catch(() => {})
    }
  },
}
