import * as SecureStore from 'expo-secure-store'
import type { IStorage, ISessionStorage } from '@reeeeecall/shared/adapters/storage'

/**
 * Persistent storage backed by expo-secure-store (Keychain on iOS, Keystore on Android).
 * Used for auth tokens, device ID, and other sensitive data.
 */
export class RNStorage implements IStorage {
  getItem(key: string): string | null {
    try {
      return SecureStore.getItem(key)
    } catch {
      return null
    }
  }

  setItem(key: string, value: string): void {
    try {
      SecureStore.setItem(key, value)
    } catch {
      // SecureStore might fail for very large values (>2KB)
      if (__DEV__) console.warn(`[RNStorage] Failed to set key: ${key}`)
    }
  }

  removeItem(key: string): void {
    try {
      SecureStore.deleteItemAsync(key)
    } catch {
      // ignore
    }
  }
}

/**
 * Session-scoped storage (in-memory, cleared on app restart).
 * Equivalent to web's sessionStorage.
 */
export class RNSessionStorage implements ISessionStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }
}

// ── Chunking for the Supabase session ───────────────────────────────────────
// expo-secure-store rejects values over 2048 bytes. A persisted Supabase session is
// access_token + refresh_token + the whole `user` object: measured at 1963 bytes for a
// bare test account — 96 % of the ceiling. Any user with a longer email, more metadata,
// or a second linked identity crosses it, and an UNGUARDED setItemAsync would reject:
// the session silently fails to persist and they are logged out on next launch.
//
// So split large values across `key.0`, `key.1`, … and leave a manifest at `key`.
// 500 CHARACTERS per chunk is the safe bound without measuring bytes: even if every
// character were a 4-byte UTF-8 sequence that is 2000 bytes, still under the limit.
const CHUNK_CHARS = 500
const CHUNK_PREFIX = '__chunked__:'
// Bound the cleanup scan — far more chunks than any session could need.
const MAX_CHUNKS = 64

/** Delete chunk keys `key.from` … `key.{MAX_CHUNKS-1}` — used to drop leftovers from a
 *  previous, longer value so a stale tail can never be appended to a newer one. */
async function clearChunksFrom(key: string, from: number): Promise<void> {
  for (let i = from; i < MAX_CHUNKS; i++) {
    try { await SecureStore.deleteItemAsync(`${key}.${i}`) } catch { /* already gone */ }
  }
}

/**
 * Supabase-compatible async storage adapter.
 * Supabase requires { getItem, setItem, removeItem } that return Promises.
 *
 * Reads stay backward-compatible with sessions written before chunking existed:
 * a plain (unprefixed) value at `key` is returned as-is.
 */
export const supabaseSecureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const head = await SecureStore.getItemAsync(key)
      if (head == null || !head.startsWith(CHUNK_PREFIX)) return head
      const count = Number(head.slice(CHUNK_PREFIX.length))
      if (!Number.isInteger(count) || count <= 0 || count > MAX_CHUNKS) return null
      const parts: string[] = []
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(`${key}.${i}`)
        // A missing chunk means a half-written session — treat it as no session at all
        // rather than handing Supabase a truncated, unparseable blob.
        if (part == null) return null
        parts.push(part)
      }
      return parts.join('')
    } catch {
      return null
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (value.length <= CHUNK_CHARS) {
        await SecureStore.setItemAsync(key, value)
        await clearChunksFrom(key, 0)
        return
      }
      const chunks: string[] = []
      for (let i = 0; i < value.length; i += CHUNK_CHARS) {
        chunks.push(value.slice(i, i + CHUNK_CHARS))
      }
      // Write the parts BEFORE the manifest: a crash mid-write then leaves the old
      // manifest (or none), never a manifest pointing at chunks that don't exist.
      for (let i = 0; i < chunks.length; i++) {
        await SecureStore.setItemAsync(`${key}.${i}`, chunks[i])
      }
      await SecureStore.setItemAsync(key, `${CHUNK_PREFIX}${chunks.length}`)
      await clearChunksFrom(key, chunks.length)
    } catch (e) {
      // Never reject: Supabase awaits this inside its sign-in path, and a rejection
      // there aborts the auth state notification. Losing persistence degrades to
      // "logged out next launch"; throwing would break the CURRENT login.
      if (__DEV__) console.warn('[supabaseSecureStorage] setItem failed:', (e as Error)?.message)
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(key)
      await clearChunksFrom(key, 0)
    } catch { /* ignore */ }
  },
}
