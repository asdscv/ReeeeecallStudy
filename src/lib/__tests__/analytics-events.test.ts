import { describe, it, expect } from 'vitest'
import { validateEvent } from '../analytics-events'

describe('validateEvent', () => {
  it('accepts valid event with category and action', () => {
    const result = validateEvent({ category: 'content', action: 'share' })
    expect(result.valid).toBe(true)
    expect(result.event!.category).toBe('content')
    expect(result.event!.action).toBe('share')
  })

  it('accepts event with optional label', () => {
    const result = validateEvent({ category: 'content', action: 'share', label: 'twitter' })
    expect(result.valid).toBe(true)
    expect(result.event!.label).toBe('twitter')
  })

  it('accepts event with optional value', () => {
    const result = validateEvent({ category: 'content', action: 'read', value: 42 })
    expect(result.valid).toBe(true)
    expect(result.event!.value).toBe(42)
  })

  it('rejects event without category', () => {
    const result = validateEvent({ category: '', action: 'share' })
    expect(result.valid).toBe(false)
  })

  it('rejects event without action', () => {
    const result = validateEvent({ category: 'content', action: '' })
    expect(result.valid).toBe(false)
  })

  it('truncates category to 100 chars', () => {
    const result = validateEvent({ category: 'a'.repeat(150), action: 'test' })
    expect(result.valid).toBe(true)
    expect(result.event!.category).toHaveLength(100)
  })

  it('truncates action to 100 chars', () => {
    const result = validateEvent({ category: 'test', action: 'b'.repeat(150) })
    expect(result.valid).toBe(true)
    expect(result.event!.action).toHaveLength(100)
  })

  it('truncates label to 200 chars', () => {
    const result = validateEvent({ category: 'test', action: 'test', label: 'c'.repeat(250) })
    expect(result.valid).toBe(true)
    expect(result.event!.label).toHaveLength(200)
  })

  it('handles undefined label gracefully', () => {
    const result = validateEvent({ category: 'content', action: 'view' })
    expect(result.valid).toBe(true)
    expect(result.event!.label).toBeUndefined()
  })

  it('handles undefined value gracefully', () => {
    const result = validateEvent({ category: 'content', action: 'view' })
    expect(result.valid).toBe(true)
    expect(result.event!.value).toBeUndefined()
  })

  it('preserves zero value (not treated as falsy)', () => {
    const result = validateEvent({ category: 'content', action: 'scroll', value: 0 })
    expect(result.valid).toBe(true)
    expect(result.event!.value).toBe(0)
  })

  it('preserves negative value', () => {
    const result = validateEvent({ category: 'content', action: 'offset', value: -10 })
    expect(result.valid).toBe(true)
    expect(result.event!.value).toBe(-10)
  })

  it('trims whitespace-only category', () => {
    const result = validateEvent({ category: '   ', action: 'test' })
    expect(result.valid).toBe(false)
  })

  it('trims whitespace-only action', () => {
    const result = validateEvent({ category: 'test', action: '   ' })
    expect(result.valid).toBe(false)
  })

  it('accepts all common event categories', () => {
    const categories = ['content', 'navigation', 'engagement', 'conversion', 'error']
    for (const cat of categories) {
      const result = validateEvent({ category: cat, action: 'test' })
      expect(result.valid).toBe(true)
    }
  })
})
