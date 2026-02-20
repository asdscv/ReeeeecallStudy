export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validate a password against rules: 6+ chars, letter, number, symbol.
 * Returns i18n keys for each failing rule.
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('passwordRules.tooShort')
  }
  if (!/[a-zA-Z]/.test(password)) {
    errors.push('passwordRules.needsLetter')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('passwordRules.needsNumber')
  }
  if (!/[^a-zA-Z0-9\s]/.test(password)) {
    errors.push('passwordRules.needsSymbol')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Check if password and confirmation match.
 */
export function validatePasswordMatch(password: string, confirm: string): boolean {
  return password === confirm
}
