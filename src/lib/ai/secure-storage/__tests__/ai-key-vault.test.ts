import { describe, it, expect, beforeEach } from 'vitest'
import { AIKeyVault } from '../ai-key-vault'
import { NullCrypto } from '../crypto/null-crypto'
import type { IStorageBackend } from '../types'

class MemoryBackend implements IStorageBackend {
  store = new Map<string, string>()
  getItem(key: string): string | null { return this.store.get(key) ?? null }
  setItem(key: string, value: string): void { this.store.set(key, value) }
  removeItem(key: string): void { this.store.delete(key) }
}

describe('AIKeyVault', () => {
  let backend: MemoryBackend
  let vault: AIKeyVault

  beforeEach(() => {
    backend = new MemoryBackend()
    vault = new AIKeyVault({ crypto: new NullCrypto(), backend })
  })

  it('should save and load provider key', async () => {
    await vault.saveProvider('uid-1', 'openai', {
      apiKey: 'sk-test-123',
      model: 'gpt-4o',
      savedAt: new Date().toISOString(),
    })

    const entry = await vault.loadProvider('uid-1', 'openai')
    expect(entry?.apiKey).toBe('sk-test-123')
    expect(entry?.model).toBe('gpt-4o')
  })

  it('should store multiple providers independently', async () => {
    await vault.saveProvider('uid-1', 'openai', {
      apiKey: 'sk-openai',
      model: 'gpt-4o',
      savedAt: new Date().toISOString(),
    })
    await vault.saveProvider('uid-1', 'anthropic', {
      apiKey: 'sk-ant-claude',
      model: 'claude-sonnet-4-6',
      savedAt: new Date().toISOString(),
    })

    const openai = await vault.loadProvider('uid-1', 'openai')
    const anthropic = await vault.loadProvider('uid-1', 'anthropic')

    expect(openai?.apiKey).toBe('sk-openai')
    expect(anthropic?.apiKey).toBe('sk-ant-claude')
  })

  it('should remove single provider without affecting others', async () => {
    await vault.saveProvider('uid-1', 'openai', {
      apiKey: 'sk-openai',
      model: 'gpt-4o',
      savedAt: new Date().toISOString(),
    })
    await vault.saveProvider('uid-1', 'xai', {
      apiKey: 'xai-key',
      model: 'grok-3',
      savedAt: new Date().toISOString(),
    })

    await vault.removeProvider('uid-1', 'openai')

    expect(await vault.loadProvider('uid-1', 'openai')).toBeNull()
    expect((await vault.loadProvider('uid-1', 'xai'))?.apiKey).toBe('xai-key')
  })

  it('should return empty map when nothing stored', async () => {
    const all = await vault.loadAll('uid-1')
    expect(all).toEqual({})
  })

  it('should list stored provider IDs', async () => {
    await vault.saveProvider('uid-1', 'openai', {
      apiKey: 'key1', model: 'm1', savedAt: new Date().toISOString(),
    })
    await vault.saveProvider('uid-1', 'google', {
      apiKey: 'key2', model: 'm2', savedAt: new Date().toISOString(),
    })

    const ids = await vault.getStoredProviderIds('uid-1')
    expect(ids).toContain('openai')
    expect(ids).toContain('google')
    expect(ids).toHaveLength(2)
  })

  it('should clear all keys', async () => {
    await vault.saveProvider('uid-1', 'openai', {
      apiKey: 'key1', model: 'm1', savedAt: new Date().toISOString(),
    })
    vault.clear()

    const all = await vault.loadAll('uid-1')
    expect(all).toEqual({})
    expect(vault.hasAnyKey()).toBe(false)
  })

  describe('migration', () => {
    it('should migrate from v2 single-config format', async () => {
      // Seed v2 format (single config in SecureEnvelope)
      const config = JSON.stringify({
        providerId: 'xai',
        apiKey: 'xai-old-key',
        model: 'grok-3-mini',
      })
      backend.setItem('reeeeecall-ai-config-v2', JSON.stringify({
        v: 1,
        data: config, // NullCrypto: data = plaintext
        storedAt: '2025-01-01T00:00:00Z',
        ttlMs: null,
      }))

      const entry = await vault.loadProvider('uid-1', 'xai')
      expect(entry?.apiKey).toBe('xai-old-key')
      expect(entry?.model).toBe('grok-3-mini')

      // Legacy key should be cleaned up
      expect(backend.getItem('reeeeecall-ai-config-v2')).toBeNull()
      // New v3 key should exist
      expect(backend.getItem('reeeeecall-ai-keys-v3')).not.toBeNull()
    })

    it('should migrate from v1 plaintext format', async () => {
      backend.setItem('reeeeecall-ai-config', JSON.stringify({
        providerId: 'openai',
        apiKey: 'sk-legacy',
        model: 'gpt-4o',
      }))

      const entry = await vault.loadProvider('uid-1', 'openai')
      expect(entry?.apiKey).toBe('sk-legacy')

      expect(backend.getItem('reeeeecall-ai-config')).toBeNull()
    })
  })
})
