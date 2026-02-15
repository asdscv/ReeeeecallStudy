import { describe, it, expect } from 'vitest'
import {
  generateApiKey,
  hashApiKey,
  extractBearerToken,
  isValidApiKeyFormat,
  validateKeyName,
  maskApiKey,
  API_KEY_PREFIX,
  API_KEY_LENGTH,
  API_KEY_NAME_MAX_LENGTH,
} from '../api-key'

// ─── Constants ────────────────────────────────────────────────

describe('constants', () => {
  it('API_KEY_PREFIX is "rc_"', () => {
    expect(API_KEY_PREFIX).toBe('rc_')
  })

  it('API_KEY_LENGTH is 35', () => {
    expect(API_KEY_LENGTH).toBe(35)
  })

  it('API_KEY_NAME_MAX_LENGTH is 64', () => {
    expect(API_KEY_NAME_MAX_LENGTH).toBe(64)
  })
})

// ─── generateApiKey ───────────────────────────────────────────

describe('generateApiKey', () => {
  it('starts with rc_ prefix', () => {
    const key = generateApiKey()
    expect(key.startsWith('rc_')).toBe(true)
  })

  it('has total length of 35 (rc_ + 32 hex chars)', () => {
    const key = generateApiKey()
    expect(key.length).toBe(35)
  })

  it('generates unique keys each time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()))
    expect(keys.size).toBe(50)
  })

  it('only contains hex characters after prefix', () => {
    const key = generateApiKey()
    const hex = key.slice(3)
    expect(hex).toMatch(/^[0-9a-f]{32}$/)
  })

  it('passes format validation', () => {
    const key = generateApiKey()
    expect(isValidApiKeyFormat(key)).toBe(true)
  })
})

// ─── hashApiKey ───────────────────────────────────────────────

describe('hashApiKey', () => {
  it('returns a 64-char hex string (SHA-256)', async () => {
    const hash = await hashApiKey('rc_test123')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces consistent hash for same input', async () => {
    const hash1 = await hashApiKey('rc_abc')
    const hash2 = await hashApiKey('rc_abc')
    expect(hash1).toBe(hash2)
  })

  it('produces different hash for different input', async () => {
    const hash1 = await hashApiKey('rc_aaa')
    const hash2 = await hashApiKey('rc_bbb')
    expect(hash1).not.toBe(hash2)
  })

  it('hashes empty string without error', async () => {
    const hash = await hashApiKey('')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ─── extractBearerToken ───────────────────────────────────────

describe('extractBearerToken', () => {
  it('extracts token from "Bearer rc_xxx"', () => {
    expect(extractBearerToken('Bearer rc_abc123')).toBe('rc_abc123')
  })

  it('returns null for missing header', () => {
    expect(extractBearerToken(undefined)).toBeNull()
    expect(extractBearerToken(null)).toBeNull()
    expect(extractBearerToken('')).toBeNull()
  })

  it('returns null for non-Bearer scheme', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull()
  })

  it('returns null if token part is empty', () => {
    expect(extractBearerToken('Bearer ')).toBeNull()
    expect(extractBearerToken('Bearer')).toBeNull()
  })

  it('is case-insensitive for Bearer prefix', () => {
    expect(extractBearerToken('bearer rc_abc')).toBe('rc_abc')
    expect(extractBearerToken('BEARER rc_abc')).toBe('rc_abc')
  })

  it('extracts only the first token (no trailing spaces)', () => {
    expect(extractBearerToken('Bearer rc_abc extra')).toBeNull()
  })
})

// ─── isValidApiKeyFormat ──────────────────────────────────────

describe('isValidApiKeyFormat', () => {
  it('accepts valid key', () => {
    expect(isValidApiKeyFormat('rc_' + 'a'.repeat(32))).toBe(true)
    expect(isValidApiKeyFormat('rc_0123456789abcdef0123456789abcdef')).toBe(true)
  })

  it('rejects non-string values', () => {
    expect(isValidApiKeyFormat(null)).toBe(false)
    expect(isValidApiKeyFormat(undefined)).toBe(false)
    expect(isValidApiKeyFormat(123)).toBe(false)
    expect(isValidApiKeyFormat({})).toBe(false)
  })

  it('rejects wrong prefix', () => {
    expect(isValidApiKeyFormat('sk_' + 'a'.repeat(32))).toBe(false)
    expect(isValidApiKeyFormat('RC_' + 'a'.repeat(32))).toBe(false)
  })

  it('rejects wrong length', () => {
    expect(isValidApiKeyFormat('rc_' + 'a'.repeat(31))).toBe(false)
    expect(isValidApiKeyFormat('rc_' + 'a'.repeat(33))).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(isValidApiKeyFormat('rc_' + 'g'.repeat(32))).toBe(false)
    expect(isValidApiKeyFormat('rc_' + 'A'.repeat(32))).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidApiKeyFormat('')).toBe(false)
  })
})

// ─── validateKeyName ──────────────────────────────────────────

describe('validateKeyName', () => {
  it('accepts valid name', () => {
    expect(validateKeyName('my-script')).toEqual({ valid: true })
    expect(validateKeyName('Test Key 123')).toEqual({ valid: true })
  })

  it('rejects non-string input', () => {
    const result = validateKeyName(123)
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects empty or whitespace-only name', () => {
    expect(validateKeyName('').valid).toBe(false)
    expect(validateKeyName('   ').valid).toBe(false)
  })

  it('rejects name exceeding max length', () => {
    const longName = 'a'.repeat(API_KEY_NAME_MAX_LENGTH + 1)
    const result = validateKeyName(longName)
    expect(result.valid).toBe(false)
    expect(result.error).toContain(`${API_KEY_NAME_MAX_LENGTH}`)
  })

  it('accepts name at max length', () => {
    const name = 'a'.repeat(API_KEY_NAME_MAX_LENGTH)
    expect(validateKeyName(name).valid).toBe(true)
  })

  it('rejects control characters', () => {
    expect(validateKeyName('test\x00key').valid).toBe(false)
    expect(validateKeyName('test\nkey').valid).toBe(false)
    expect(validateKeyName('test\tkey').valid).toBe(false)
  })
})

// ─── maskApiKey ───────────────────────────────────────────────

describe('maskApiKey', () => {
  it('masks valid key showing prefix + 4 hex chars', () => {
    const key = 'rc_0123456789abcdef0123456789abcdef'
    const masked = maskApiKey(key)
    expect(masked).toBe('rc_0123' + '•'.repeat(28))
    expect(masked.startsWith('rc_0123')).toBe(true)
  })

  it('returns placeholder for invalid key', () => {
    expect(maskApiKey('')).toBe('••••••••')
    expect(maskApiKey('invalid')).toBe('••••••••')
  })

  it('does not leak the full key', () => {
    const key = generateApiKey()
    const masked = maskApiKey(key)
    expect(masked).not.toBe(key)
    expect(masked.length).toBe(35) // 7 visible + 28 dots
  })
})
