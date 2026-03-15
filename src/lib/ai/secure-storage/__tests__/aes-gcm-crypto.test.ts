import { describe, it, expect } from 'vitest'
import { AesGcmCrypto } from '../crypto/aes-gcm-crypto'

describe('AesGcmCrypto', () => {
  const crypto = new AesGcmCrypto()
  const uid = 'test-user-uid-123'

  it('should encrypt and decrypt roundtrip', async () => {
    const plaintext = '{"apiKey":"sk-test-123","providerId":"openai"}'
    const encrypted = await crypto.encrypt(plaintext, uid)

    expect(encrypted).not.toBe(plaintext)
    expect(encrypted).toBeTruthy()

    const decrypted = await crypto.decrypt(encrypted, uid)
    expect(decrypted).toBe(plaintext)
  })

  it('should produce different ciphertexts for same input (random IV)', async () => {
    const plaintext = 'same-input'
    const a = await crypto.encrypt(plaintext, uid)
    const b = await crypto.encrypt(plaintext, uid)

    expect(a).not.toBe(b)

    // Both should decrypt to same value
    expect(await crypto.decrypt(a, uid)).toBe(plaintext)
    expect(await crypto.decrypt(b, uid)).toBe(plaintext)
  })

  it('should fail to decrypt with wrong uid', async () => {
    const plaintext = 'secret-data'
    const encrypted = await crypto.encrypt(plaintext, uid)

    await expect(crypto.decrypt(encrypted, 'wrong-uid')).rejects.toThrow()
  })

  it('should fail to decrypt corrupted data', async () => {
    const plaintext = 'secret-data'
    const encrypted = await crypto.encrypt(plaintext, uid)
    const corrupted = encrypted.slice(0, -4) + 'XXXX'

    await expect(crypto.decrypt(corrupted, uid)).rejects.toThrow()
  })

  it('should handle empty string', async () => {
    const encrypted = await crypto.encrypt('', uid)
    const decrypted = await crypto.decrypt(encrypted, uid)
    expect(decrypted).toBe('')
  })

  it('should handle unicode content', async () => {
    const plaintext = '한국어 API 키 테스트 🔑'
    const encrypted = await crypto.encrypt(plaintext, uid)
    const decrypted = await crypto.decrypt(encrypted, uid)
    expect(decrypted).toBe(plaintext)
  })
})
