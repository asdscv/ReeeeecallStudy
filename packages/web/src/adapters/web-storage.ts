import type { IStorage, ISessionStorage } from '@reeeeecall/shared/adapters/storage'

export class WebStorage implements IStorage {
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
      // Private browsing or storage blocked
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      // Private browsing or storage blocked
    }
  }
}

export class WebSessionStorage implements ISessionStorage {
  getItem(key: string): string | null {
    try {
      return sessionStorage.getItem(key)
    } catch {
      return null
    }
  }

  setItem(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value)
    } catch {
      // Private browsing or storage blocked
    }
  }

  removeItem(key: string): void {
    try {
      sessionStorage.removeItem(key)
    } catch {
      // Private browsing or storage blocked
    }
  }
}
