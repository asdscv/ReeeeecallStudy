import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('i18next', () => ({
  default: { language: 'en', t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key },
}))

import {
  buildArticleJsonLd,
  buildCollectionPageJsonLd,
  buildWebApplicationJsonLd,
  buildHreflangAlternates,
  buildBreadcrumbJsonLd,
} from '../content-seo'
import { SEO } from '../seo-config'
import type { ContentDetail } from '../../types/content-blocks'

const mockArticle: ContentDetail = {
  id: '1',
  slug: 'test-article',
  locale: 'en',
  title: 'Test Article',
  subtitle: 'Test subtitle',
  thumbnail_url: 'https://example.com/thumb.jpg',
  content_blocks: [],
  reading_time_minutes: 5,
  tags: ['learning', 'srs'],
  meta_title: 'Test Article | ReeeeecallStudy',
  meta_description: 'Test description',
  og_image_url: 'https://example.com/og.jpg',
  canonical_url: 'https://reeeeecallstudy.com/content/test-article',
  author_name: 'ReeeeecallStudy',
  is_published: true,
  published_at: '2025-01-01T00:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
}

describe('buildArticleJsonLd', () => {
  it('should include @type Article', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result['@type']).toBe('Article')
  })

  it('should include mainEntityOfPage with article URL', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': `${SEO.SITE_URL}/content/test-article`,
    })
  })

  it('should include inLanguage from article locale', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.inLanguage).toBe('en')
  })

  it('should include datePublished and dateModified', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.datePublished).toBe('2025-01-01T00:00:00Z')
    expect(result.dateModified).toBe('2025-01-02T00:00:00Z')
  })

  it('should include publisher with logo ImageObject', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.publisher['@type']).toBe('Organization')
    expect(result.publisher.logo['@type']).toBe('ImageObject')
  })
})

describe('buildBreadcrumbJsonLd', () => {
  it('should return BreadcrumbList type', () => {
    const result = buildBreadcrumbJsonLd(mockArticle)
    expect(result['@type']).toBe('BreadcrumbList')
  })

  it('should have 3 items: Home → Insights → Article', () => {
    const result = buildBreadcrumbJsonLd(mockArticle)
    expect(result.itemListElement).toHaveLength(3)
    expect(result.itemListElement[0].position).toBe(1)
    expect(result.itemListElement[1].position).toBe(2)
    expect(result.itemListElement[2].position).toBe(3)
  })

  it('should have correct URLs in breadcrumb chain', () => {
    const result = buildBreadcrumbJsonLd(mockArticle)
    expect(result.itemListElement[0].item).toBe(SEO.SITE_URL)
    expect(result.itemListElement[1].item).toBe(`${SEO.SITE_URL}/content`)
    expect(result.itemListElement[2].item).toBe(`${SEO.SITE_URL}/content/test-article`)
  })

  it('should use article title as last breadcrumb name', () => {
    const result = buildBreadcrumbJsonLd(mockArticle)
    expect(result.itemListElement[2].name).toBe('Test Article')
  })
})

describe('buildCollectionPageJsonLd', () => {
  it('should include inLanguage', () => {
    const result = buildCollectionPageJsonLd()
    expect(result).toHaveProperty('inLanguage')
  })

  it('should have CollectionPage type', () => {
    const result = buildCollectionPageJsonLd()
    expect(result['@type']).toBe('CollectionPage')
  })
})

describe('buildWebApplicationJsonLd', () => {
  it('should include inLanguage', () => {
    const result = buildWebApplicationJsonLd()
    expect(result).toHaveProperty('inLanguage')
  })

  it('should use SITE_URL from config', () => {
    const result = buildWebApplicationJsonLd()
    expect(result.url).toBe(SEO.SITE_URL)
  })
})

describe('buildHreflangAlternates', () => {
  it('should return en, ko, and x-default', () => {
    const result = buildHreflangAlternates('test-slug')
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.lang)).toEqual(['en', 'ko', 'x-default'])
  })

  it('should use SITE_URL from config', () => {
    const result = buildHreflangAlternates('test-slug')
    for (const alt of result) {
      expect(alt.href).toContain(SEO.SITE_URL)
    }
  })
})
