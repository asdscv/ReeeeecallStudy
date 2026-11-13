vi.mock('../brain-content.js', async (original) => ({ ...await original(), planBrainTopic: vi.fn().mockResolvedValue(null) }))
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
      getPlannedArticles: vi.fn().mockResolvedValue([]),
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
      getPlannedArticles: vi.fn().mockResolvedValue([]),
      uploadImage: vi.fn(),
      insertContent: vi.fn(async (record) => { inserts.push({ locale: record.locale, deck: record.deck_family, query: record.target_query }); return { ...record, id: record.locale } }),
    })
    await runContentPipeline({}, '0 6 * * *')
    expect(inserts.map((i) => i.locale).sort()).toEqual(['en', 'ja', 'ko', 'vi'])
    expect(inserts.every((i) => i.deck === 'toeic:800' && i.query === '토익 800점 단어')).toBe(true)
  })
})

describe('one topic a day, even when an edition fails', () => {
  it('does not pull in an AI-invented topic when the planned topic published one language', async () => {
    vi.clearAllMocks()
    const inserts = []
    planKeywordTopic.mockResolvedValue({
      id: 'q', category: 'c', titleHint: 'toeic part 6', keywords: ['toeic part 6'], tags: [], audience: 'a',
      targetQuery: 'toeic part 6', queryLocale: 'en', format: 'guide', deckFamily: null,
    })
    generateImage.mockRejectedValue(new Error('no image in test'))
    callAI.mockImplementation(async () => article('toeic-part-6-guide'))
    createSupabaseClient.mockReturnValue({
      getRecentContent: vi.fn().mockResolvedValue([]),
      getPlannedArticles: vi.fn().mockResolvedValue([]),
      uploadImage: vi.fn(),
      insertContent: vi.fn(async (record) => {
        if (record.locale === 'ko') throw new Error('Supabase insert failed: 500 - boom')
        inserts.push(record.locale); return { ...record, id: record.locale }
      }),
    })
    await runContentPipeline({}, '0 6 * * *')
    expect(inserts.sort()).toEqual(['en', 'ja', 'vi'])
    expect(callAI).toHaveBeenCalledTimes(4)
  })

  it('keeps the translation on the primary slug even when its title looks like a recent article', async () => {
    vi.clearAllMocks()
    const inserts = []
    planKeywordTopic.mockResolvedValue({
      id: 'q', category: 'c', titleHint: '토익 900점 단어', keywords: ['토익 900점 단어'], tags: [], audience: 'a',
      targetQuery: '토익 900점 단어', queryLocale: 'ko', format: 'guide', deckFamily: 'toeic:900',
    })
    generateImage.mockRejectedValue(new Error('no image in test'))
    callAI.mockImplementation(async () => ({ ...article('toeic-900-vocabulary'), title: '토익 900점 단어 완전 정복 가이드', tags: ['toeic'] }))
    createSupabaseClient.mockReturnValue({
      getRecentContent: vi.fn().mockResolvedValue([{ slug: 'toeic-800-vocabulary', locale: 'ko', title: '토익 800점 단어 완전 정복 가이드', tags: ['toeic'] }]),
      getPlannedArticles: vi.fn().mockResolvedValue([]),
      uploadImage: vi.fn(),
      insertContent: vi.fn(async (record) => { inserts.push({ locale: record.locale, slug: record.slug }); return { ...record, id: record.locale } }),
    })
    await runContentPipeline({}, '0 6 * * *')
    const slugs = new Set(inserts.map((i) => i.slug))
    expect(slugs.size).toBe(1)
  })
})

describe('deck guide prompt carries the deck words', () => {
  it('gives each edition its own deck\'s meanings, and the English edition the words without meanings', async () => {
    vi.clearAllMocks()
    planKeywordTopic.mockResolvedValue(null)
    planDeckTopic.mockResolvedValue({
      id: 'toeic-800', category: 'c', titleHint: '토익 800점 단어', keywords: ['토익 800점 단어'], tags: [], audience: 'a',
      targetQuery: '토익 800점 단어', queryLocale: 'ko', format: 'guide', deckFamily: 'toeic:800',
    })
    generateImage.mockRejectedValue(new Error('no image in test'))
    callAI.mockImplementation(async () => article('toeic-800-vocabulary'))
    const meaning = { ko: '판결하다', ja: '裁定する', vi: 'phân xử' }
    // There is no English deck: the real lookup returns no words for 'en'.
    const getOfficialDeckWords = vi.fn(async (_family, locale) => (meaning[locale]
      ? [{ term: 'adjudicate', meaning: meaning[locale], example: 'The committee will adjudicate.', exampleNote: '' }]
      : []))
    createSupabaseClient.mockReturnValue({
      getRecentContent: vi.fn().mockResolvedValue([]),
      getPlannedArticles: vi.fn().mockResolvedValue([]),
      getOfficialDeckWords,
      uploadImage: vi.fn(),
      insertContent: vi.fn(async (record) => ({ ...record, id: record.locale })),
    })
    await runContentPipeline({}, '0 6 * * *')
    expect(getOfficialDeckWords).toHaveBeenCalledTimes(4) // once per edition, once per topic
    const prompts = callAI.mock.calls.map((c) => c[2])
    const promptIn = (marker) => prompts.find((p) => p.includes(marker))
    expect(prompts).toHaveLength(4)
    expect(prompts.every((p) => p.includes('- adjudicate'))).toBe(true)
    expect(promptIn('Korean (한국어)')).toContain('- adjudicate — 판결하다')
    expect(promptIn('Japanese (日本語)')).toContain('- adjudicate — 裁定する')
    expect(promptIn('Vietnamese (Tiếng Việt)')).toContain('- adjudicate — phân xử')
    const en = promptIn('Write the entire article in English')
    expect(en).toContain('- adjudicate — The committee will adjudicate.')
    expect(en).not.toMatch(/판결하다|裁定する|phân xử/)
  })
})
