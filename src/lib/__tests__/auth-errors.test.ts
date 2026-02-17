import { describe, it, expect } from 'vitest'
import { localizeAuthError } from '../auth-errors'

describe('localizeAuthError', () => {
  it('should translate exact match errors', () => {
    expect(localizeAuthError('Invalid login credentials')).toBe(
      '이메일 또는 비밀번호가 올바르지 않습니다.',
    )
    expect(localizeAuthError('Email not confirmed')).toBe(
      '이메일 인증이 완료되지 않았습니다. 메일함을 확인해주세요.',
    )
    expect(localizeAuthError('User already registered')).toBe(
      '이미 가입된 이메일입니다.',
    )
    expect(localizeAuthError('Password should be at least 6 characters')).toBe(
      '비밀번호는 6자 이상이어야 합니다.',
    )
    expect(localizeAuthError('Email rate limit exceeded')).toBe(
      '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    )
    expect(
      localizeAuthError(
        'New password should be different from the old password',
      ),
    ).toBe('새 비밀번호는 기존 비밀번호와 달라야 합니다.')
    expect(
      localizeAuthError('Unable to validate email address: invalid format'),
    ).toBe('올바른 이메일 형식이 아닙니다.')
  })

  it('should translate partial match errors (startsWith)', () => {
    expect(
      localizeAuthError(
        'For security purposes, you can only request this after 58 seconds',
      ),
    ).toBe('보안을 위해 잠시 후 다시 시도해주세요.')
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
