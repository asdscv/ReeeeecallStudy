/**
 * Client-generated identifiers for the atomic study-persistence RPCs
 * (`apply_study_rating`, `finalize_study_session`, `undo_study_rating`).
 *
 * The server treats these UUIDs as idempotency keys: retrying a rating with the
 * same event id must not double-apply, and finalizing a session twice with the
 * same client session id must return the first result. Generation therefore has
 * to work on every platform we ship (browser, React Native/Hermes) — where
 * `crypto.randomUUID` is not always available.
 */
export function newPersistenceId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto

  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof cryptoObj?.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  // RFC 4122 version 4 / variant 10xx bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'))
  }

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
