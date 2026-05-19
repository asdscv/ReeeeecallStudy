import { describe, it, expect } from 'vitest'
import { buildArticleJsonLd, buildLearningResourceJsonLd } from '../seo/json-ld.js'
import { SITE_URL } from '../seo/constants.js'

const SLUG = 'toefl-skimming-techniques-academic-passages'

function makeArticle(locale = 'en') {
  return {
    title: 'Skim Smarter for TOEFL Academic Passages',
    meta_title: 'TOEFL Skimming Techniques | ReeeeecallStudy',
    meta_description: 'Practical skimming methods.',
    subtitle: 'Subtitle',
    thumbnail_url: 'https://example.com/img.jpg',
    tags: ['toefl-reading', 'skimming-tips'],
    reading_time_minutes: 5,
    locale,
    published_at: '2026-05-18T06:04:04.836+00:00',
    updated_at: '2026-05-18T06:04:05.015655+00:00',
    author_name: 'ReeeeecallStudy',
  }
}

describe('buildArticleJsonLd mainEntityOfPage @id', () => {
  it('uses the slug, not the title, for the canonical @id (en)', () => {
    const json = buildArticleJsonLd(makeArticle('en'), SLUG)
    expect(json.mainEntityOfPage['@id']).toBe(`${SITE_URL}/insight/${SLUG}`)
    expect(json.mainEntityOfPage['@id']).not.toContain('|')
    expect(json.mainEntityOfPage['@id']).not.toContain('TOEFL')
  })

  it('appends ?lang= for non-en locales', () => {
    const json = buildArticleJsonLd(makeArticle('ko'), SLUG)
    expect(json.mainEntityOfPage['@id']).toBe(`${SITE_URL}/insight/${SLUG}?lang=ko`)
  })
})

describe('buildLearningResourceJsonLd mainEntityOfPage @id', () => {
  it('uses the slug, not the title, for the canonical @id (en)', () => {
    const json = buildLearningResourceJsonLd(makeArticle('en'), SLUG)
    expect(json.mainEntityOfPage['@id']).toBe(`${SITE_URL}/insight/${SLUG}`)
  })

  it('appends ?lang= for non-en locales', () => {
    const json = buildLearningResourceJsonLd(makeArticle('ja'), SLUG)
    expect(json.mainEntityOfPage['@id']).toBe(`${SITE_URL}/insight/${SLUG}?lang=ja`)
  })
})
