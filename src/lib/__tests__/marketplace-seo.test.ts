import { describe, it, expect, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { language: 'en', t: (key: string) => key },
}))

import {
  buildListingDatasetJsonLd,
  buildListingBreadcrumbJsonLd,
  buildListingHreflangAlternates,
} from '../marketplace-seo'
import { SEO } from '../seo-config'
import type { PublicListingPreview } from '../../types/database'

const mockListing: PublicListingPreview = {
  id: 'abc-123',
  title: 'JLPT N3 Vocabulary',
  description: 'Essential vocabulary for JLPT N3',
  tags: ['japanese', 'jlpt', 'vocabulary'],
  category: 'language',
  card_count: 500,
  acquire_count: 42,
  share_mode: 'copy',
  created_at: '2025-06-01T00:00:00Z',
  owner_name: 'TestUser',
  owner_is_official: false,
  sample_fields: [
    { field_values: { front: 'word1', back: 'meaning1' } },
  ],
}

describe('buildListingDatasetJsonLd', () => {
  it('should return Dataset type with @context', () => {
    const result = buildListingDatasetJsonLd(mockListing)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('Dataset')
  })

  it('should include listing name and description', () => {
    const result = buildListingDatasetJsonLd(mockListing)
    expect(result.name).toBe('JLPT N3 Vocabulary')
    expect(result.description).toBe('Essential vocabulary for JLPT N3')
  })

  it('should include correct URL', () => {
    const result = buildListingDatasetJsonLd(mockListing)
    expect(result.url).toBe(`${SEO.SITE_URL}/d/abc-123`)
  })

  it('should include keywords from tags', () => {
    const result = buildListingDatasetJsonLd(mockListing)
    expect(result.keywords).toBe('japanese, jlpt, vocabulary')
  })

  it('should use Person type for non-official creators', () => {
    const result = buildListingDatasetJsonLd(mockListing)
    expect(result.creator['@type']).toBe('Person')
    expect(result.creator.name).toBe('TestUser')
  })

  it('should use Organization type for official creators', () => {
    const officialListing = { ...mockListing, owner_is_official: true }
    const result = buildListingDatasetJsonLd(officialListing)
    expect(result.creator['@type']).toBe('Organization')
  })

  it('should include publisher with logo', () => {
    const result = buildListingDatasetJsonLd(mockListing)
    expect(result.publisher['@type']).toBe('Organization')
    expect(result.publisher.name).toBe(SEO.BRAND_NAME)
    expect(result.publisher.logo['@type']).toBe('ImageObject')
  })

  it('should include isAccessibleForFree', () => {
    const result = buildListingDatasetJsonLd(mockListing)
    expect(result.isAccessibleForFree).toBe(true)
  })

  it('should include datePublished', () => {
    const result = buildListingDatasetJsonLd(mockListing)
    expect(result.datePublished).toBe('2025-06-01T00:00:00Z')
  })
})

describe('buildListingBreadcrumbJsonLd', () => {
  it('should return BreadcrumbList type', () => {
    const result = buildListingBreadcrumbJsonLd(mockListing)
    expect(result['@type']).toBe('BreadcrumbList')
  })

  it('should have 3 items: Home > Marketplace > Listing', () => {
    const result = buildListingBreadcrumbJsonLd(mockListing)
    expect(result.itemListElement).toHaveLength(3)
    expect(result.itemListElement[0].position).toBe(1)
    expect(result.itemListElement[1].position).toBe(2)
    expect(result.itemListElement[2].position).toBe(3)
  })

  it('should have correct URLs in breadcrumb chain', () => {
    const result = buildListingBreadcrumbJsonLd(mockListing)
    expect(result.itemListElement[0].item).toBe(SEO.SITE_URL)
    expect(result.itemListElement[1].item).toBe(`${SEO.SITE_URL}/landing`)
    expect(result.itemListElement[2].item).toBe(`${SEO.SITE_URL}/d/abc-123`)
  })

  it('should use listing title as last breadcrumb name', () => {
    const result = buildListingBreadcrumbJsonLd(mockListing)
    expect(result.itemListElement[2].name).toBe('JLPT N3 Vocabulary')
  })
})

describe('buildListingHreflangAlternates', () => {
  it('should return one entry per supported locale plus x-default', () => {
    const result = buildListingHreflangAlternates('abc-123')
    expect(result).toHaveLength(SEO.SUPPORTED_LOCALES.length + 1)
    const langs = result.map((r) => r.lang)
    for (const locale of SEO.SUPPORTED_LOCALES) {
      expect(langs).toContain(locale)
    }
    expect(langs).toContain('x-default')
  })

  it('should use SITE_URL from config', () => {
    const result = buildListingHreflangAlternates('abc-123')
    for (const alt of result) {
      expect(alt.href).toContain(SEO.SITE_URL)
    }
  })

  it('should have x-default pointing to listing without lang param', () => {
    const result = buildListingHreflangAlternates('abc-123')
    const xDefault = result.find((r) => r.lang === 'x-default')
    expect(xDefault?.href).toBe(`${SEO.SITE_URL}/d/abc-123`)
  })

  it('should include /d/ path in all URLs', () => {
    const result = buildListingHreflangAlternates('abc-123')
    for (const alt of result) {
      expect(alt.href).toContain('/d/abc-123')
    }
  })
})
