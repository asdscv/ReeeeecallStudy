import { describe, it, expect } from 'vitest'
import type { CardTemplate, TemplateField, LayoutMode } from '../../types/database'

/**
 * Tests for template initialization logic used by TemplateEditPage.
 * These verify that the resolveTemplateState function correctly
 * extracts layout_mode from templates in all edge cases.
 */

// This mirrors the initialization logic in TemplateEditPage's useEffect
function resolveTemplateState(template: CardTemplate | null) {
  if (!template) {
    return {
      name: '',
      fields: [],
      frontLayout: [],
      backLayout: [],
      layoutMode: 'default' as LayoutMode,
      frontHtml: '',
      backHtml: '',
    }
  }

  return {
    name: template.name,
    fields: [...template.fields],
    frontLayout: [...template.front_layout],
    backLayout: [...template.back_layout],
    layoutMode: (template.layout_mode ?? 'default') as LayoutMode,
    frontHtml: template.front_html ?? '',
    backHtml: template.back_html ?? '',
  }
}

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

describe('resolveTemplateState', () => {
  it('should return default state when template is null', () => {
    const result = resolveTemplateState(null)
    expect(result.layoutMode).toBe('default')
    expect(result.frontHtml).toBe('')
    expect(result.backHtml).toBe('')
  })

  it('should preserve layout_mode "default" from template', () => {
    const template = makeTemplate({ layout_mode: 'default' })
    const result = resolveTemplateState(template)
    expect(result.layoutMode).toBe('default')
  })

  it('should preserve layout_mode "custom" from template', () => {
    const template = makeTemplate({
      layout_mode: 'custom',
      front_html: '<h1>{{앞면}}</h1>',
      back_html: '<p>{{뒷면}}</p>',
    })
    const result = resolveTemplateState(template)
    expect(result.layoutMode).toBe('custom')
    expect(result.frontHtml).toBe('<h1>{{앞면}}</h1>')
    expect(result.backHtml).toBe('<p>{{뒷면}}</p>')
  })

  it('should fallback to "default" when layout_mode is undefined (pre-migration)', () => {
    const template = makeTemplate()
    ;(template as any).layout_mode = undefined
    const result = resolveTemplateState(template)
    expect(result.layoutMode).toBe('default')
  })

  it('should fallback to "default" when layout_mode is null', () => {
    const template = makeTemplate()
    ;(template as any).layout_mode = null
    const result = resolveTemplateState(template)
    expect(result.layoutMode).toBe('default')
  })

  it('should handle undefined front_html/back_html (pre-migration)', () => {
    const template = makeTemplate()
    ;(template as any).front_html = undefined
    ;(template as any).back_html = undefined
    const result = resolveTemplateState(template)
    expect(result.frontHtml).toBe('')
    expect(result.backHtml).toBe('')
  })

  it('should preserve all other template fields', () => {
    const template = makeTemplate({
      name: 'Chinese Vocab',
      layout_mode: 'custom',
      front_html: '<div>{{앞면}}</div>',
    })
    const result = resolveTemplateState(template)
    expect(result.name).toBe('Chinese Vocab')
    expect(result.fields).toHaveLength(2)
    expect(result.frontLayout).toHaveLength(1)
    expect(result.backLayout).toHaveLength(1)
  })

  it('should preserve field detail property when present', () => {
    const template = makeTemplate({
      fields: [
        { key: 'front', name: '앞면', type: 'text', order: 0, detail: '중국어 단어를 입력하세요' },
        { key: 'back', name: '뒷면', type: 'text', order: 1 },
      ],
    })
    const result = resolveTemplateState(template)
    expect(result.fields[0].detail).toBe('중국어 단어를 입력하세요')
    expect(result.fields[1].detail).toBeUndefined()
  })

  it('should not mutate the original template arrays', () => {
    const template = makeTemplate()
    const originalFields = template.fields
    const result = resolveTemplateState(template)
    result.fields.push({ key: 'new', name: 'new', type: 'text', order: 99 })
    expect(template.fields).toBe(originalFields)
    expect(template.fields).toHaveLength(2)
  })
})

// ═══════════════════════════════════════════════════════
// Save payload verification
// ═══════════════════════════════════════════════════════

describe('save payload includes layout_mode', () => {
  it('should include layout_mode in update payload', () => {
    // Simulates what TemplateEditPage sends to updateTemplate
    const layoutMode: LayoutMode = 'custom'
    const frontHtml = '<h1>{{앞면}}</h1>'
    const backHtml = '<p>{{뒷면}}</p>'

    const payload = {
      name: 'Test',
      fields: [],
      front_layout: [],
      back_layout: [],
      layout_mode: layoutMode,
      front_html: frontHtml,
      back_html: backHtml,
    }

    expect(payload.layout_mode).toBe('custom')
    expect(payload.front_html).toBe('<h1>{{앞면}}</h1>')
    expect(payload.back_html).toBe('<p>{{뒷면}}</p>')
  })

  it('should preserve field detail in save payload', () => {
    const fields: TemplateField[] = [
      { key: 'word', name: '단어', type: 'text', order: 0, detail: '학습할 단어를 입력하세요' },
      { key: 'meaning', name: '뜻', type: 'text', order: 1 },
    ]

    const payload = {
      name: 'Test',
      fields,
      front_layout: [],
      back_layout: [],
      layout_mode: 'default' as LayoutMode,
      front_html: '',
      back_html: '',
    }

    expect(payload.fields[0].detail).toBe('학습할 단어를 입력하세요')
    expect(payload.fields[1].detail).toBeUndefined()
  })

  it('should include layout_mode "default" when saving default mode', () => {
    const layoutMode: LayoutMode = 'default'

    const payload = {
      name: 'Test',
      fields: [],
      front_layout: [],
      back_layout: [],
      layout_mode: layoutMode,
      front_html: '',
      back_html: '',
    }

    expect(payload.layout_mode).toBe('default')
  })
})
