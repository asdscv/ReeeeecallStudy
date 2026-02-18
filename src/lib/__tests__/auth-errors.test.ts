import { describe, it, expect } from 'vitest'
import { localizeAuthError } from '../auth-errors'

describe('localizeAuthError', () => {
  it('should translate exact match errors', () => {
    expect(localizeAuthError('Invalid login credentials')).toBe(
      'errors:auth.invalidCredentials',
    )
    expect(localizeAuthError('Email not confirmed')).toBe(
      'errors:auth.emailNotConfirmed',
    )
    expect(localizeAuthError('User already registered')).toBe(
      'errors:auth.userAlreadyRegistered',
    )
    expect(localizeAuthError('Password should be at least 6 characters')).toBe(
      'errors:auth.passwordTooShort',
    )
    expect(localizeAuthError('Email rate limit exceeded')).toBe(
      'errors:auth.rateLimitExceeded',
    )
    expect(
      localizeAuthError(
        'New password should be different from the old password',
      ),
    ).toBe('errors:auth.samePassword')
    expect(
      localizeAuthError('Unable to validate email address: invalid format'),
    ).toBe('errors:auth.invalidEmailFormat')
  })

  it('should translate partial match errors (startsWith)', () => {
    expect(
      localizeAuthError(
        'For security purposes, you can only request this after 58 seconds',
      ),
    ).toBe('errors:auth.securityCooldown')
  })

  it('should return original message for unknown errors', () => {
    expect(localizeAuthError('Something unexpected happened')).toBe(
      'Something unexpected happened',
    )
  })

  it('should return empty string for empty input', () => {
    expect(localizeAuthError('')).toBe('')
  })
})
