import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleListingBotRequest } from '../seo/handlers/listing.js'

const env = { SUPABASE_ANON_KEY: 'anon', SUPABASE_URL: 'https://x.supabase.co' }

const card = (i) => ({ field_values: { kind: 'word', front: `word${i}`, back: `뜻${i}`, example_front: `Example ${i} <b>.`, example_back: `예문 ${i}` } })

function official(over = {}) {
  return {
    id: 'deck-ko', title: 'TOEIC 800 어휘 (영어 → 한국어)', description: '공식 덱', category: 'toeic', card_count: 1500,
    tags: ['official', 'category:toeic', 'source:en', 'target:ko', 'level:800'], owner_name: 'ReeeeecallStudy Official',
    owner_is_official: true, native_language: 'ko', created_at: '2026-05-01T00:00:00Z',
    siblings: [{ id: 'deck-ja', native_language: 'ja' }, { id: 'deck-vi', native_language: 'vi' }],
    sample_fields: Array.from({ length: 50 }, (_, i) => card(i)),
    ...over,
  }
}

function stubPreview(listing) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => listing })))
}

afterEach(() => vi.unstubAllGlobals())

describe('official deck page = word list in the deck language', () => {
  it('serves the search-phrase heading, one canonical URL, the language cluster and 50 rows', async () => {
    stubPreview(official())
    const res = await handleListingBotRequest('deck-ko', new URL('https://reeeeecallstudy.xyz/d/deck-ko?lang=en'), env)
    const html = await res.text()

    expect(html).toMatch(/<html lang="ko"/)
    expect(html).toContain('<title>토익 800점 단어 1,500개 — 뜻·예문 (영어 → 한국어) | ReeeeecallStudy</title>')
    expect(html).toContain('<h1>토익 800점 단어 1,500개 — 뜻·예문 (영어 → 한국어)</h1>')
    expect(html).toContain('<link rel="canonical" href="https://reeeeecallstudy.xyz/d/deck-ko">')
    expect(html).toContain('hreflang="ko" href="https://reeeeecallstudy.xyz/d/deck-ko"')
    expect(html).toContain('hreflang="ja" href="https://reeeeecallstudy.xyz/d/deck-ja"')
    expect(html).not.toContain('?lang=')
    expect((html.match(/<tr><td lang="en">/g) || []).length).toBe(50)
    expect(html).toContain('나머지 1,450개는 간격 반복으로 학습하기')
    expect(html).toContain('redirect=%2Fmarketplace%2Fdeck-ko')
  })

  it('escapes card text', async () => {
    stubPreview(official())
    const html = await (await handleListingBotRequest('deck-ko', new URL('https://reeeeecallstudy.xyz/d/deck-ko'), env)).text()
    expect(html).toContain('Example 0 &lt;b&gt;.')
    expect(html).not.toContain('Example 0 <b>.')
  })

  it('keeps the old layout for decks published by users', async () => {
    stubPreview(official({ owner_is_official: false, native_language: null, siblings: [] , sample_fields: [card(1)] }))
    const html = await (await handleListingBotRequest('deck-ko', new URL('https://reeeeecallstudy.xyz/d/deck-ko'), env)).text()
    expect(html).toContain('Flashcard Deck')
    expect(html).not.toContain('간격 반복으로 학습하기')
  })
})
