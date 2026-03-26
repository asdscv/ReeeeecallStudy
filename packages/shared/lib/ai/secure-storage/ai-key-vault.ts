import type { ICryptoStrategy, IStorageBackend, IAsyncKeyBackend, SecureEnvelope } from './types'

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
  // 레거시: 동기 로컬 저장소 + 클라이언트 암호화
  crypto?: ICryptoStrategy
  backend?: IStorageBackend
  storageKey?: string
  // SECURITY: 비동기 서버사이드 백엔드 (설정 시 로컬 백엔드보다 우선)
  // Supabase pgcrypto 서버 암호화 → 클라이언트에서 암호화 불필요
  asyncBackend?: IAsyncKeyBackend
}

// ── Vault ──────────────────────────────────────────────

const DEFAULT_KEY = 'reeeeecall-ai-keys-v3'
const LEGACY_V2_KEY = 'reeeeecall-ai-config-v2'
const LEGACY_V1_KEY = 'reeeeecall-ai-config'

/**
 * AI 프로바이더 API 키 관리 볼트.
 *
 * 두 가지 모드 지원:
 *   1. asyncBackend (권장): Supabase 서버사이드 암호화
 *      - pgcrypto + Vault 시크릿으로 서버에서 암호화/복호화
 *      - XSS 공격에 안전, 디바이스 간 동기화
 *   2. crypto + backend (레거시): 로컬 저장소 + 클라이언트 암호화
 *      - localStorage/SecureStore에 AES-GCM으로 암호화
 *      - 마이그레이션 기간 동안만 사용
 */
export class AIKeyVault {
  private readonly crypto?: ICryptoStrategy
  private readonly backend?: IStorageBackend
  private readonly storageKey: string
  private readonly asyncBackend?: IAsyncKeyBackend

  // asyncBackend 사용 시 hasAnyKey()를 위한 캐시
  private _hasKeysCache: boolean | null = null

  constructor(options: AIKeyVaultOptions) {
    this.asyncBackend = options.asyncBackend
    this.crypto = options.crypto
    this.backend = options.backend
    this.storageKey = options.storageKey ?? DEFAULT_KEY
  }

  /** Load all provider keys */
  async loadAll(uid: string): Promise<ProviderKeyMap> {
    // SECURITY: asyncBackend가 있으면 서버사이드 암호화 사용 (권장)
    if (this.asyncBackend) {
      const keys = await this.asyncBackend.loadAll(uid)
      this._hasKeysCache = Object.keys(keys).length > 0
      return keys
    }

    // 레거시: 로컬 저장소 + 클라이언트 암호화
    if (!this.backend || !this.crypto) return {}

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

    return this.migrateFromV2(uid)
  }

  /** Load key for a specific provider */
  async loadProvider(uid: string, providerId: string): Promise<ProviderKeyEntry | null> {
    const all = await this.loadAll(uid)
    return all[providerId] ?? null
  }

  /** Save key for a specific provider (preserves others) */
  async saveProvider(uid: string, providerId: string, entry: ProviderKeyEntry): Promise<void> {
    if (this.asyncBackend) {
      await this.asyncBackend.saveProvider(uid, providerId, entry)
      this._hasKeysCache = true
      return
    }

    if (!this.backend || !this.crypto) return
    const all = await this.loadAll(uid)
    all[providerId] = entry
    await this.saveAllLocal(uid, all)
  }

  /** Remove key for a specific provider */
  async removeProvider(uid: string, providerId: string): Promise<void> {
    if (this.asyncBackend) {
      await this.asyncBackend.removeProvider(uid, providerId)
      // 캐시는 다음 loadAll에서 갱신
      this._hasKeysCache = null
      return
    }

    if (!this.backend || !this.crypto) return
    const all = await this.loadAll(uid)
    delete all[providerId]
    await this.saveAllLocal(uid, all)
  }

  /** Check if any provider key exists (sync, no decryption) */
  hasAnyKey(): boolean {
    // asyncBackend: 캐시 기반 (loadAll 후 갱신됨)
    if (this.asyncBackend) {
      return this._hasKeysCache ?? false
    }

    if (!this.backend) return false
    return (
      this.backend.getItem(this.storageKey) !== null ||
      this.backend.getItem(LEGACY_V2_KEY) !== null ||
      this.backend.getItem(LEGACY_V1_KEY) !== null
    )
  }

  /** Clear all stored keys */
  clear(): void {
    this._hasKeysCache = false
    if (!this.backend) return
    this.backend.removeItem(this.storageKey)
    this.backend.removeItem(LEGACY_V2_KEY)
    this.backend.removeItem(LEGACY_V1_KEY)
  }

  /** Get list of stored provider IDs (requires decryption) */
  async getStoredProviderIds(uid: string): Promise<string[]> {
    const all = await this.loadAll(uid)
    return Object.keys(all)
  }

  /**
   * 로컬 저장소 → Supabase 마이그레이션.
   * 기존 로컬 키를 서버로 이전 후 로컬 데이터 삭제.
   * 앱 시작 시 인증 후 1회 호출.
   */
  async migrateLocalToAsync(uid: string, localVault: AIKeyVault): Promise<number> {
    if (!this.asyncBackend) return 0

    const localKeys = await localVault.loadAll(uid)
    const providerIds = Object.keys(localKeys)
    if (providerIds.length === 0) return 0

    for (const pid of providerIds) {
      await this.asyncBackend.saveProvider(uid, pid, localKeys[pid])
    }

    // 마이그레이션 완료 후 로컬 데이터 삭제
    localVault.clear()
    this._hasKeysCache = true
    return providerIds.length
  }

  // ── Private (레거시 로컬 저장소) ────────────────────────

  private async saveAllLocal(uid: string, keys: ProviderKeyMap): Promise<void> {
    if (!this.backend || !this.crypto) return
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
    if (!this.backend || !this.crypto) return {}

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
          await this.saveAllLocal(uid, keys)
          this.backend.removeItem(LEGACY_V2_KEY)
          return keys
        }
      } catch {
        this.backend.removeItem(LEGACY_V2_KEY)
      }
    }

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
          await this.saveAllLocal(uid, keys)
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
