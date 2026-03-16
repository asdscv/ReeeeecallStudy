import { describe, it, expect } from 'vitest'
import { validateTemplateResponse, validateDeckResponse, validateCardsResponse } from '../validators'

describe('validateTemplateResponse', () => {
  it('validates a correct template', () => {
    const data = {
      name: 'Test Template',
      fields: [
        { key: 'field_front', name: 'Front', type: 'text', order: 0 },
        { key: 'field_back', name: 'Back', type: 'text', order: 1 },
      ],
      front_layout: [{ field_key: 'field_front', style: 'primary', font_size: 40 }],
      back_layout: [{ field_key: 'field_back', style: 'secondary', font_size: 24 }],
      layout_mode: 'default',
      front_html: '',
      back_html: '',
    }

    const result = validateTemplateResponse(data)
    expect(result.name).toBe('Test Template')
    expect(result.fields).toHaveLength(2)
    expect(result.front_layout).toHaveLength(1)
    expect(result.back_layout).toHaveLength(1)
  })

  it('throws on empty name', () => {
    const data = { name: '', fields: [{ key: 'field_a', name: 'A', type: 'text', order: 0 }] }
    expect(() => validateTemplateResponse(data)).toThrow('INVALID_RESPONSE')
  })

  it('throws on too few fields', () => {
    const data = {
      name: 'Test',
      fields: [{ key: 'field_one', name: 'One', type: 'text', order: 0 }],
      front_layout: [{ field_key: 'field_one', style: 'primary' }],
      back_layout: [],
    }
    expect(() => validateTemplateResponse(data)).toThrow('INVALID_RESPONSE')
  })

  it('corrects invalid field keys', () => {
    const data = {
      name: 'Test',
      fields: [
        { key: 'bad_key', name: 'A', type: 'text', order: 0 },
        { key: 'field_good', name: 'B', type: 'text', order: 1 },
      ],
      front_layout: [{ field_key: 'field_0', style: 'primary' }],
      back_layout: [],
    }
    const result = validateTemplateResponse(data)
    expect(result.fields[0].key).toBe('field_0')
  })

  it('filters layout items with invalid field keys', () => {
    const data = {
      name: 'Test',
      fields: [
        { key: 'field_a', name: 'A', type: 'text', order: 0 },
        { key: 'field_b', name: 'B', type: 'text', order: 1 },
      ],
      front_layout: [
        { field_key: 'field_a', style: 'primary' },
        { field_key: 'nonexistent', style: 'secondary' },
      ],
      back_layout: [{ field_key: 'field_b', style: 'detail' }],
    }
    const result = validateTemplateResponse(data)
    expect(result.front_layout).toHaveLength(1)
  })

  it('handles custom layout mode with HTML', () => {
    const data = {
      name: 'Custom',
      fields: [
        { key: 'field_a', name: 'A', type: 'text', order: 0 },
        { key: 'field_b', name: 'B', type: 'text', order: 1 },
      ],
      front_layout: [{ field_key: 'field_a', style: 'primary' }],
      back_layout: [{ field_key: 'field_b', style: 'primary' }],
      layout_mode: 'custom',
      front_html: '<div>{{A}}</div>',
      back_html: '<div>{{B}}</div>',
    }
    const result = validateTemplateResponse(data)
    expect(result.layout_mode).toBe('custom')
    expect(result.front_html).toBe('<div>{{A}}</div>')
  })
})

describe('validateDeckResponse', () => {
  it('validates a correct deck', () => {
    const data = {
      name: 'Test Deck',
      description: 'A test deck',
      color: '#3B82F6',
      icon: '📚',
    }
    const result = validateDeckResponse(data)
    expect(result.name).toBe('Test Deck')
    expect(result.color).toBe('#3B82F6')
  })

  it('uses defaults for invalid color', () => {
    const data = {
      name: 'Test',
      description: 'desc',
      color: '#INVALID',
      icon: '📝',
    }
    const result = validateDeckResponse(data)
    expect(result.color).toBe('#3B82F6')
  })

  it('throws on empty name', () => {
    expect(() => validateDeckResponse({ name: '', description: '' })).toThrow()
  })
})

describe('validateCardsResponse', () => {
  const fieldKeys = ['field_word', 'field_meaning']

  it('validates correct cards', () => {
    const data = {
      cards: [
        { field_values: { field_word: 'apple', field_meaning: '사과' }, tags: ['fruit'] },
        { field_values: { field_word: 'banana', field_meaning: '바나나' }, tags: ['fruit'] },
      ],
    }
    const result = validateCardsResponse(data, fieldKeys)
    expect(result.valid).toHaveLength(2)
    expect(result.filtered).toBe(0)
  })

  it('filters cards with no values', () => {
    const data = {
      cards: [
        { field_values: { field_word: 'apple', field_meaning: '사과' }, tags: [] },
        { field_values: { field_word: '', field_meaning: '' }, tags: [] },
      ],
    }
    const result = validateCardsResponse(data, fieldKeys)
    expect(result.valid).toHaveLength(1)
    expect(result.filtered).toBe(1)
  })

  it('throws when all cards invalid', () => {
    const data = {
      cards: [
        { field_values: {}, tags: [] },
      ],
    }
    expect(() => validateCardsResponse(data, fieldKeys)).toThrow('ALL_CARDS_INVALID')
  })

  it('handles missing tags gracefully', () => {
    const data = {
      cards: [
        { field_values: { field_word: 'test', field_meaning: '테스트' } },
      ],
    }
    const result = validateCardsResponse(data, fieldKeys)
    expect(result.valid[0].tags).toEqual([])
  })

  it('fills missing field keys with empty string', () => {
    const data = {
      cards: [
        { field_values: { field_word: 'hello' }, tags: [] },
      ],
    }
    const result = validateCardsResponse(data, fieldKeys)
    expect(result.valid[0].field_values.field_meaning).toBe('')
  })
})
