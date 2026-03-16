import { describe, it, expect } from 'vitest'
import { renderCustomHTML, escapeHTML } from '../template-renderer'

const sampleFields = [
  { key: 'field_1', name: '앞면' },
  { key: 'field_2', name: '뒷면' },
  { key: 'field_3', name: '이미지' },
]

// ═══════════════════════════════════════════════════════
// escapeHTML
// ═══════════════════════════════════════════════════════

describe('escapeHTML', () => {
  it('should escape < and >', () => {
    expect(escapeHTML('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    )
  })

  it('should escape &', () => {
    expect(escapeHTML('A & B')).toBe('A &amp; B')
  })

  it('should escape quotes', () => {
    expect(escapeHTML('"hello" \'world\'')).toBe('&quot;hello&quot; &#039;world&#039;')
  })

  it('should not modify safe strings', () => {
    expect(escapeHTML('hello world 123')).toBe('hello world 123')
  })

  it('should handle empty string', () => {
    expect(escapeHTML('')).toBe('')
  })
})

// ═══════════════════════════════════════════════════════
// renderCustomHTML — placeholder replacement
// ═══════════════════════════════════════════════════════

describe('renderCustomHTML', () => {
  it('should replace {{fieldName}} with field values', () => {
    const html = '<div>{{앞면}}</div>'
    const values = { field_1: 'hello' }
    const result = renderCustomHTML(html, values, sampleFields)
    expect(result).toBe('<div>hello</div>')
  })

  it('should replace multiple different placeholders', () => {
    const html = '<h1>{{앞면}}</h1><p>{{뒷면}}</p>'
    const values = { field_1: 'hello', field_2: '안녕' }
    const result = renderCustomHTML(html, values, sampleFields)
    expect(result).toBe('<h1>hello</h1><p>안녕</p>')
  })

  it('should replace multiple occurrences of same placeholder', () => {
    const html = '<div>{{앞면}} - {{앞면}}</div>'
    const values = { field_1: 'hello' }
    const result = renderCustomHTML(html, values, sampleFields)
    expect(result).toBe('<div>hello - hello</div>')
  })

  it('should leave empty string for missing field values', () => {
    const html = '<div>{{뒷면}}</div>'
    const values = {} // no values
    const result = renderCustomHTML(html, values, sampleFields)
    expect(result).toBe('<div></div>')
  })

  it('should escape HTML in field values to prevent XSS', () => {
    const html = '<div>{{앞면}}</div>'
    const values = { field_1: '<script>alert("xss")</script>' }
    const result = renderCustomHTML(html, values, sampleFields)
    expect(result).toBe('<div>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>')
  })

  it('should NOT escape the template HTML itself', () => {
    const html = '<div class="card"><h1>{{앞면}}</h1></div>'
    const values = { field_1: 'test' }
    const result = renderCustomHTML(html, values, sampleFields)
    expect(result).toBe('<div class="card"><h1>test</h1></div>')
  })

  it('should handle image URL in field value (no escaping issues)', () => {
    const html = '<img src="{{이미지}}" />'
    const values = { field_3: 'https://example.com/image.png' }
    const result = renderCustomHTML(html, values, sampleFields)
    expect(result).toBe('<img src="https://example.com/image.png" />')
  })

  it('should handle template with no placeholders', () => {
    const html = '<div>static content</div>'
    const result = renderCustomHTML(html, {}, sampleFields)
    expect(result).toBe('<div>static content</div>')
  })

  it('should handle unknown placeholders (leave as-is)', () => {
    const html = '<div>{{존재하지않는필드}}</div>'
    const result = renderCustomHTML(html, {}, sampleFields)
    expect(result).toBe('<div>{{존재하지않는필드}}</div>')
  })

  it('should handle empty HTML', () => {
    expect(renderCustomHTML('', {}, sampleFields)).toBe('')
  })

  it('should preserve inline styles in template', () => {
    const html = '<div style="color:red;font-size:24px">{{앞면}}</div>'
    const values = { field_1: '빨간글씨' }
    const result = renderCustomHTML(html, values, sampleFields)
    expect(result).toBe('<div style="color:red;font-size:24px">빨간글씨</div>')
  })
})
