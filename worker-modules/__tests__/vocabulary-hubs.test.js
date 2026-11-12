import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleVocabularyBot } from '../seo/handlers/vocabulary.js'
import { handleContentDetailBot } from '../seo/handlers/content-detail.js'
import { matchBotRoute } from '../seo/page-registry.js'

const env = { SUPABASE_ANON_KEY: 'anon', SUPABASE_URL: 'https://x.supabase.co' }
const at = (path) => new URL(`https://reeeeecallstudy.xyz${path}`)

const card = (i) => ({ field_values: { kind: 'word', front: `word${i}`, back: `뜻${i}`, example_front: `Example ${i} <b>.`, example_back: `예문 ${i}` } })
const deck = (lang, over = {}) => ({
  id: `deck-${lang}`, title: `TOEIC 800 (English → ${lang})`, category: 'toeic', card_count: 1500,
  tags: ['official', 'category:toeic', 'source:en', `target:${lang}`, 'level:800'],
  owner_is_official: true, native_language: lang, ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('/vocabulary routes', () => {
  it('matches the index, a language and a hub, nothing deeper', () => {
    expect(matchBotRoute('/vocabulary')).toEqual({ type: 'vocabulary', params: { slug: null } })
    expect(matchBotRoute('/vocabulary/ko')).toEqual({ type: 'vocabulary', params: { slug: 'ko' } })
    expect(matchBotRoute('/vocabulary/toeic-800/')).toEqual({ type: 'vocabulary', params: { slug: 'toeic-800' } })
    expect(matchBotRoute('/vocabulary/toeic-800/x')?.type).not.toBe('vocabulary')
  })

  it('returns nothing for an unknown slug', async () => {
    expect(await handleVocabularyBot('toeic-999', at('/vocabulary/toeic-999'), env)).toBeNull()
  })
})

describe('English index', () => {
  it('links every exam hub and every language index, clustered with the language indexes', async () => {
    const html = await (await handleVocabularyBot(null, at('/vocabulary'), env)).text()
    expect(html).toMatch(/<html lang="en"/)
    expect(html).toContain('<link rel="canonical" href="https://reeeeecallstudy.xyz/vocabulary">')
    expect(html.match(/href="https:\/\/reeeeecallstudy\.xyz\/vocabulary\/(toeic|ielts|toefl)-[^"]+"/g)).toHaveLength(15)
    expect(html).toContain('hreflang="ko" href="https://reeeeecallstudy.xyz/vocabulary/ko"')
    expect(html).toContain('hreflang="x-default" href="https://reeeeecallstudy.xyz/vocabulary"')
  })
})

describe('language index', () => {
  it('lists the official decks of that language as word-list links, grouped and in level order', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => [
      deck('ko', { id: 'd900', tags: ['category:toeic', 'source:en', 'target:ko', 'level:900'] }),
      deck('ko', { id: 'd800' }),
      deck('ko', { id: 'dconv', category: 'conversation', tags: ['category:conversation', 'source:ko', 'target:en', 'level:여행'] }),
    ] }))
    vi.stubGlobal('fetch', fetch)
    const html = await (await handleVocabularyBot('ko', at('/vocabulary/ko'), env)).text()

    expect(fetch.mock.calls[0][0]).toContain('native_language=eq.ko')
    expect(html).toMatch(/<html lang="ko"/)
    expect(html).toContain('<link rel="canonical" href="https://reeeeecallstudy.xyz/vocabulary/ko">')
    expect(html).toContain('토익 800점 단어 1,500개')
    expect(html.indexOf('/d/d800')).toBeLessThan(html.indexOf('/d/d900'))
    expect(html.indexOf('/d/d900')).toBeLessThan(html.indexOf('/d/dconv'))
  })

  it('returns nothing when the language has no decks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })))
    expect(await handleVocabularyBot('th', at('/vocabulary/th'), env)).toBeNull()
  })
})

describe('exam hub', () => {
  it('shows the English words with examples and links each language deck as its hreflang alternate', async () => {
    const fetch = vi.fn(async (u) => {
      if (u.includes('/rpc/')) {
        return { ok: true, json: async () => ({ ...deck('ko'), sample_fields: Array.from({ length: 50 }, (_, i) => card(i)) }) }
      }
      return { ok: true, json: async () => [deck('ja'), deck('ko'), deck('vi')] }
    })
    vi.stubGlobal('fetch', fetch)
    const html = await (await handleVocabularyBot('toeic-800', at('/vocabulary/toeic-800'), env)).text()

    expect(decodeURIComponent(fetch.mock.calls[0][0])).toContain('category=eq.toeic&tags=cs.{level:800,source:en}')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ p_listing_id: 'deck-ko' })
    expect(html).toContain('<h1>TOEIC 800 Vocabulary List — 1,500 Words with Example Sentences</h1>')
    expect(html).toContain('<link rel="canonical" href="https://reeeeecallstudy.xyz/vocabulary/toeic-800">')
    expect(html).toContain('<link rel="alternate" hreflang="ja" href="https://reeeeecallstudy.xyz/d/deck-ja">')
    expect(html).toContain('<link rel="alternate" hreflang="en" href="https://reeeeecallstudy.xyz/vocabulary/toeic-800">')
    expect((html.match(/<tr><td><strong>/g) || []).length).toBe(50)
    expect(html).toContain('Example 0 &lt;b&gt;.')
    expect(html).not.toContain('뜻0')
  })
})

const p = (text) => ({ type: 'paragraph', props: { text } })
const h = (text) => ({ type: 'heading', props: { level: 2, text } })
const article = (locale) => ({
  slug: 'toeic-800-words', locale, deck_family: 'toeic:800',
  title: 'TOEIC 800', meta_title: 'TOEIC 800', meta_description: 'd',
  content_blocks: [
    { type: 'hero', props: { title: 'TOEIC 800' } }, p('Intro.'),
    h('A'), p('The answer.'), p('More.'), h('B'), p('Traps.'), h('C'), p('Wrap.'),
  ],
  tags: ['toeic'], reading_time_minutes: 5, author_name: 'ReeeeecallStudy',
  published_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
})

function stubArticle(a, decks) {
  const fetch = vi.fn(async (u) => {
    if (u.includes('marketplace_listings')) return { ok: true, json: async () => decks }
    if (u.includes('neq')) return { ok: true, json: async () => [] }
    if (u.includes('select=locale')) return { ok: true, json: async () => [{ locale: a.locale }] }
    return { ok: true, json: async () => [a] }
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('crawler article HTML links into the word lists', () => {
  it('a Korean deck-guide article links its Korean deck and the Korean index', async () => {
    const fetch = stubArticle(article('ko'), [deck('ko')])
    const html = await (await handleContentDetailBot('toeic-800-words', at('/insight/toeic-800-words?lang=ko'), env)).text()
    const lookup = decodeURIComponent(fetch.mock.calls.find(([u]) => u.includes('marketplace_listings'))[0])
    expect(lookup).toContain('category=eq.toeic&tags=cs.{level:800,source:en,target:ko}')
    expect(html).toContain('<aside><a href="https://reeeeecallstudy.xyz/d/deck-ko">토익 800점 단어 1,500개')
    expect(html).toContain('href="https://reeeeecallstudy.xyz/vocabulary/ko"')
  })

  it('the English edition links the English hub — there is no English deck', async () => {
    const fetch = stubArticle(article('en'), [])
    const html = await (await handleContentDetailBot('toeic-800-words', at('/insight/toeic-800-words'), env)).text()
    expect(fetch.mock.calls.some(([u]) => u.includes('marketplace_listings'))).toBe(false)
    expect(html).toContain('<aside><a href="https://reeeeecallstudy.xyz/vocabulary/toeic-800">TOEIC 800 Vocabulary List</a>')
    expect(html).toContain('href="https://reeeeecallstudy.xyz/vocabulary"')
  })
})
