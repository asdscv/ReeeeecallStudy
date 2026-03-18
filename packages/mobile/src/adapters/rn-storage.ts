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

/**
 * Supabase-compatible async storage adapter.
 * Supabase requires { getItem, setItem, removeItem } that return Promises.
 */
export const supabaseSecureStorage = {
  getItem: (key: string): Promise<string | null> => {
    return SecureStore.getItemAsync(key)
  },
  setItem: (key: string, value: string): Promise<void> => {
    return SecureStore.setItemAsync(key, value)
  },
  removeItem: (key: string): Promise<void> => {
    return SecureStore.deleteItemAsync(key)
  },
}
