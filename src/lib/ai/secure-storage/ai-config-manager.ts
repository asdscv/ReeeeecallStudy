import type { AIConfig } from '../types'
import type {
  IAIConfigManager,
  AIConfigManagerOptions,
  ICryptoStrategy,
  IStorageBackend,
  SecureEnvelope,
} from './types'

const DEFAULT_STORAGE_KEY = 'reeeeecall-ai-config-v2'
const LEGACY_STORAGE_KEY = 'reeeeecall-ai-config'

export class AIConfigManager implements IAIConfigManager {
  private readonly crypto: ICryptoStrategy
  private readonly backend: IStorageBackend
  private readonly storageKey: string
  private readonly defaultTtlMs: number | null

  constructor(options: AIConfigManagerOptions) {
    this.crypto = options.crypto
    this.backend = options.backend
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
    this.defaultTtlMs = options.defaultTtlMs ?? null
  }

  async load(uid: string): Promise<AIConfig | null> {
    // Try new encrypted storage first
    const raw = this.backend.getItem(this.storageKey)
    if (raw) {
      try {
        const envelope = JSON.parse(raw) as SecureEnvelope
        if (this.isExpired(envelope)) {
          this.backend.removeItem(this.storageKey)
          return null
        }
        const decrypted = await this.crypto.decrypt(envelope.data, uid)
        return JSON.parse(decrypted) as AIConfig
      } catch {
        // Corrupted or wrong-uid data — clear it
        this.backend.removeItem(this.storageKey)
        return null
      }
    }

    // Attempt migration from legacy plaintext storage
    return this.migrateFromLegacy(uid)
  }

  async save(
    uid: string,
    config: AIConfig,
    ttlMs?: number | null,
  ): Promise<void> {
    const plaintext = JSON.stringify(config)
    const encrypted = await this.crypto.encrypt(plaintext, uid)

    const envelope: SecureEnvelope = {
      v: 1,
      data: encrypted,
      storedAt: new Date().toISOString(),
      ttlMs: ttlMs !== undefined ? ttlMs : this.defaultTtlMs,
    }

    this.backend.setItem(this.storageKey, JSON.stringify(envelope))
  }

  clear(): void {
    this.backend.removeItem(this.storageKey)
    this.backend.removeItem(LEGACY_STORAGE_KEY)
  }

  hasKey(): boolean {
    return (
      this.backend.getItem(this.storageKey) !== null ||
      this.backend.getItem(LEGACY_STORAGE_KEY) !== null
    )
  }

  private async migrateFromLegacy(uid: string): Promise<AIConfig | null> {
    const legacyRaw = this.backend.getItem(LEGACY_STORAGE_KEY)
    if (!legacyRaw) return null

    try {
      const config = JSON.parse(legacyRaw) as AIConfig
      if (!config.apiKey) return null

      // Re-save as encrypted
      await this.save(uid, config)
      // Remove legacy
      this.backend.removeItem(LEGACY_STORAGE_KEY)
      return config
    } catch {
      // Corrupted legacy data
      this.backend.removeItem(LEGACY_STORAGE_KEY)
      return null
    }
  }

  private isExpired(envelope: SecureEnvelope): boolean {
    if (envelope.ttlMs === null) return false
    const storedAt = new Date(envelope.storedAt).getTime()
    return Date.now() - storedAt > envelope.ttlMs
  }
}
