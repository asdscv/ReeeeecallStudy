import { describe, it, expect } from 'vitest'
import { renderJsonLd } from '../seo/html-builder.js'

describe('renderJsonLd (shared, escaped JSON-LD serializer)', () => {
  it('escapes < so a </script> inside a field cannot break out of the element', () => {
    const out = renderJsonLd([{ name: '</script><script>alert(1)</script>' }])
    expect(out).not.toContain('</script><script>') // no real breakout sequence
    expect(out).toContain('\\u003c/script')        // escaped instead
    expect(out.startsWith('<script type="application/ld+json">')).toBe(true)
    expect(out.endsWith('</script>')).toBe(true)
  })

  it('drops null/undefined schemas (e.g. an empty FAQ block)', () => {
    const out = renderJsonLd([null, { a: 1 }, undefined])
    expect((out.match(/<script/g) || []).length).toBe(1)
  })

  it('emits valid JSON that parses back to the original (escape is JSON-safe)', () => {
    const out = renderJsonLd([{ '@type': 'Thing', name: 'x<y</script>' }])
    const json = out.slice('<script type="application/ld+json">'.length, -'</script>'.length)
    expect(JSON.parse(json).name).toBe('x<y</script>')
  })
})
