import type { AIConfig } from '../types'

// ── Storage Backend Interface ──────────────────────────

export interface IStorageBackend {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

// ── Crypto Strategy Interface ──────────────────────────

export interface ICryptoStrategy {
  encrypt(plaintext: string, uid: string): Promise<string>
  decrypt(ciphertext: string, uid: string): Promise<string>
}

// ── Stored Envelope ────────────────────────────────────

export interface SecureEnvelope {
  /** Schema version for forward compatibility */
  v: 1
  /** Encrypted payload (base64-encoded) */
  data: string
  /** ISO 8601 timestamp of when the key was stored */
  storedAt: string
  /** TTL in milliseconds. null = no expiry. */
  ttlMs: number | null
}

// ── Async Key Backend Interface ────────────────────────
// SECURITY: 서버사이드 암호화 저장소용 비동기 인터페이스.
// IStorageBackend(동기, 로컬)과 달리, Supabase 같은 네트워크 기반 저장소를 지원.
// 암호화는 서버(pgcrypto)에서 수행되므로 클라이언트 암호화 불필요.

import type { ProviderKeyEntry, ProviderKeyMap } from './ai-key-vault'

export interface IAsyncKeyBackend {
  loadAll(uid: string): Promise<ProviderKeyMap>
  saveProvider(uid: string, providerId: string, entry: ProviderKeyEntry): Promise<void>
  removeProvider(uid: string, providerId: string): Promise<void>
}

// ── Manager Options ────────────────────────────────────

export interface AIConfigManagerOptions {
  crypto: ICryptoStrategy
  backend: IStorageBackend
  storageKey?: string
  defaultTtlMs?: number | null
}

// ── Manager Interface ──────────────────────────────────

export interface IAIConfigManager {
  load(uid: string): Promise<AIConfig | null>
  save(uid: string, config: AIConfig, ttlMs?: number | null): Promise<void>
  clear(): void
  hasKey(): boolean
}
