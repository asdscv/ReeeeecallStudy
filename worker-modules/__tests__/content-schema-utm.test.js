import { describe, it, expect } from 'vitest'
import { validateArticle, enrichCtaUrls } from '../content-schema.js'

function makeValidArticle(overrides = {}) {
  return {
    title: 'Test Article',
    subtitle: 'A subtitle',
    slug: 'test-article-slug',
    reading_time_minutes: 5,
    tags: ['study', 'srs'],
    meta_title: 'Test Article',
    meta_description: 'A test article about studying with spaced repetition techniques.',
    content_blocks: [
      { type: 'hero', props: { title: 'Hero Title', subtitle: 'Hero Sub' } },
      { type: 'paragraph', props: { text: 'Some paragraph text here.' } },
      { type: 'heading', props: { level: 2, text: 'Section Heading' } },
      { type: 'paragraph', props: { text: 'More text.' } },
      { type: 'paragraph', props: { text: 'Even more text.' } },
      { type: 'paragraph', props: { text: 'Last paragraph.' } },
      {
        type: 'cta',
        props: {
          title: 'Get Started',
          description: 'Start learning today.',
          buttonText: 'Sign Up',
          buttonUrl: '/auth/login',
        },
      },
    ],
    ...overrides,
  }
}

describe('enrichCtaUrls', () => {
  it('adds UTM params to CTA buttonUrl', () => {
    const article = makeValidArticle()
    const validation = validateArticle(article)
    expect(validation.valid).toBe(true)

    enrichCtaUrls(article, 'en')

    const ctaBlock = article.content_blocks.find((b) => b.type === 'cta')
    expect(ctaBlock.props.buttonUrl).toContain('utm_source=blog')
    expect(ctaBlock.props.buttonUrl).toContain('utm_medium=cta')
    expect(ctaBlock.props.buttonUrl).toContain('utm_campaign=test-article-slug')
    expect(ctaBlock.props.buttonUrl).toContain('utm_content=cta_en')
  })

  it('uses correct locale in utm_content for Korean', () => {
    const article = makeValidArticle()
    validateArticle(article)
    enrichCtaUrls(article, 'ko')

    const ctaBlock = article.content_blocks.find((b) => b.type === 'cta')
    expect(ctaBlock.props.buttonUrl).toContain('utm_content=cta_ko')
  })

  it('preserves /auth/login base path', () => {
    const article = makeValidArticle()
    validateArticle(article)
    enrichCtaUrls(article, 'en')

    const ctaBlock = article.content_blocks.find((b) => b.type === 'cta')
    expect(ctaBlock.props.buttonUrl).toMatch(/^\/auth\/login\?/)
  })

  it('handles article with no CTA block gracefully', () => {
    const article = makeValidArticle({
      content_blocks: [
        { type: 'hero', props: { title: 'Title' } },
        { type: 'paragraph', props: { text: 'Text.' } },
        { type: 'paragraph', props: { text: 'Text2.' } },
        { type: 'paragraph', props: { text: 'Text3.' } },
        { type: 'paragraph', props: { text: 'Text4.' } },
        { type: 'paragraph', props: { text: 'Text5.' } },
        { type: 'cta', props: { title: 'CTA', description: 'Desc', buttonText: 'Go', buttonUrl: '/auth/login' } },
      ],
    })
    validateArticle(article)
    // Should not throw
    enrichCtaUrls(article, 'en')
  })

  it('handles null/undefined article gracefully', () => {
    expect(() => enrichCtaUrls(null, 'en')).not.toThrow()
    expect(() => enrichCtaUrls(undefined, 'en')).not.toThrow()
    expect(() => enrichCtaUrls({}, 'en')).not.toThrow()
  })

  it('handles article with missing slug gracefully', () => {
    const article = makeValidArticle({ slug: undefined })
    expect(() => enrichCtaUrls(article, 'en')).not.toThrow()
  })

  it('produces valid URL that can be parsed', () => {
    const article = makeValidArticle()
    validateArticle(article)
    enrichCtaUrls(article, 'en')

    const ctaBlock = article.content_blocks.find((b) => b.type === 'cta')
    const url = ctaBlock.props.buttonUrl
    const [path, query] = url.split('?')
    expect(path).toBe('/auth/login')

    const params = new URLSearchParams(query)
    expect(params.get('utm_source')).toBe('blog')
    expect(params.get('utm_medium')).toBe('cta')
    expect(params.get('utm_campaign')).toBe('test-article-slug')
    expect(params.get('utm_content')).toBe('cta_en')
  })
})
