import { describe, it, expect } from 'vitest'
import {
  validateDeckPayload,
  type DeckCreatePayload,
} from '../api-deck-validation'

describe('validateDeckPayload', () => {
  // ── Happy path ──────────────────────────────────
  it('accepts valid deck with only name', () => {
    const result = validateDeckPayload({ name: 'TOEIC 영단어' })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.sanitized).toBeDefined()
    expect(result.sanitized!.name).toBe('TOEIC 영단어')
    expect(result.sanitized!.color).toBe('#3B82F6')
    expect(result.sanitized!.icon).toBe('📚')
  })

  it('accepts valid deck with all optional fields', () => {
    const payload: DeckCreatePayload = {
      name: '영작 오답노트',
      description: '영작 시 틀린 표현을 교정하며 학습',
      color: '#F59E0B',
      icon: '✍️',
      default_template_id: 'f3c08611-0caa-4a7e-bcda-15eb9e052565',
      srs_settings: { again_days: 0, hard_days: 1, good_days: 1, easy_days: 4 },
    }
    const result = validateDeckPayload(payload)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.sanitized).toEqual(payload)
  })

  // ── name validation ─────────────────────────────
  it('rejects missing name', () => {
    const result = validateDeckPayload({} as unknown)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('name is required')
  })

  it('rejects empty string name', () => {
    const result = validateDeckPayload({ name: '' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('name is required')
  })

  it('rejects whitespace-only name', () => {
    const result = validateDeckPayload({ name: '   ' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('name is required')
  })

  it('rejects name longer than 100 characters', () => {
    const result = validateDeckPayload({ name: 'a'.repeat(101) })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('name must be 100 characters or less')
  })

  it('trims name whitespace', () => {
    const result = validateDeckPayload({ name: '  TOEIC  ' })
    expect(result.valid).toBe(true)
    expect(result.sanitized!.name).toBe('TOEIC')
  })

  // ── color validation ────────────────────────────
  it('accepts valid hex color', () => {
    const result = validateDeckPayload({ name: 'test', color: '#FF5733' })
    expect(result.valid).toBe(true)
    expect(result.sanitized!.color).toBe('#FF5733')
  })

  it('uses default color when not provided', () => {
    const result = validateDeckPayload({ name: 'test' })
    expect(result.sanitized!.color).toBe('#3B82F6')
  })

  it('rejects invalid color format', () => {
    const result = validateDeckPayload({ name: 'test', color: 'red' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('color must be a valid hex color (e.g. #3B82F6)')
  })

  it('rejects short hex color', () => {
    const result = validateDeckPayload({ name: 'test', color: '#FFF' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('color must be a valid hex color (e.g. #3B82F6)')
  })

  // ── icon validation ─────────────────────────────
  it('uses default icon when not provided', () => {
    const result = validateDeckPayload({ name: 'test' })
    expect(result.sanitized!.icon).toBe('📚')
  })

  it('accepts valid emoji icon', () => {
    const result = validateDeckPayload({ name: 'test', icon: '🇨🇳' })
    expect(result.valid).toBe(true)
    expect(result.sanitized!.icon).toBe('🇨🇳')
  })

  it('rejects icon longer than 10 characters', () => {
    const result = validateDeckPayload({ name: 'test', icon: 'a'.repeat(11) })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('icon must be 10 characters or less')
  })

  // ── description validation ──────────────────────
  it('accepts undefined description', () => {
    const result = validateDeckPayload({ name: 'test' })
    expect(result.valid).toBe(true)
    expect(result.sanitized!.description).toBeUndefined()
  })

  it('accepts valid description string', () => {
    const result = validateDeckPayload({ name: 'test', description: '설명입니다' })
    expect(result.valid).toBe(true)
    expect(result.sanitized!.description).toBe('설명입니다')
  })

  it('rejects description longer than 500 characters', () => {
    const result = validateDeckPayload({ name: 'test', description: 'a'.repeat(501) })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('description must be 500 characters or less')
  })

  // ── default_template_id validation ──────────────
  it('accepts undefined default_template_id', () => {
    const result = validateDeckPayload({ name: 'test' })
    expect(result.valid).toBe(true)
  })

  it('accepts valid UUID format', () => {
    const result = validateDeckPayload({
      name: 'test',
      default_template_id: 'f3c08611-0caa-4a7e-bcda-15eb9e052565',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects invalid UUID format', () => {
    const result = validateDeckPayload({ name: 'test', default_template_id: 'not-a-uuid' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('default_template_id must be a valid UUID')
  })

  // ── srs_settings validation ─────────────────────
  it('accepts undefined srs_settings', () => {
    const result = validateDeckPayload({ name: 'test' })
    expect(result.valid).toBe(true)
  })

  it('accepts valid srs_settings', () => {
    const result = validateDeckPayload({
      name: 'test',
      srs_settings: { again_days: 0, hard_days: 1, good_days: 1, easy_days: 4 },
    })
    expect(result.valid).toBe(true)
  })

  it('rejects negative day values in srs_settings', () => {
    const result = validateDeckPayload({
      name: 'test',
      srs_settings: { again_days: -1, hard_days: 1, good_days: 1, easy_days: 4 },
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('again_days')
  })

  it('rejects non-numeric day values in srs_settings', () => {
    const result = validateDeckPayload({
      name: 'test',
      srs_settings: { again_days: 'zero' as unknown as number, hard_days: 1, good_days: 1, easy_days: 4 },
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('must be a non-negative number')
  })

  // ── null / invalid input ────────────────────────
  it('rejects null input', () => {
    const result = validateDeckPayload(null)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('request body must be an object')
  })

  it('rejects non-object input', () => {
    const result = validateDeckPayload('string')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('request body must be an object')
  })
})
