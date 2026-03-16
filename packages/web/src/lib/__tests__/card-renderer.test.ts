import { describe, it, expect } from 'vitest'
import { renderCardFace } from '../card-renderer'
import type { CardTemplate, Card, TemplateField } from '../../types/database'

// ── Helpers ──────────────────────────────────────────

function makeTemplate(overrides?: Partial<CardTemplate>): CardTemplate {
  return {
    id: 'tmpl-1',
    user_id: 'user-1',
    name: 'Basic',
    fields: [
      { key: 'front', name: '앞면', type: 'text', order: 0 },
      { key: 'back', name: '뒷면', type: 'text', order: 1 },
    ] as TemplateField[],
    front_layout: [{ field_key: 'front', style: 'primary' }],
    back_layout: [{ field_key: 'back', style: 'primary' }],
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
    field_values: { front: '你好', back: '안녕하세요' },
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
// renderCardFace — mode: 'default'
// ═══════════════════════════════════════════════════════

describe('renderCardFace — default mode', () => {
  it('should return mode "default" when layout_mode is "default"', () => {
    const template = makeTemplate({ layout_mode: 'default' })
    const card = makeCard()
    const result = renderCardFace(template, card, 'front')
    expect(result.mode).toBe('default')
    expect(result.html).toBeUndefined()
  })

  it('should return mode "default" when template is null', () => {
    const card = makeCard()
    const result = renderCardFace(null, card, 'front')
    expect(result.mode).toBe('default')
    expect(result.html).toBeUndefined()
  })

  it('should return mode "default" when layout_mode is undefined', () => {
    // Simulates old templates before migration (layout_mode missing from DB)
    const template = makeTemplate()
    ;(template as any).layout_mode = undefined
    const card = makeCard()
    const result = renderCardFace(template, card, 'front')
    expect(result.mode).toBe('default')
  })

  it('should return mode "default" for back side too', () => {
    const template = makeTemplate({ layout_mode: 'default' })
    const card = makeCard()
    const result = renderCardFace(template, card, 'back')
    expect(result.mode).toBe('default')
  })
})

// ═══════════════════════════════════════════════════════
// renderCardFace — mode: 'custom'
// ═══════════════════════════════════════════════════════

describe('renderCardFace — custom mode', () => {
  it('should return mode "custom" with rendered HTML for front', () => {
    const template = makeTemplate({
      layout_mode: 'custom',
      front_html: '<h1>{{앞면}}</h1>',
      back_html: '<p>{{뒷면}}</p>',
    })
    const card = makeCard()
    const result = renderCardFace(template, card, 'front')
    expect(result.mode).toBe('custom')
    expect(result.html).toBe('<h1>你好</h1>')
  })

  it('should return mode "custom" with rendered HTML for back', () => {
    const template = makeTemplate({
      layout_mode: 'custom',
      front_html: '<h1>{{앞면}}</h1>',
      back_html: '<p>{{뒷면}}</p>',
    })
    const card = makeCard()
    const result = renderCardFace(template, card, 'back')
    expect(result.mode).toBe('custom')
    expect(result.html).toBe('<p>안녕하세요</p>')
  })

  it('should escape HTML in field values to prevent XSS', () => {
    const template = makeTemplate({
      layout_mode: 'custom',
      front_html: '<div>{{앞면}}</div>',
    })
    const card = makeCard({ field_values: { front: '<script>alert("xss")</script>', back: 'safe' } })
    const result = renderCardFace(template, card, 'front')
    expect(result.mode).toBe('custom')
    expect(result.html).toBe('<div>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>')
  })

  it('should fallback to "default" when custom mode but front_html is empty', () => {
    const template = makeTemplate({
      layout_mode: 'custom',
      front_html: '',
      back_html: '<p>{{뒷면}}</p>',
    })
    const card = makeCard()
    const resultFront = renderCardFace(template, card, 'front')
    expect(resultFront.mode).toBe('default')
    expect(resultFront.html).toBeUndefined()
  })

  it('should fallback to "default" when custom mode but back_html is empty', () => {
    const template = makeTemplate({
      layout_mode: 'custom',
      front_html: '<h1>{{앞면}}</h1>',
      back_html: '',
    })
    const card = makeCard()
    const resultBack = renderCardFace(template, card, 'back')
    expect(resultBack.mode).toBe('default')
    expect(resultBack.html).toBeUndefined()
  })

  it('should handle multiple fields in custom HTML', () => {
    const template = makeTemplate({
      layout_mode: 'custom',
      front_html: '<div>{{앞면}} - {{뒷면}}</div>',
      fields: [
        { key: 'front', name: '앞면', type: 'text', order: 0 },
        { key: 'back', name: '뒷면', type: 'text', order: 1 },
      ] as TemplateField[],
    })
    const card = makeCard()
    const result = renderCardFace(template, card, 'front')
    expect(result.mode).toBe('custom')
    expect(result.html).toBe('<div>你好 - 안녕하세요</div>')
  })

  it('should handle missing field values gracefully', () => {
    const template = makeTemplate({
      layout_mode: 'custom',
      front_html: '<div>{{앞면}}</div>',
    })
    const card = makeCard({ field_values: {} })
    const result = renderCardFace(template, card, 'front')
    expect(result.mode).toBe('custom')
    expect(result.html).toBe('<div></div>')
  })

  it('should handle whitespace-only HTML as empty (fallback to default)', () => {
    const template = makeTemplate({
      layout_mode: 'custom',
      front_html: '   \n  ',
      back_html: '<p>test</p>',
    })
    const card = makeCard()
    const result = renderCardFace(template, card, 'front')
    expect(result.mode).toBe('default')
  })
})

// ═══════════════════════════════════════════════════════
// resolveTemplateLayoutMode — robust mode resolution
// ═══════════════════════════════════════════════════════

describe('renderCardFace — resolveTemplateLayoutMode edge cases', () => {
  it('should treat null layout_mode as default', () => {
    const template = makeTemplate()
    ;(template as any).layout_mode = null
    const card = makeCard()
    const result = renderCardFace(template, card, 'front')
    expect(result.mode).toBe('default')
  })

  it('should treat any non-"custom" string as default', () => {
    const template = makeTemplate()
    ;(template as any).layout_mode = 'something_else'
    const card = makeCard()
    const result = renderCardFace(template, card, 'front')
    expect(result.mode).toBe('default')
  })
})
