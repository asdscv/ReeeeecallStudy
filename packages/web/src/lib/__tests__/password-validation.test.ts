import { describe, it, expect } from 'vitest'
import { validatePassword, validatePasswordMatch } from '../password-validation'

describe('validatePassword', () => {
  it('should pass a valid password with letter + number + symbol', () => {
    const result = validatePassword('Abcd123!')
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('should fail when password is too short', () => {
    const result = validatePassword('Ab1!xyz')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('passwordRules.tooShort')
  })

  it('should fail when password has no letter', () => {
    const result = validatePassword('12345678!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('passwordRules.needsLetter')
  })

  it('should fail when password has no number', () => {
    const result = validatePassword('Abcdefgh!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('passwordRules.needsNumber')
  })

  it('should fail when password has no symbol', () => {
    const result = validatePassword('Abcd1234')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('passwordRules.needsSymbol')
  })

  it('should return multiple errors for multiple failures', () => {
    const result = validatePassword('abc')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('passwordRules.tooShort')
    expect(result.errors).toContain('passwordRules.needsNumber')
    expect(result.errors).toContain('passwordRules.needsSymbol')
  })

  it('should not count Korean characters as letters', () => {
    const result = validatePassword('가나다라12345!')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('passwordRules.needsLetter')
  })

  it('should accept lowercase-only letters', () => {
    const result = validatePassword('abcdefg1!')
    expect(result.valid).toBe(true)
  })

  it('should accept uppercase-only letters', () => {
    const result = validatePassword('ABCDEFG1!')
    expect(result.valid).toBe(true)
  })
})

describe('validatePasswordMatch', () => {
  it('should return true when passwords match', () => {
    expect(validatePasswordMatch('Abcd123!', 'Abcd123!')).toBe(true)
  })

  it('should return false when passwords do not match', () => {
    expect(validatePasswordMatch('Abcd123!', 'Abcd123?')).toBe(false)
  })

  it('should return false for empty vs non-empty', () => {
    expect(validatePasswordMatch('Abcd123!', '')).toBe(false)
  })

  it('should return true for both empty', () => {
    expect(validatePasswordMatch('', '')).toBe(true)
  })
})
