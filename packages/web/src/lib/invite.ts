const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const CODE_LENGTH = 8
const CODE_PATTERN = /^[A-Za-z0-9]{8}$/

export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARS[bytes[i] % CHARS.length]
  }
  return code
}

export function validateInviteCode(code: string): boolean {
  return CODE_PATTERN.test(code)
}
