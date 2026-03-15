import { describe, it, expect, beforeEach } from 'vitest'
import { AIConfigManager } from '../ai-config-manager'
import { NullCrypto } from '../crypto/null-crypto'
import type { IStorageBackend } from '../types'
import type { AIConfig } from '../../types'

// In-memory storage backend for tests
class MemoryBackend implements IStorageBackend {
  store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }
}

const testConfig: AIConfig = {
  providerId: 'openai',
  apiKey: 'sk-test-abc123',
  model: 'gpt-4o-mini',
}

describe('AIConfigManager', () => {
  let backend: MemoryBackend
  let manager: AIConfigManager

  beforeEach(() => {
    backend = new MemoryBackend()
    manager = new AIConfigManager({
      crypto: new NullCrypto(),
      backend,
    })
  })

  describe('save and load', () => {
    it('should save and load config', async () => {
      await manager.save('uid-1', testConfig)
      const loaded = await manager.load('uid-1')

      expect(loaded).toEqual(testConfig)
    })

    it('should return null when nothing stored', async () => {
      const loaded = await manager.load('uid-1')
      expect(loaded).toBeNull()
    })

    it('should overwrite previous config', async () => {
      await manager.save('uid-1', testConfig)
      const updated = { ...testConfig, model: 'gpt-4o' }
      await manager.save('uid-1', updated)

      const loaded = await manager.load('uid-1')
      expect(loaded?.model).toBe('gpt-4o')
    })
  })

  describe('clear', () => {
    it('should clear stored config', async () => {
      await manager.save('uid-1', testConfig)
      manager.clear()

      const loaded = await manager.load('uid-1')
      expect(loaded).toBeNull()
    })

    it('should clear both new and legacy keys', async () => {
      backend.setItem('reeeeecall-ai-config-v2', 'something')
      backend.setItem('reeeeecall-ai-config', 'legacy')

      manager.clear()

      expect(backend.getItem('reeeeecall-ai-config-v2')).toBeNull()
      expect(backend.getItem('reeeeecall-ai-config')).toBeNull()
    })
  })

  describe('hasKey', () => {
    it('should return false when empty', () => {
      expect(manager.hasKey()).toBe(false)
    })

    it('should return true when config saved', async () => {
      await manager.save('uid-1', testConfig)
      expect(manager.hasKey()).toBe(true)
    })

    it('should return true when legacy key exists', () => {
      backend.setItem('reeeeecall-ai-config', JSON.stringify(testConfig))
      expect(manager.hasKey()).toBe(true)
    })
  })

  describe('TTL / expiry', () => {
    it('should expire config after TTL', async () => {
      await manager.save('uid-1', testConfig, 1) // 1ms TTL
      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10))

      const loaded = await manager.load('uid-1')
      expect(loaded).toBeNull()
    })

    it('should not expire when ttlMs is null', async () => {
      await manager.save('uid-1', testConfig, null)

      const loaded = await manager.load('uid-1')
      expect(loaded).toEqual(testConfig)
    })

    it('should use default TTL from options', async () => {
      const managerWithTtl = new AIConfigManager({
        crypto: new NullCrypto(),
        backend,
        defaultTtlMs: 1, // 1ms
      })

      await managerWithTtl.save('uid-1', testConfig)
      await new Promise((r) => setTimeout(r, 10))

      const loaded = await managerWithTtl.load('uid-1')
      expect(loaded).toBeNull()
    })
  })

  describe('legacy migration', () => {
    it('should migrate plaintext legacy config to encrypted', async () => {
      // Seed legacy data
      backend.setItem('reeeeecall-ai-config', JSON.stringify(testConfig))

      const loaded = await manager.load('uid-1')
      expect(loaded).toEqual(testConfig)

      // Legacy should be removed
      expect(backend.getItem('reeeeecall-ai-config')).toBeNull()
      // New key should exist
      expect(backend.getItem('reeeeecall-ai-config-v2')).not.toBeNull()
    })

    it('should handle corrupted legacy data', async () => {
      backend.setItem('reeeeecall-ai-config', '{invalid json')

      const loaded = await manager.load('uid-1')
      expect(loaded).toBeNull()
      // Should clean up corrupted data
      expect(backend.getItem('reeeeecall-ai-config')).toBeNull()
    })

    it('should skip migration if legacy has no apiKey', async () => {
      backend.setItem(
        'reeeeecall-ai-config',
        JSON.stringify({ providerId: 'openai', apiKey: '', model: 'gpt-4o' }),
      )

      const loaded = await manager.load('uid-1')
      expect(loaded).toBeNull()
    })
  })

  describe('corrupted envelope handling', () => {
    it('should clear corrupted envelope and return null', async () => {
      backend.setItem('reeeeecall-ai-config-v2', '{broken json}')

      const loaded = await manager.load('uid-1')
      expect(loaded).toBeNull()
      expect(backend.getItem('reeeeecall-ai-config-v2')).toBeNull()
    })
  })
})
