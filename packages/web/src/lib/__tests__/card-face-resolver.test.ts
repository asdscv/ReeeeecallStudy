import { describe, it, expect } from 'vitest'
import { resolveCardFaceContent } from '../card-face-resolver'
import type { CardTemplate, Card, TemplateField } from '../../types/database'

// ── Helpers ──────────────────────────────────────────

function makeTemplate(overrides?: Partial<CardTemplate>): CardTemplate {
  return {
    id: 'tmpl-1',
    user_id: 'user-1',
    name: 'Basic',
    fields: [
      { key: 'field_1', name: '앞면', type: 'text', order: 0 },
      { key: 'field_2', name: '뒷면', type: 'text', order: 1 },
    ] as TemplateField[],
    front_layout: [{ field_key: 'field_1', style: 'primary' as const }],
    back_layout: [{ field_key: 'field_2', style: 'primary' as const }],
    layout_mode: 'default',
    front_html: '',
    back_html: '',
    is_default: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeCard(overrides?: Partial<Card>): Card {
  return {
    id: 'card-1',
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'tmpl-1',
    field_values: { field_1: '시험', field_2: 'test' },
    tags: [],
    sort_position: 0,
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    next_review_at: null,
    last_reviewed_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════
// resolveCardFaceContent — with valid template
// ═══════════════════════════════════════════════════════

describe('resolveCardFaceContent — template with matching field keys', () => {
  it('should return effectiveLayout for front face', () => {
    const tmpl = makeTemplate()
    const card = makeCard()
    const result = resolveCardFaceContent(tmpl, card, 'front')

    expect(result.effectiveLayout).toEqual([{ field_key: 'field_1', style: 'primary' }])
    expect(result.primaryValue).toBe('시험')
    expect(result.fields).toHaveLength(2)
  })

  it('should return effectiveLayout for back face', () => {
    const tmpl = makeTemplate()
    const card = makeCard()
    const result = resolveCardFaceContent(tmpl, card, 'back')

    expect(result.effectiveLayout).toEqual([{ field_key: 'field_2', style: 'primary' }])
    expect(result.primaryValue).toBe('test')
  })

  it('should filter out layout items with empty field values', () => {
    const tmpl = makeTemplate({
      back_layout: [
        { field_key: 'field_2', style: 'primary' as const },
        { field_key: 'field_3', style: 'hint' as const },
      ],
      fields: [
        { key: 'field_1', name: '앞면', type: 'text', order: 0 },
        { key: 'field_2', name: '뒷면', type: 'text', order: 1 },
        { key: 'field_3', name: '힌트', type: 'text', order: 2 },
      ] as TemplateField[],
    })
    const card = makeCard({ field_values: { field_1: '시험', field_2: 'test', field_3: '' } })
    const result = resolveCardFaceContent(tmpl, card, 'back')

    // field_3 has empty value → filtered out
    expect(result.effectiveLayout).toEqual([{ field_key: 'field_2', style: 'primary' }])
    expect(result.primaryValue).toBe('test')
  })

  it('should handle multi-field back layout', () => {
    const tmpl = makeTemplate({
      back_layout: [
        { field_key: 'field_2', style: 'primary' as const },
        { field_key: 'field_3', style: 'hint' as const },
      ],
      fields: [
        { key: 'field_1', name: '앞면', type: 'text', order: 0 },
        { key: 'field_2', name: '뒷면', type: 'text', order: 1 },
        { key: 'field_3', name: '병음', type: 'text', order: 2 },
      ] as TemplateField[],
    })
    const card = makeCard({ field_values: { field_1: '你好', field_2: '안녕', field_3: 'nǐ hǎo' } })
    const result = resolveCardFaceContent(tmpl, card, 'back')

    expect(result.effectiveLayout).toHaveLength(2)
    expect(result.primaryValue).toBe('안녕')
  })
})

// ═══════════════════════════════════════════════════════
// resolveCardFaceContent — field key mismatch
// ═══════════════════════════════════════════════════════

describe('resolveCardFaceContent — field key mismatch', () => {
  it('should fall back when layout field_keys do not match card field_values', () => {
    // Template uses keys 'field_1', 'field_2' but card uses 'front', 'back'
    const tmpl = makeTemplate()
    const card = makeCard({ field_values: { front: '시험', back: 'test' } })
    const result = resolveCardFaceContent(tmpl, card, 'front')

    // effectiveLayout should be empty (field_1 not in card.field_values)
    expect(result.effectiveLayout).toHaveLength(0)
    // fallbackValue should use Object.values[0]
    expect(result.fallbackValue).toBe('시험')
  })

  it('should provide correct fallbackValue for back face on key mismatch', () => {
    const tmpl = makeTemplate()
    const card = makeCard({ field_values: { front: '시험', back: 'test' } })
    const result = resolveCardFaceContent(tmpl, card, 'back')

    expect(result.effectiveLayout).toHaveLength(0)
    expect(result.fallbackValue).toBe('test')
  })

  it('should handle partial key mismatch (some match, some do not)', () => {
    const tmpl = makeTemplate({
      back_layout: [
        { field_key: 'field_2', style: 'primary' as const },
        { field_key: 'field_3', style: 'hint' as const },
      ],
    })
    // card only has field_2 (matches), not field_3
    const card = makeCard({ field_values: { field_1: '시험', field_2: 'test' } })
    const result = resolveCardFaceContent(tmpl, card, 'back')

    expect(result.effectiveLayout).toEqual([{ field_key: 'field_2', style: 'primary' }])
    expect(result.primaryValue).toBe('test')
  })
})

// ═══════════════════════════════════════════════════════
// resolveCardFaceContent — null template
// ═══════════════════════════════════════════════════════

describe('resolveCardFaceContent — null template', () => {
  it('should return empty layout and fallback to first field value for front', () => {
    const card = makeCard({ field_values: { field_1: '시험', field_2: 'test' } })
    const result = resolveCardFaceContent(null, card, 'front')

    expect(result.effectiveLayout).toHaveLength(0)
    expect(result.primaryValue).toBe('시험')
    expect(result.fallbackValue).toBe('시험')
    expect(result.fields).toHaveLength(0)
  })

  it('should fallback to second field value for back face', () => {
    const card = makeCard({ field_values: { field_1: '시험', field_2: 'test' } })
    const result = resolveCardFaceContent(null, card, 'back')

    expect(result.effectiveLayout).toHaveLength(0)
    expect(result.primaryValue).toBe('test')
    expect(result.fallbackValue).toBe('test')
  })

  it('should use first value for back if only one field exists', () => {
    const card = makeCard({ field_values: { field_1: '시험' } })
    const result = resolveCardFaceContent(null, card, 'back')

    expect(result.fallbackValue).toBe('시험')
    expect(result.primaryValue).toBe('시험')
  })
})

// ═══════════════════════════════════════════════════════
// resolveCardFaceContent — empty layouts
// ═══════════════════════════════════════════════════════

describe('resolveCardFaceContent — empty layout arrays', () => {
  it('should handle template with empty front_layout', () => {
    const tmpl = makeTemplate({ front_layout: [] })
    const card = makeCard()
    const result = resolveCardFaceContent(tmpl, card, 'front')

    expect(result.effectiveLayout).toHaveLength(0)
    expect(result.fallbackValue).toBe('시험')
  })

  it('should handle template with empty back_layout', () => {
    const tmpl = makeTemplate({ back_layout: [] })
    const card = makeCard()
    const result = resolveCardFaceContent(tmpl, card, 'back')

    expect(result.effectiveLayout).toHaveLength(0)
    expect(result.fallbackValue).toBe('test')
  })
})

// ═══════════════════════════════════════════════════════
// resolveCardFaceContent — empty field_values
// ═══════════════════════════════════════════════════════

describe('resolveCardFaceContent — empty/edge case field_values', () => {
  it('should handle completely empty field_values', () => {
    const tmpl = makeTemplate()
    const card = makeCard({ field_values: {} })
    const result = resolveCardFaceContent(tmpl, card, 'front')

    expect(result.effectiveLayout).toHaveLength(0)
    expect(result.primaryValue).toBe('')
    expect(result.fallbackValue).toBe('')
  })

  it('should handle field_values where all values are empty strings', () => {
    const card = makeCard({ field_values: { field_1: '', field_2: '' } })
    const result = resolveCardFaceContent(null, card, 'front')

    expect(result.primaryValue).toBe('')
    expect(result.fallbackValue).toBe('')
  })

  it('should handle single field_value for both front and back', () => {
    const card = makeCard({ field_values: { only: 'single' } })
    const resultFront = resolveCardFaceContent(null, card, 'front')
    const resultBack = resolveCardFaceContent(null, card, 'back')

    expect(resultFront.fallbackValue).toBe('single')
    expect(resultBack.fallbackValue).toBe('single')
  })

  it('should handle three fields with correct fallback indices', () => {
    const card = makeCard({ field_values: { a: '1', b: '2', c: '3' } })
    const front = resolveCardFaceContent(null, card, 'front')
    const back = resolveCardFaceContent(null, card, 'back')

    expect(front.fallbackValue).toBe('1')
    expect(back.fallbackValue).toBe('2')
  })
})

// ═══════════════════════════════════════════════════════
// resolveCardFaceContent — primaryValue resolution
// ═══════════════════════════════════════════════════════

describe('resolveCardFaceContent — primaryValue', () => {
  it('should use first effectiveLayout item value as primaryValue', () => {
    const tmpl = makeTemplate({
      front_layout: [
        { field_key: 'field_1', style: 'secondary' as const },
        { field_key: 'field_2', style: 'primary' as const },
      ],
    })
    const card = makeCard()
    const result = resolveCardFaceContent(tmpl, card, 'front')

    // primaryValue should be from first effective layout item, not necessarily 'primary' style
    expect(result.primaryValue).toBe('시험')
  })

  it('should fall back to first field value when layout provides no value', () => {
    const tmpl = makeTemplate({
      front_layout: [{ field_key: 'nonexistent', style: 'primary' as const }],
    })
    const card = makeCard()
    const result = resolveCardFaceContent(tmpl, card, 'front')

    // Layout item has no matching value, so effectiveLayout is empty
    expect(result.effectiveLayout).toHaveLength(0)
    // primaryValue falls back to first field value
    expect(result.primaryValue).toBe('시험')
  })
})
