export { AesGcmCrypto } from './crypto/aes-gcm-crypto'
export { NullCrypto } from './crypto/null-crypto'
export { LocalStorageBackend } from './backends/local-storage'
export { SessionStorageBackend } from './backends/session-storage'
export { AIConfigManager } from './ai-config-manager'
export type {
  ICryptoStrategy,
  IStorageBackend,
  IAIConfigManager,
  AIConfigManagerOptions,
  SecureEnvelope,
} from './types'

// ── Default singleton for production ──────────────────

import { AesGcmCrypto } from './crypto/aes-gcm-crypto'
import { LocalStorageBackend } from './backends/local-storage'
import { AIConfigManager } from './ai-config-manager'

export const aiConfigManager = new AIConfigManager({
  crypto: new AesGcmCrypto(),
  backend: new LocalStorageBackend(),
})
