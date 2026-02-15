/**
 * API Key utilities — shared between client (browser) and tests.
 * Uses Web Crypto API (available in browsers and Node 20+).
 */

/** Key prefix used to identify ReeeeecallStudy API keys. */
export const API_KEY_PREFIX = 'rc_' as const

/** Number of random bytes used for key generation. */
export const API_KEY_RANDOM_BYTES = 16

/** Total length of a generated key: prefix(3) + hex(32) = 35. */
export const API_KEY_LENGTH = API_KEY_PREFIX.length + API_KEY_RANDOM_BYTES * 2

/** Regex pattern for a valid API key format. */
export const API_KEY_PATTERN = /^rc_[0-9a-f]{32}$/

/** Maximum allowed key name length. */
export const API_KEY_NAME_MAX_LENGTH = 64

/** Generate a new API key with `rc_` prefix + 32 hex chars. */
export function generateApiKey(): string {
  const bytes = new Uint8Array(API_KEY_RANDOM_BYTES)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${API_KEY_PREFIX}${hex}`
}

/** SHA-256 hash of a key, returned as 64-char lowercase hex string. */
export async function hashApiKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key)
  const buffer = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Extract bearer token from Authorization header. Returns null if invalid. */
export function extractBearerToken(header: string | undefined | null): string | null {
  if (!header) return null
  const match = header.match(/^bearer\s+(\S+)$/i)
  return match?.[1] ?? null
}

/** Check if a string matches the expected API key format. */
export function isValidApiKeyFormat(key: unknown): key is string {
  return typeof key === 'string' && API_KEY_PATTERN.test(key)
}

/** Validate a key name (non-empty, within max length, no control chars). */
export function validateKeyName(name: unknown): { valid: boolean; error?: string } {
  if (typeof name !== 'string') {
    return { valid: false, error: '키 이름은 문자열이어야 합니다' }
  }
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: '키 이름을 입력해주세요' }
  }
  if (trimmed.length > API_KEY_NAME_MAX_LENGTH) {
    return { valid: false, error: `키 이름은 ${API_KEY_NAME_MAX_LENGTH}자 이내여야 합니다` }
  }
  // Reject control characters
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return { valid: false, error: '키 이름에 제어 문자를 포함할 수 없습니다' }
  }
  return { valid: true }
}

/** Mask an API key for display: show prefix + first 4 hex, mask the rest. */
export function maskApiKey(key: string): string {
  if (!isValidApiKeyFormat(key)) return '••••••••'
  return key.slice(0, 7) + '•'.repeat(28)
}
