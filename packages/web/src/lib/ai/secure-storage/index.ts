export { AesGcmCrypto } from './crypto/aes-gcm-crypto'
export { NullCrypto } from './crypto/null-crypto'
export { LocalStorageBackend } from './backends/local-storage'
export { SessionStorageBackend } from './backends/session-storage'
export { AIConfigManager } from './ai-config-manager'
export { AIKeyVault } from './ai-key-vault'
export type {
  ICryptoStrategy,
  IStorageBackend,
  IAIConfigManager,
  AIConfigManagerOptions,
  SecureEnvelope,
} from './types'
export type { ProviderKeyEntry, ProviderKeyMap } from './ai-key-vault'

// ── Default singletons ──────────────────────────────────

import { AesGcmCrypto } from './crypto/aes-gcm-crypto'
import { LocalStorageBackend } from './backends/local-storage'
import { AIConfigManager } from './ai-config-manager'
import { AIKeyVault } from './ai-key-vault'
import { SupabaseKeyBackend } from '@reeeeecall/shared/lib/ai/secure-storage/backends/supabase-backend'

const crypto = new AesGcmCrypto()
const backend = new LocalStorageBackend()

export const aiConfigManager = new AIConfigManager({ crypto, backend })

// SECURITY: Supabase 서버사이드 암호화 사용 (pgcrypto + Vault)
// localStorage 기반 암호화에서 전환 — UID 기반 키 파생은 안전하지 않음
export const aiKeyVault = new AIKeyVault({
  asyncBackend: new SupabaseKeyBackend(),
})

// 레거시 로컬 볼트 (localStorage → Supabase 마이그레이션용)
export const legacyLocalVault = new AIKeyVault({ crypto, backend })
