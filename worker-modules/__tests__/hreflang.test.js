import { describe, it, expect } from 'vitest'
import { buildHreflangTags } from '../seo/helpers.js'

describe('buildHreflangTags', () => {
  it('emits only the locales passed in (no phantom variants)', () => {
    const out = buildHreflangTags('/insight/foo', true, ['en', 'ko'])
    expect(out).toContain('hreflang="en"')
    expect(out).toContain('hreflang="ko"')
    expect(out).not.toContain('hreflang="ja"')
    expect(out).not.toContain('hreflang="zh"')
  })

  it('always includes x-default pointing at the clean (param-free) URL', () => {
    const out = buildHreflangTags('/insight/foo', true, ['en'])
    expect(out).toContain(
      '<link rel="alternate" hreflang="x-default" href="https://reeeeecallstudy.xyz/insight/foo">',
    )
  })

  it('defaults to the indexable locales (en, ko) when none are passed', () => {
    const out = buildHreflangTags('/insight', true)
    expect(out).toContain('hreflang="en"')
    expect(out).toContain('hreflang="ko"')
    expect(out).not.toContain('hreflang="ja"')
  })

  it('appends ?lang= per locale when queryParam is true', () => {
    const out = buildHreflangTags('/insight/foo', true, ['ko'])
    expect(out).toContain('href="https://reeeeecallstudy.xyz/insight/foo?lang=ko"')
  })
})
