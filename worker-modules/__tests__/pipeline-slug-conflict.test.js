import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../logger.js', () => ({ createLogger: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../indexnow.js', () => ({ submitToIndexNow: vi.fn() }))
vi.mock('../keyword-planner.js', () => ({ planKeywordTopic: vi.fn(), planDeckTopic: vi.fn() }))
vi.mock('../ai-client.js', () => ({ callAI: vi.fn(), generateImage: vi.fn() }))
vi.mock('../supabase-client.js', () => ({ createSupabaseClient: vi.fn() }))

import { runContentPipeline } from '../content-pipeline.js'
import { planKeywordTopic, planDeckTopic } from '../keyword-planner.js'
import { callAI, generateImage } from '../ai-client.js'
import { createSupabaseClient } from '../supabase-client.js'

const article = (slug) => ({
  title: 'JLPT N2 grammar guide', subtitle: 's', slug, reading_time_minutes: 8, tags: ['jlpt'],
  meta_title: 'JLPT N2 grammar', meta_description: 'A guide to JLPT N2 grammar patterns for learners.',
  content_blocks: [
    { type: 'hero', props: { title: 'JLPT N2 grammar' } },
    ...Array.from({ length: 6 }, (_, i) => ({ type: 'paragraph', props: { text: `Paragraph ${i}` } })),
    { type: 'cta', props: { title: 'Start', description: 'd', buttonText: 'Go', buttonUrl: '/auth/login' } },
  ],
})

describe('pipeline insert when an older row owns the slug', () => {
  let inserts

  beforeEach(() => {
    vi.clearAllMocks()
    inserts = []
    planKeywordTopic.mockResolvedValue({
      id: 'jlpt-n2', category: 'c', titleHint: 'jlpt n2 문법', keywords: ['jlpt n2 문법'], tags: [], audience: 'a',
      targetQuery: 'jlpt n2 문법', queryLocale: 'ko', format: 'guide',
    })
    generateImage.mockRejectedValue(new Error('no image in test'))
    callAI.mockImplementation(async () => article('jlpt-n2-grammar-guide'))
    createSupabaseClient.mockReturnValue({
      getRecentContent: vi.fn().mockResolvedValue([]),
      getTargetedQueries: vi.fn().mockResolvedValue([]),
      uploadImage: vi.fn(),
      insertContent: vi.fn(async (record) => {
        inserts.push({ slug: record.slug, locale: record.locale, canonical: record.canonical_url, deck: record.deck_family, query: record.target_query })
        if (record.slug === 'jlpt-n2-grammar-guide' && record.locale === 'en') {
          throw new Error('Supabase insert failed: 409 - duplicate key value violates unique constraint "idx_contents_slug_locale"')
        }
        return { ...record, id: `id-${record.locale}` }
      }),
    })
  })

  it('retries with a date suffix and keeps the other locale on the same slug', async () => {
    await runContentPipeline({}, '0 6 * * *')
    const en = inserts.filter((i) => i.locale === 'en')
    const ko = inserts.filter((i) => i.locale === 'ko')
    expect(en).toHaveLength(2)
    expect(en[1].slug).toMatch(/^jlpt-n2-grammar-guide-\d{8}$/)
    expect(en[1].canonical).toContain(en[1].slug)
    expect(ko.at(-1).slug).toBe(en[1].slug)
  })
})

describe('pipeline falls back to a deck guide when Search Console has nothing', () => {
  it('writes the deck guide and stores its family on every locale', async () => {
    vi.clearAllMocks()
    const inserts = []
    planKeywordTopic.mockResolvedValue(null)
    planDeckTopic.mockResolvedValue({
      id: 'toeic-800', category: 'c', titleHint: '토익 800점 단어', keywords: ['토익 800점 단어'], tags: [], audience: 'a',
      targetQuery: '토익 800점 단어', queryLocale: 'ko', format: 'guide', deckFamily: 'toeic:800',
    })
    generateImage.mockRejectedValue(new Error('no image in test'))
    callAI.mockImplementation(async () => article('toeic-800-vocabulary'))
    createSupabaseClient.mockReturnValue({
      getRecentContent: vi.fn().mockResolvedValue([]),
      getTargetedQueries: vi.fn().mockResolvedValue([]),
      uploadImage: vi.fn(),
      insertContent: vi.fn(async (record) => { inserts.push({ locale: record.locale, deck: record.deck_family, query: record.target_query }); return { ...record, id: record.locale } }),
    })
    await runContentPipeline({}, '0 6 * * *')
    expect(inserts).toEqual([
      { locale: 'en', deck: 'toeic:800', query: '토익 800점 단어' },
      { locale: 'ko', deck: 'toeic:800', query: '토익 800점 단어' },
    ])
  })
})
