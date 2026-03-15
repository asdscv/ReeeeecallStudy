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

// ── Default singletons for production ─────────────────

import { AesGcmCrypto } from './crypto/aes-gcm-crypto'
import { LocalStorageBackend } from './backends/local-storage'
import { AIConfigManager } from './ai-config-manager'
import { AIKeyVault } from './ai-key-vault'

const crypto = new AesGcmCrypto()
const backend = new LocalStorageBackend()

export const aiConfigManager = new AIConfigManager({ crypto, backend })

export const aiKeyVault = new AIKeyVault({ crypto, backend })
