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
}
