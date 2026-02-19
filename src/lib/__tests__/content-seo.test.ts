import { describe, it, expect, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { language: 'en', t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue || key },
}))

import {
  buildArticleJsonLd,
  buildCollectionPageJsonLd,
  buildWebApplicationJsonLd,
  buildHreflangAlternates,
  buildBreadcrumbJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  buildFAQJsonLd,
  buildHowToJsonLd,
  buildLearningResourceJsonLd,
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

  it('should include wordCount estimated from reading time', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.wordCount).toBe(1250) // 5 min * 250 wpm
  })

  it('should include logo ImageObject with dimensions', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.publisher.logo.width).toBe(SEO.OG_IMAGE_WIDTH)
    expect(result.publisher.logo.height).toBe(SEO.OG_IMAGE_HEIGHT)
  })

  it('should include keywords from tags', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.keywords).toBe('learning, srs')
  })

  it('should use ImageObject for image property', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.image['@type']).toBe('ImageObject')
    expect(result.image.url).toBe('https://example.com/og.jpg')
    expect(result.image.width).toBe(SEO.OG_IMAGE_WIDTH)
    expect(result.image.height).toBe(SEO.OG_IMAGE_HEIGHT)
  })

  it('should include url in author', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.author.url).toBe(SEO.SITE_URL)
  })

  it('should include url in publisher', () => {
    const result = buildArticleJsonLd(mockArticle)
    expect(result.publisher.url).toBe(SEO.SITE_URL)
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

  it('should include publisher organization', () => {
    const result = buildCollectionPageJsonLd()
    expect(result.publisher['@type']).toBe('Organization')
    expect(result.publisher.name).toBe(SEO.BRAND_NAME)
  })

  it('should include image as ImageObject', () => {
    const result = buildCollectionPageJsonLd()
    expect(result.image['@type']).toBe('ImageObject')
    expect(result.image.url).toBe(SEO.DEFAULT_OG_IMAGE)
  })

  it('should include publisher logo ImageObject with dimensions', () => {
    const result = buildCollectionPageJsonLd()
    expect(result.publisher.logo['@type']).toBe('ImageObject')
    expect(result.publisher.logo.url).toBe(SEO.DEFAULT_OG_IMAGE)
    expect(result.publisher.logo.width).toBe(SEO.OG_IMAGE_WIDTH)
    expect(result.publisher.logo.height).toBe(SEO.OG_IMAGE_HEIGHT)
  })

  it('should use ImageObject for image property', () => {
    const result = buildCollectionPageJsonLd()
    expect(result.image['@type']).toBe('ImageObject')
    expect(result.image.url).toBe(SEO.DEFAULT_OG_IMAGE)
    expect(result.image.width).toBe(SEO.OG_IMAGE_WIDTH)
    expect(result.image.height).toBe(SEO.OG_IMAGE_HEIGHT)
  })

  it('should include url in publisher', () => {
    const result = buildCollectionPageJsonLd()
    expect(result.publisher.url).toBe(SEO.SITE_URL)
  })

  it('should include mainEntityOfPage', () => {
    const result = buildCollectionPageJsonLd()
    expect(result.mainEntityOfPage).toEqual({
      '@type': 'WebPage',
      '@id': `${SEO.SITE_URL}/content`,
    })
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

  it('should include publisher logo ImageObject with dimensions', () => {
    const result = buildWebApplicationJsonLd()
    expect(result.publisher.logo.width).toBe(SEO.OG_IMAGE_WIDTH)
    expect(result.publisher.logo.height).toBe(SEO.OG_IMAGE_HEIGHT)
  })

  it('should include url in publisher', () => {
    const result = buildWebApplicationJsonLd()
    expect(result.publisher.url).toBe(SEO.SITE_URL)
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

describe('buildOrganizationJsonLd', () => {
  it('should return Organization type with @context', () => {
    const result = buildOrganizationJsonLd()
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('Organization')
  })

  it('should include brand name and site URL', () => {
    const result = buildOrganizationJsonLd()
    expect(result.name).toBe(SEO.BRAND_NAME)
    expect(result.url).toBe(SEO.SITE_URL)
  })

  it('should include logo as ImageObject', () => {
    const result = buildOrganizationJsonLd()
    expect(result.logo['@type']).toBe('ImageObject')
    expect(result.logo.url).toBe(SEO.DEFAULT_OG_IMAGE)
  })

  it('should include sameAs array for social profiles', () => {
    const result = buildOrganizationJsonLd()
    expect(Array.isArray(result.sameAs)).toBe(true)
  })

  it('should include contactPoint', () => {
    const result = buildOrganizationJsonLd()
    expect(result.contactPoint['@type']).toBe('ContactPoint')
    expect(result.contactPoint.contactType).toBe('customer service')
  })

  it('should include logo ImageObject with dimensions', () => {
    const result = buildOrganizationJsonLd()
    expect(result.logo.width).toBe(SEO.OG_IMAGE_WIDTH)
    expect(result.logo.height).toBe(SEO.OG_IMAGE_HEIGHT)
  })
})

describe('buildWebSiteJsonLd', () => {
  it('should return WebSite type with @context', () => {
    const result = buildWebSiteJsonLd()
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('WebSite')
  })

  it('should include name and url', () => {
    const result = buildWebSiteJsonLd()
    expect(result.name).toBe(SEO.BRAND_NAME)
    expect(result.url).toBe(SEO.SITE_URL)
  })

  it('should include SearchAction for sitelinks searchbox', () => {
    const result = buildWebSiteJsonLd()
    expect(result.potentialAction['@type']).toBe('SearchAction')
    expect(result.potentialAction.target).toContain(SEO.SITE_URL)
    expect(result.potentialAction['query-input']).toBe('required name=search_term_string')
  })

  it('should include inLanguage', () => {
    const result = buildWebSiteJsonLd()
    expect(result.inLanguage).toEqual(['en', 'ko'])
  })
})

describe('buildFAQJsonLd', () => {
  it('should return FAQPage type with @context', () => {
    const questions = [
      { question: 'What is SRS?', answer: 'Spaced repetition system.' },
    ]
    const result = buildFAQJsonLd(questions)!
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('FAQPage')
  })

  it('should map questions to Question/Answer schema', () => {
    const questions = [
      { question: 'What is SRS?', answer: 'Spaced repetition system.' },
      { question: 'How does it work?', answer: 'It schedules reviews at optimal intervals.' },
    ]
    const result = buildFAQJsonLd(questions)!
    expect(result.mainEntity).toHaveLength(2)
    expect(result.mainEntity[0]['@type']).toBe('Question')
    expect(result.mainEntity[0].name).toBe('What is SRS?')
    expect(result.mainEntity[0].acceptedAnswer['@type']).toBe('Answer')
    expect(result.mainEntity[0].acceptedAnswer.text).toBe('Spaced repetition system.')
  })

  it('should return null for empty questions array', () => {
    const result = buildFAQJsonLd([])
    expect(result).toBeNull()
  })
})

describe('buildHowToJsonLd', () => {
  it('should return HowTo type with @context', () => {
    const steps = [
      { name: 'Create a Deck', text: 'Create a deck to organize cards.' },
    ]
    const result = buildHowToJsonLd('How to Use ReeeeecallStudy', steps)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('HowTo')
  })

  it('should include name and steps', () => {
    const steps = [
      { name: 'Create a Deck', text: 'Create a deck to organize cards.' },
      { name: 'Study', text: 'SRS presents review cards.' },
      { name: 'Track Progress', text: 'Check learning stats.' },
    ]
    const result = buildHowToJsonLd('How to Use ReeeeecallStudy', steps)
    expect(result.name).toBe('How to Use ReeeeecallStudy')
    expect(result.step).toHaveLength(3)
    expect(result.step[0]['@type']).toBe('HowToStep')
    expect(result.step[0].name).toBe('Create a Deck')
    expect(result.step[0].text).toBe('Create a deck to organize cards.')
    expect(result.step[0].position).toBe(1)
  })

  it('should include totalTime in ISO 8601 duration', () => {
    const steps = [{ name: 'Step 1', text: 'Do something.' }]
    const result = buildHowToJsonLd('Test', steps, 'PT5M')
    expect(result.totalTime).toBe('PT5M')
  })
})

describe('buildLearningResourceJsonLd', () => {
  it('should return LearningResource type with @context', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('LearningResource')
  })

  it('should include educationalLevel and learningResourceType', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.educationalLevel).toBe('beginner')
    expect(result.learningResourceType).toBe('Article')
  })

  it('should include timeRequired in ISO 8601 duration', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.timeRequired).toBe('PT5M')
  })

  it('should include keywords from tags', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.keywords).toBe('learning, srs')
  })

  it('should include author and publisher', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.author['@type']).toBe('Organization')
    expect(result.publisher['@type']).toBe('Organization')
  })

  it('should include publisher logo ImageObject with dimensions', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.publisher.logo.width).toBe(SEO.OG_IMAGE_WIDTH)
    expect(result.publisher.logo.height).toBe(SEO.OG_IMAGE_HEIGHT)
  })

  it('should include speakable property for AEO with semantic selectors', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.speakable['@type']).toBe('SpeakableSpecification')
    expect(result.speakable.cssSelector).toContain('article h1')
    expect(result.speakable.cssSelector).toContain('article h2')
    expect(result.speakable.cssSelector).toContain('article p')
  })

  it('should include isAccessibleForFree', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.isAccessibleForFree).toBe(true)
  })

  it('should use ImageObject for image property', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.image['@type']).toBe('ImageObject')
    expect(result.image.url).toBe('https://example.com/og.jpg')
    expect(result.image.width).toBe(SEO.OG_IMAGE_WIDTH)
    expect(result.image.height).toBe(SEO.OG_IMAGE_HEIGHT)
  })

  it('should include url in author', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.author.url).toBe(SEO.SITE_URL)
  })

  it('should include url in publisher', () => {
    const result = buildLearningResourceJsonLd(mockArticle)
    expect(result.publisher.url).toBe(SEO.SITE_URL)
  })
})
