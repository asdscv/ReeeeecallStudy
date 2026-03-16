import { describe, it, expect } from 'vitest'
import {
  validateCardPayload,
  validateCardsPayload,
  validatePagination,
  type CardCreatePayload,
} from '../api-validation'

describe('validateCardPayload', () => {
  it('accepts valid card with field_values and template_id', () => {
    const payload: CardCreatePayload = {
      template_id: 'tmpl-1',
      field_values: { front: 'hello', back: '안녕' },
    }
    const result = validateCardPayload(payload)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects missing template_id', () => {
    const payload = { field_values: { front: 'hello' } } as unknown as CardCreatePayload
    const result = validateCardPayload(payload)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('template_id is required')
  })

  it('rejects missing field_values', () => {
    const payload = { template_id: 'tmpl-1' } as unknown as CardCreatePayload
    const result = validateCardPayload(payload)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('field_values is required and must be an object')
  })

  it('rejects empty field_values', () => {
    const payload: CardCreatePayload = { template_id: 'tmpl-1', field_values: {} }
    const result = validateCardPayload(payload)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('field_values must have at least one field')
  })

  it('rejects non-string field values', () => {
    const payload = {
      template_id: 'tmpl-1',
      field_values: { front: 123 },
    } as unknown as CardCreatePayload
    const result = validateCardPayload(payload)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('must be a string')
  })

  it('accepts optional tags as string array', () => {
    const payload: CardCreatePayload = {
      template_id: 'tmpl-1',
      field_values: { front: 'hello' },
      tags: ['vocab', 'ch1'],
    }
    const result = validateCardPayload(payload)
    expect(result.valid).toBe(true)
  })

  it('rejects non-array tags', () => {
    const payload = {
      template_id: 'tmpl-1',
      field_values: { front: 'hello' },
      tags: 'not-array',
    } as unknown as CardCreatePayload
    const result = validateCardPayload(payload)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('tags must be an array of strings')
  })
})

describe('validateCardsPayload', () => {
  it('accepts single card object', () => {
    const payload = { template_id: 'tmpl-1', field_values: { front: 'hi' } }
    const result = validateCardsPayload(payload)
    expect(result.valid).toBe(true)
    expect(result.cards).toHaveLength(1)
  })

  it('accepts array of cards', () => {
    const payload = [
      { template_id: 'tmpl-1', field_values: { front: 'a' } },
      { template_id: 'tmpl-1', field_values: { front: 'b' } },
    ]
    const result = validateCardsPayload(payload)
    expect(result.valid).toBe(true)
    expect(result.cards).toHaveLength(2)
  })

  it('rejects empty array', () => {
    const result = validateCardsPayload([])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('request body must contain at least one card')
  })

  it('rejects array exceeding 100 cards', () => {
    const cards = Array.from({ length: 101 }, (_, i) => ({
      template_id: 'tmpl-1',
      field_values: { front: `card-${i}` },
    }))
    const result = validateCardsPayload(cards)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('maximum 100 cards per request')
  })

  it('reports per-card errors with index', () => {
    const payload = [
      { template_id: 'tmpl-1', field_values: { front: 'ok' } },
      { template_id: '', field_values: { front: 'bad' } },
    ]
    const result = validateCardsPayload(payload)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('[1]')
  })

  it('rejects null/undefined body', () => {
    const result = validateCardsPayload(null as unknown)
    expect(result.valid).toBe(false)
  })
})

describe('validatePagination', () => {
  it('returns defaults when no params provided', () => {
    const result = validatePagination({})
    expect(result).toEqual({ page: 1, per_page: 50 })
  })

  it('parses valid page and per_page', () => {
    const result = validatePagination({ page: '3', per_page: '20' })
    expect(result).toEqual({ page: 3, per_page: 20 })
  })

  it('clamps page to minimum 1', () => {
    const result = validatePagination({ page: '0' })
    expect(result.page).toBe(1)
  })

  it('clamps per_page to range [1, 100]', () => {
    expect(validatePagination({ per_page: '0' }).per_page).toBe(1)
    expect(validatePagination({ per_page: '200' }).per_page).toBe(100)
  })

  it('handles non-numeric input as defaults', () => {
    const result = validatePagination({ page: 'abc', per_page: 'xyz' })
    expect(result).toEqual({ page: 1, per_page: 50 })
  })
})
