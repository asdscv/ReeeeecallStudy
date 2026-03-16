import type { IStorageBackend } from '../types'

export class LocalStorageBackend implements IStorageBackend {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // private browsing — silently fail
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      // private browsing
    }
  }
}
