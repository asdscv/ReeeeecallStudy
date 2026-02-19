import { describe, it, expect } from 'vitest'
import { buildCtaUrl, buildInternalUrl, UTM_DEFAULTS } from '../utm-builder.js'

describe('UTM Builder', () => {
  describe('UTM_DEFAULTS', () => {
    it('has correct default values', () => {
      expect(UTM_DEFAULTS.source).toBe('blog')
      expect(UTM_DEFAULTS.medium_cta).toBe('cta')
      expect(UTM_DEFAULTS.medium_link).toBe('content_link')
    })
  })

  describe('buildCtaUrl', () => {
    it('builds CTA URL with all UTM params', () => {
      const url = buildCtaUrl('/auth/login', 'spaced-repetition-tips', 'en')
      expect(url).toContain('/auth/login?')
      expect(url).toContain('utm_source=blog')
      expect(url).toContain('utm_medium=cta')
      expect(url).toContain('utm_campaign=spaced-repetition-tips')
      expect(url).toContain('utm_content=cta_en')
    })

    it('uses Korean locale in utm_content', () => {
      const url = buildCtaUrl('/auth/login', 'study-guide', 'ko')
      expect(url).toContain('utm_content=cta_ko')
    })

    it('handles custom block type in utm_content', () => {
      const url = buildCtaUrl('/auth/login', 'my-slug', 'en', 'hero')
      expect(url).toContain('utm_content=hero_en')
    })

    it('preserves existing query params on the base URL', () => {
      const url = buildCtaUrl('/auth/login?ref=top', 'my-slug', 'en')
      expect(url).toContain('ref=top')
      expect(url).toContain('utm_source=blog')
    })

    it('encodes special characters in slug', () => {
      const url = buildCtaUrl('/auth/login', 'slug with spaces', 'en')
      expect(url).toContain('utm_campaign=slug+with+spaces')
    })

    it('defaults to /auth/login when base URL is empty', () => {
      const url = buildCtaUrl('', 'my-slug', 'en')
      expect(url).toContain('/auth/login?')
      expect(url).toContain('utm_source=blog')
    })

    it('defaults blockType to cta', () => {
      const url = buildCtaUrl('/auth/login', 'my-slug', 'en')
      expect(url).toContain('utm_content=cta_en')
    })

    it('truncates long slugs to 200 chars in utm_campaign', () => {
      const longSlug = 'a'.repeat(300)
      const url = buildCtaUrl('/auth/login', longSlug, 'en')
      const params = new URLSearchParams(url.split('?')[1])
      expect(params.get('utm_campaign').length).toBeLessThanOrEqual(200)
    })
  })

  describe('buildInternalUrl', () => {
    it('builds internal link URL with content_link medium', () => {
      const url = buildInternalUrl('/deck/123', 'my-article', 'en')
      expect(url).toContain('utm_source=blog')
      expect(url).toContain('utm_medium=content_link')
      expect(url).toContain('utm_campaign=my-article')
      expect(url).toContain('utm_content=link_en')
    })

    it('passes custom label for utm_content', () => {
      const url = buildInternalUrl('/features', 'my-article', 'ko', 'feature_callout')
      expect(url).toContain('utm_content=feature_callout_ko')
    })
  })
})
