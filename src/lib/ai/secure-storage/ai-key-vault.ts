import type { ICryptoStrategy, IStorageBackend, SecureEnvelope } from './types'

// ── Per-provider key entry ─────────────────────────────

export interface ProviderKeyEntry {
  apiKey: string
  model: string
  baseUrl?: string
  savedAt: string
}

export type ProviderKeyMap = Record<string, ProviderKeyEntry>

// ── Options ────────────────────────────────────────────

export interface AIKeyVaultOptions {
  crypto: ICryptoStrategy
  backend: IStorageBackend
  storageKey?: string
}

// ── Vault ──────────────────────────────────────────────

const DEFAULT_KEY = 'reeeeecall-ai-keys-v3'
const LEGACY_V2_KEY = 'reeeeecall-ai-config-v2'
const LEGACY_V1_KEY = 'reeeeecall-ai-config'

export class AIKeyVault {
  private readonly crypto: ICryptoStrategy
  private readonly backend: IStorageBackend
  private readonly storageKey: string

  constructor(options: AIKeyVaultOptions) {
    this.crypto = options.crypto
    this.backend = options.backend
    this.storageKey = options.storageKey ?? DEFAULT_KEY
  }

  /** Load all provider keys */
  async loadAll(uid: string): Promise<ProviderKeyMap> {
    const raw = this.backend.getItem(this.storageKey)
    if (raw) {
      try {
        const envelope = JSON.parse(raw) as SecureEnvelope
        const decrypted = await this.crypto.decrypt(envelope.data, uid)
        return JSON.parse(decrypted) as ProviderKeyMap
      } catch {
        this.backend.removeItem(this.storageKey)
      }
    }

    // Attempt migration from v2 single-config format
    return this.migrateFromV2(uid)
  }

  /** Load key for a specific provider */
  async loadProvider(uid: string, providerId: string): Promise<ProviderKeyEntry | null> {
    const all = await this.loadAll(uid)
    return all[providerId] ?? null
  }

  /** Save key for a specific provider (preserves others) */
  async saveProvider(uid: string, providerId: string, entry: ProviderKeyEntry): Promise<void> {
    const all = await this.loadAll(uid)
    all[providerId] = entry
    await this.saveAll(uid, all)
  }

  /** Remove key for a specific provider */
  async removeProvider(uid: string, providerId: string): Promise<void> {
    const all = await this.loadAll(uid)
    delete all[providerId]
    await this.saveAll(uid, all)
  }

  /** Check if any provider key exists (sync, no decryption) */
  hasAnyKey(): boolean {
    return (
      this.backend.getItem(this.storageKey) !== null ||
      this.backend.getItem(LEGACY_V2_KEY) !== null ||
      this.backend.getItem(LEGACY_V1_KEY) !== null
    )
  }

  /** Clear all stored keys */
  clear(): void {
    this.backend.removeItem(this.storageKey)
    this.backend.removeItem(LEGACY_V2_KEY)
    this.backend.removeItem(LEGACY_V1_KEY)
  }

  /** Get list of stored provider IDs (requires decryption) */
  async getStoredProviderIds(uid: string): Promise<string[]> {
    const all = await this.loadAll(uid)
    return Object.keys(all)
  }

  // ── Private ──────────────────────────────────────────

  private async saveAll(uid: string, keys: ProviderKeyMap): Promise<void> {
    const plaintext = JSON.stringify(keys)
    const encrypted = await this.crypto.encrypt(plaintext, uid)

    const envelope: SecureEnvelope = {
      v: 1,
      data: encrypted,
      storedAt: new Date().toISOString(),
      ttlMs: null,
    }

    this.backend.setItem(this.storageKey, JSON.stringify(envelope))
  }

  private async migrateFromV2(uid: string): Promise<ProviderKeyMap> {
    // Try v2 (single encrypted config)
    const v2Raw = this.backend.getItem(LEGACY_V2_KEY)
    if (v2Raw) {
      try {
        const envelope = JSON.parse(v2Raw) as SecureEnvelope
        const decrypted = await this.crypto.decrypt(envelope.data, uid)
        const config = JSON.parse(decrypted) as {
          providerId: string
          apiKey: string
          model: string
          baseUrl?: string
        }
        if (config.apiKey) {
          const keys: ProviderKeyMap = {
            [config.providerId]: {
              apiKey: config.apiKey,
              model: config.model,
              baseUrl: config.baseUrl,
              savedAt: envelope.storedAt,
            },
          }
          await this.saveAll(uid, keys)
          this.backend.removeItem(LEGACY_V2_KEY)
          return keys
        }
      } catch {
        this.backend.removeItem(LEGACY_V2_KEY)
      }
    }

    // Try v1 (plaintext)
    const v1Raw = this.backend.getItem(LEGACY_V1_KEY)
    if (v1Raw) {
      try {
        const config = JSON.parse(v1Raw) as {
          providerId: string
          apiKey: string
          model: string
          baseUrl?: string
        }
        if (config.apiKey) {
          const keys: ProviderKeyMap = {
            [config.providerId]: {
              apiKey: config.apiKey,
              model: config.model,
              baseUrl: config.baseUrl,
              savedAt: new Date().toISOString(),
            },
          }
          await this.saveAll(uid, keys)
          this.backend.removeItem(LEGACY_V1_KEY)
          return keys
        }
      } catch {
        this.backend.removeItem(LEGACY_V1_KEY)
      }
    }

    return {}
  }
}
