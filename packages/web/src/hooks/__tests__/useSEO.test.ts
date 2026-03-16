import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSEO } from '../useSEO'
import { SEO } from '../../lib/seo-config'
import { DEFAULT_LOCALE, OG_LOCALE_MAP, SUPPORTED_LOCALES } from '../../lib/locale-utils'

const mockLocale = vi.hoisted(() => {
  // vi.mock factory is hoisted, so we inline the default here and keep it in sync via test assertion below
  return 'en'
})

vi.mock('i18next', () => ({
  default: { language: mockLocale },
}))

// Guard: if DEFAULT_LOCALE changes, update mockLocale in vi.hoisted above
it('mockLocale matches DEFAULT_LOCALE', () => {
  expect(mockLocale).toBe(DEFAULT_LOCALE)
})

describe('useSEO', () => {
  let originalTitle: string

  beforeEach(() => {
    originalTitle = document.title
    // Clear all meta tags
    document.head.querySelectorAll('meta[property], meta[name], link[rel="canonical"], link[rel="alternate"], script[type="application/ld+json"]').forEach((el) => el.remove())
  })

  afterEach(() => {
    document.title = originalTitle
  })

  it('should set document title', () => {
    renderHook(() => useSEO({ title: 'Test Title', description: 'desc' }))
    expect(document.title).toBe('Test Title')
  })

  it('should set og:site_name to brand name', () => {
    renderHook(() => useSEO({ title: 'T', description: 'd' }))
    const meta = document.querySelector('meta[property="og:site_name"]')
    expect(meta).toBeTruthy()
    expect(meta?.getAttribute('content')).toBe(SEO.BRAND_NAME)
  })

  it('should set og:locale based on language', () => {
    renderHook(() => useSEO({ title: 'T', description: 'd' }))
    const meta = document.querySelector('meta[property="og:locale"]')
    expect(meta).toBeTruthy()
    expect(meta?.getAttribute('content')).toBe(OG_LOCALE_MAP[DEFAULT_LOCALE])
  })

  it('should set twitter:site to configured handle', () => {
    renderHook(() => useSEO({ title: 'T', description: 'd' }))
    const meta = document.querySelector('meta[name="twitter:site"]')
    expect(meta).toBeTruthy()
    expect(meta?.getAttribute('content')).toBe(SEO.TWITTER_HANDLE)
  })

  it('should set og:image:width and og:image:height when ogImage is provided', () => {
    renderHook(() => useSEO({ title: 'T', description: 'd', ogImage: 'https://example.com/img.png' }))
    const width = document.querySelector('meta[property="og:image:width"]')
    const height = document.querySelector('meta[property="og:image:height"]')
    expect(width).toBeTruthy()
    expect(height).toBeTruthy()
  })

  it('should set article:published_time for article type', () => {
    renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        ogType: 'article',
        publishedTime: '2025-01-01T00:00:00Z',
      }),
    )
    const meta = document.querySelector('meta[property="article:published_time"]')
    expect(meta).toBeTruthy()
    expect(meta?.getAttribute('content')).toBe('2025-01-01T00:00:00Z')
  })

  it('should set canonical link', () => {
    renderHook(() =>
      useSEO({ title: 'T', description: 'd', canonicalUrl: 'https://example.com/page' }),
    )
    const link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement
    expect(link).toBeTruthy()
    expect(link?.href).toBe('https://example.com/page')
  })

  it('should set hreflang alternate links', () => {
    const testLocales = SUPPORTED_LOCALES.slice(0, 2)
    renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        hreflangAlternates: testLocales.map((l) => ({ lang: l, href: `https://example.com/${l}` })),
      }),
    )
    for (const locale of testLocales) {
      const link = document.querySelector(`link[rel="alternate"][hreflang="${locale}"]`) as HTMLLinkElement
      expect(link?.href).toBe(`https://example.com/${locale}`)
    }
  })

  it('should inject JSON-LD script', () => {
    const jsonLd = { '@type': 'Article', headline: 'Test' }
    renderHook(() => useSEO({ title: 'T', description: 'd', jsonLd }))
    const script = document.querySelector('script[type="application/ld+json"]')
    expect(script).toBeTruthy()
    expect(JSON.parse(script!.textContent!)).toEqual(jsonLd)
  })

  it('should cleanup on unmount', () => {
    const { unmount } = renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        canonicalUrl: 'https://example.com',
        hreflangAlternates: [{ lang: DEFAULT_LOCALE, href: `https://example.com/${DEFAULT_LOCALE}` }],
        jsonLd: { '@type': 'Test' },
      }),
    )
    unmount()
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull()
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.querySelector(`link[rel="alternate"][hreflang="${DEFAULT_LOCALE}"]`)).toBeNull()
  })

  it('should set html lang from i18next', () => {
    renderHook(() => useSEO({ title: 'T', description: 'd' }))
    expect(document.documentElement.lang).toBe(DEFAULT_LOCALE)
  })

  it('should cleanup og:image dimensions on unmount', () => {
    const { unmount } = renderHook(() =>
      useSEO({ title: 'T', description: 'd', ogImage: 'https://example.com/img.png' }),
    )
    expect(document.querySelector('meta[property="og:image:width"]')).toBeTruthy()
    unmount()
    expect(document.querySelector('meta[property="og:image:width"]')).toBeNull()
    expect(document.querySelector('meta[property="og:image:height"]')).toBeNull()
  })

  it('should cleanup article:section on unmount', () => {
    const { unmount } = renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        ogType: 'article',
        publishedTime: '2025-01-01',
        articleSection: 'Learning',
      }),
    )
    expect(document.querySelector('meta[property="article:section"]')).toBeTruthy()
    unmount()
    expect(document.querySelector('meta[property="article:published_time"]')).toBeNull()
    expect(document.querySelector('meta[property="article:section"]')).toBeNull()
  })

  it('should support multiple JSON-LD schemas as array', () => {
    const schemas = [
      { '@type': 'Article', headline: 'Test' },
      { '@type': 'BreadcrumbList', itemListElement: [] },
    ]
    renderHook(() => useSEO({ title: 'T', description: 'd', jsonLd: schemas }))
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    expect(scripts).toHaveLength(2)
  })

  it('should cleanup all JSON-LD scripts on unmount when array', () => {
    const schemas = [
      { '@type': 'Article', headline: 'Test' },
      { '@type': 'BreadcrumbList', itemListElement: [] },
    ]
    const { unmount } = renderHook(() => useSEO({ title: 'T', description: 'd', jsonLd: schemas }))
    expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(2)
    unmount()
    expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0)
  })

  it('should set article:section for article type', () => {
    renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        ogType: 'article',
        articleSection: 'Learning',
      }),
    )
    const meta = document.querySelector('meta[property="article:section"]')
    expect(meta).toBeTruthy()
    expect(meta?.getAttribute('content')).toBe('Learning')
  })

  it('should set keywords meta tag', () => {
    renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        keywords: ['spaced repetition', 'flashcards', 'learning'],
      }),
    )
    const meta = document.querySelector('meta[name="keywords"]')
    expect(meta).toBeTruthy()
    expect(meta?.getAttribute('content')).toBe('spaced repetition, flashcards, learning')
  })

  it('should not set keywords meta when keywords is empty', () => {
    renderHook(() =>
      useSEO({ title: 'T', description: 'd', keywords: [] }),
    )
    const meta = document.querySelector('meta[name="keywords"]')
    expect(meta).toBeNull()
  })

  it('should set article:tag meta for each tag', () => {
    renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        ogType: 'article',
        articleTags: ['srs', 'learning', 'memory'],
      }),
    )
    const tags = document.querySelectorAll('meta[property="article:tag"]')
    expect(tags).toHaveLength(3)
    expect(tags[0].getAttribute('content')).toBe('srs')
    expect(tags[1].getAttribute('content')).toBe('learning')
    expect(tags[2].getAttribute('content')).toBe('memory')
  })

  it('should cleanup article:tag on unmount', () => {
    const { unmount } = renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        ogType: 'article',
        articleTags: ['srs', 'learning'],
      }),
    )
    expect(document.querySelectorAll('meta[property="article:tag"]')).toHaveLength(2)
    unmount()
    expect(document.querySelectorAll('meta[property="article:tag"]')).toHaveLength(0)
  })

  it('should cleanup keywords meta on unmount', () => {
    const { unmount } = renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        keywords: ['test'],
      }),
    )
    expect(document.querySelector('meta[name="keywords"]')).toBeTruthy()
    unmount()
    expect(document.querySelector('meta[name="keywords"]')).toBeNull()
  })

  it('should set og:image:alt and twitter:image:alt when ogImage is provided', () => {
    renderHook(() =>
      useSEO({
        title: 'My Article Title',
        description: 'd',
        ogImage: 'https://example.com/img.png',
      }),
    )
    const ogAlt = document.querySelector('meta[property="og:image:alt"]')
    const twAlt = document.querySelector('meta[name="twitter:image:alt"]')
    expect(ogAlt).toBeTruthy()
    expect(ogAlt?.getAttribute('content')).toBe('My Article Title')
    expect(twAlt).toBeTruthy()
    expect(twAlt?.getAttribute('content')).toBe('My Article Title')
  })

  it('should cleanup og:image:alt and twitter:image:alt on unmount', () => {
    const { unmount } = renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        ogImage: 'https://example.com/img.png',
      }),
    )
    expect(document.querySelector('meta[property="og:image:alt"]')).toBeTruthy()
    expect(document.querySelector('meta[name="twitter:image:alt"]')).toBeTruthy()
    unmount()
    expect(document.querySelector('meta[property="og:image:alt"]')).toBeNull()
    expect(document.querySelector('meta[name="twitter:image:alt"]')).toBeNull()
  })

  it('should set og:locale:alternate for other supported locales', () => {
    renderHook(() => useSEO({ title: 'T', description: 'd' }))
    const alternates = document.querySelectorAll('meta[property="og:locale:alternate"]')
    // Current locale is DEFAULT_LOCALE, so alternates should be all others
    expect(alternates.length).toBe(SUPPORTED_LOCALES.length - 1)
  })

  it('should cleanup og:locale:alternate on unmount', () => {
    const { unmount } = renderHook(() => useSEO({ title: 'T', description: 'd' }))
    expect(document.querySelector('meta[property="og:locale:alternate"]')).toBeTruthy()
    unmount()
    expect(document.querySelector('meta[property="og:locale:alternate"]')).toBeNull()
  })

  it('should cleanup all OG and Twitter meta tags on unmount', () => {
    const { unmount } = renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        ogImage: 'https://example.com/img.png',
        canonicalUrl: 'https://example.com',
      }),
    )
    // Verify tags exist
    expect(document.querySelector('meta[property="og:title"]')).toBeTruthy()
    expect(document.querySelector('meta[property="og:description"]')).toBeTruthy()
    expect(document.querySelector('meta[property="og:type"]')).toBeTruthy()
    expect(document.querySelector('meta[property="og:site_name"]')).toBeTruthy()
    expect(document.querySelector('meta[property="og:locale"]')).toBeTruthy()
    expect(document.querySelector('meta[property="og:url"]')).toBeTruthy()
    expect(document.querySelector('meta[property="og:image"]')).toBeTruthy()
    expect(document.querySelector('meta[name="description"]')).toBeTruthy()
    expect(document.querySelector('meta[name="twitter:card"]')).toBeTruthy()
    expect(document.querySelector('meta[name="twitter:site"]')).toBeTruthy()
    expect(document.querySelector('meta[name="twitter:title"]')).toBeTruthy()
    expect(document.querySelector('meta[name="twitter:description"]')).toBeTruthy()
    expect(document.querySelector('meta[name="twitter:image"]')).toBeTruthy()

    unmount()

    // All should be cleaned up
    expect(document.querySelector('meta[property="og:title"]')).toBeNull()
    expect(document.querySelector('meta[property="og:description"]')).toBeNull()
    expect(document.querySelector('meta[property="og:type"]')).toBeNull()
    expect(document.querySelector('meta[property="og:site_name"]')).toBeNull()
    expect(document.querySelector('meta[property="og:locale"]')).toBeNull()
    expect(document.querySelector('meta[property="og:url"]')).toBeNull()
    expect(document.querySelector('meta[property="og:image"]')).toBeNull()
    expect(document.querySelector('meta[name="description"]')).toBeNull()
    expect(document.querySelector('meta[name="twitter:card"]')).toBeNull()
    expect(document.querySelector('meta[name="twitter:site"]')).toBeNull()
    expect(document.querySelector('meta[name="twitter:title"]')).toBeNull()
    expect(document.querySelector('meta[name="twitter:description"]')).toBeNull()
    expect(document.querySelector('meta[name="twitter:image"]')).toBeNull()
  })

  it('should set robots noindex,nofollow when noIndex is true', () => {
    renderHook(() =>
      useSEO({ title: 'Not Found', description: 'd', noIndex: true }),
    )
    const meta = document.querySelector('meta[name="robots"]')
    expect(meta).toBeTruthy()
    expect(meta?.getAttribute('content')).toBe('noindex, follow')
  })

  it('should not set robots meta when noIndex is not provided', () => {
    renderHook(() => useSEO({ title: 'T', description: 'd' }))
    // Should not add a robots meta (default from index.html handles it)
    const meta = document.querySelector('meta[name="robots"]')
    expect(meta).toBeNull()
  })

  it('should cleanup robots meta on unmount when noIndex was set', () => {
    const { unmount } = renderHook(() =>
      useSEO({ title: 'Not Found', description: 'd', noIndex: true }),
    )
    expect(document.querySelector('meta[name="robots"]')).toBeTruthy()
    unmount()
    expect(document.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('should set article:author when ogType is article and articleAuthor is provided', () => {
    renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        ogType: 'article',
        articleAuthor: 'ReeeeecallStudy',
      }),
    )
    const meta = document.querySelector('meta[property="article:author"]')
    expect(meta).toBeTruthy()
    expect(meta?.getAttribute('content')).toBe('ReeeeecallStudy')
  })

  it('should cleanup article:author on unmount', () => {
    const { unmount } = renderHook(() =>
      useSEO({
        title: 'T',
        description: 'd',
        ogType: 'article',
        articleAuthor: 'ReeeeecallStudy',
      }),
    )
    expect(document.querySelector('meta[property="article:author"]')).toBeTruthy()
    unmount()
    expect(document.querySelector('meta[property="article:author"]')).toBeNull()
  })
})
