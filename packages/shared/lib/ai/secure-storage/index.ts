export { AesGcmCrypto } from './crypto/aes-gcm-crypto'
export { NullCrypto } from './crypto/null-crypto'
export { LocalStorageBackend } from './backends/local-storage'
export { SessionStorageBackend } from './backends/session-storage'
export { SupabaseKeyBackend } from './backends/supabase-backend'
export { AIConfigManager } from './ai-config-manager'
export { AIKeyVault } from './ai-key-vault'
export type {
  ICryptoStrategy,
  IStorageBackend,
  IAsyncKeyBackend,
  IAIConfigManager,
  AIConfigManagerOptions,
  SecureEnvelope,
} from './types'
export type { ProviderKeyEntry, ProviderKeyMap } from './ai-key-vault'

// ── Default singletons ──────────────────────────────────

import { AesGcmCrypto } from './crypto/aes-gcm-crypto'
import { LocalStorageBackend } from './backends/local-storage'
import { SupabaseKeyBackend } from './backends/supabase-backend'
import { AIConfigManager } from './ai-config-manager'
import { AIKeyVault } from './ai-key-vault'

const crypto = new AesGcmCrypto()
const backend = new LocalStorageBackend()

export const aiConfigManager = new AIConfigManager({ crypto, backend })

// SECURITY: Supabase 서버사이드 암호화 사용 (pgcrypto + Vault)
// 레거시 로컬 볼트는 마이그레이션용으로만 유지
export const aiKeyVault = new AIKeyVault({
  asyncBackend: new SupabaseKeyBackend(),
})

// 레거시 로컬 볼트 (localStorage → Supabase 마이그레이션용)
export const legacyLocalVault = new AIKeyVault({ crypto, backend })
