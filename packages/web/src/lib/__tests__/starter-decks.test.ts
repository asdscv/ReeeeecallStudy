/**
 * What a brand-new account gets handed on its first screen.
 *
 * Onboarding used to ask for a deck, a template and hand-typed cards before anything
 * was studiable, and the funnel showed it: of the 16 external accounts that reached
 * onboarding, 13 stopped at `createDeck` and none ever turned a card. Meanwhile 649
 * free official decks sat in the catalog that only 7 people had ever taken.
 *
 * Three traps live in picking which deck to hand over, and all three are silent:
 *
 *   1. In this catalog the BEGINNER decks are the big ones (~300 cards) and the
 *      ADVANCED ones are small (~100). Sorting by card_count to "start easy" hands a
 *      first-time learner the advanced deck.
 *   2. Every official deck teaches English, so `learning_language` is the same value
 *      on all 649 rows and discriminates nothing. `native_language` is the axis that
 *      decides whether a Korean speaker gets the Korean deck or the Spanish one.
 *   3. Decks ship as bidirectional pairs that share category, level and card_count.
 *      Grouping on those merges genuinely different decks; only the direction tag
 *      separates a pair from a pair of siblings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  easiestFirst,
  preferRecognitionDirection,
  pickStarters,
  normalizeLang,
} from '@reeeeecall/shared/lib/starter-decks'
import type { MarketplaceListing } from '@reeeeecall/shared/types/database'

const from = vi.fn()
vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
  getSupabase: () => ({ from: (...a: unknown[]) => from(...a) }),
  initSupabase: vi.fn(),
}))

const { fetchStarterDecks } = await import('@reeeeecall/shared/stores/starter-decks')

function listing(over: Partial<MarketplaceListing> & { id: string }): MarketplaceListing {
  return {
    deck_id: `deck-${over.id}`,
    owner_id: 'official-1',
    title: over.id,
    description: null,
    tags: ['official', 'source:en', 'target:ko'],
    category: 'language',
    share_mode: 'subscribe',
    card_count: 100,
    acquire_count: 0,
    view_count: 0,
    avg_rating: 0,
    review_count: 0,
    is_active: true,
    is_paid: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    learning_language: 'en',
    native_language: 'ko',
    study_level: 'beginner',
    owner_is_official: true,
    ...over,
  } as MarketplaceListing
}

/** Stands in for the query builder, recording which filters each call applied. */
function stubRest(byLang: Record<string, MarketplaceListing[]>, fallback: MarketplaceListing[] = []) {
  const queries: Record<string, unknown>[] = []
  from.mockImplementation(() => {
    const eqs: Record<string, unknown> = {}
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: () => b,
      eq: (col: string, val: unknown) => { eqs[col] = val; return b },
      order: () => b,
      limit: () => {
        queries.push({ ...eqs })
        if (!('native_language' in eqs)) return Promise.resolve({ data: fallback, error: null })
        return Promise.resolve({ data: byLang[eqs.native_language as string] ?? [], error: null })
      },
    })
    return b
  })
  return queries
}

beforeEach(() => from.mockReset())

describe('easiestFirst', () => {
  it('puts a 300-card beginner deck ahead of a 100-card advanced deck', () => {
    const beginner = listing({ id: 'beginner', study_level: 'beginner', card_count: 300 })
    const advanced = listing({ id: 'advanced', study_level: 'advanced', card_count: 100 })
    expect([advanced, beginner].sort(easiestFirst).map(d => d.id)).toEqual(['beginner', 'advanced'])
  })

  it('only uses size to break ties inside one level', () => {
    const small = listing({ id: 'small', study_level: 'beginner', card_count: 100 })
    const big = listing({ id: 'big', study_level: 'beginner', card_count: 300 })
    expect([big, small].sort(easiestFirst).map(d => d.id)).toEqual(['small', 'big'])
  })

  it('sorts an unknown level last rather than dropping it', () => {
    const known = listing({ id: 'known', study_level: 'advanced' })
    const unknown = listing({ id: 'unknown', study_level: null })
    expect([unknown, known].sort(easiestFirst).map(d => d.id)).toEqual(['known', 'unknown'])
  })
})

describe('normalizeLang', () => {
  it('reduces a regional locale to its base language', () => {
    expect(normalizeLang('ko-KR')).toBe('ko')
  })

  it('falls back to en for an empty locale', () => {
    expect(normalizeLang('')).toBe('en')
  })
})

describe('preferRecognitionDirection', () => {
  const enToKo = listing({ id: 'en-ko', tags: ['official', 'source:en', 'target:ko'] })
  const koToEn = listing({ id: 'ko-en', tags: ['official', 'source:ko', 'target:en'] })

  it('keeps one side of a bidirectional pair', () => {
    expect(preferRecognitionDirection([enToKo, koToEn], 'ko').map(d => d.id)).toEqual(['en-ko'])
  })

  it('keeps the direction that answers in the language the learner already has', () => {
    expect(preferRecognitionDirection([koToEn, enToKo], 'ko')[0].id).toBe('en-ko')
  })

  it('does not empty the list when no deck points that way', () => {
    expect(preferRecognitionDirection([koToEn], 'ko').map(d => d.id)).toEqual(['ko-en'])
  })

  it('tolerates a listing with no tags', () => {
    const untagged = listing({ id: 'untagged', tags: [] })
    expect(preferRecognitionDirection([untagged], 'ko').map(d => d.id)).toEqual(['untagged'])
  })

  // A grouping key over (category, level, card_count) would have merged these, because
  // 229 of the 649 official listings carry no batch tag to tell them apart.
  it('never merges two different decks that share category, level and size', () => {
    const t900 = listing({ id: 'toeic-900', category: 'toeic', study_level: 'advanced', card_count: 1500 })
    const t990 = listing({ id: 'toeic-990', category: 'toeic', study_level: 'advanced', card_count: 1500 })
    expect(preferRecognitionDirection([t900, t990], 'ko').map(d => d.id)).toEqual(['toeic-900', 'toeic-990'])
  })
})

describe('pickStarters', () => {
  // This is the shape production actually returned: 10탄, 2탄(영어→한국어) and
  // 2탄(한국어→영어) — one of the three choices was the same deck a second time.
  it('does not spend two of three slots on both directions of one deck', () => {
    const rows = [
      listing({ id: 'b10', card_count: 300, tags: ['source:en', 'target:ko'] }),
      listing({ id: 'b2-en-ko', card_count: 301, tags: ['source:en', 'target:ko'] }),
      listing({ id: 'b2-ko-en', card_count: 301, tags: ['source:ko', 'target:en'] }),
      listing({ id: 'b3', card_count: 302, tags: ['source:en', 'target:ko'] }),
    ]
    expect(pickStarters(rows, 'ko', 3).map(d => d.id)).toEqual(['b10', 'b2-en-ko', 'b3'])
  })

  it('respects the requested limit', () => {
    const rows = [
      listing({ id: 'a', card_count: 100 }),
      listing({ id: 'b', card_count: 200 }),
      listing({ id: 'c', card_count: 300 }),
    ]
    expect(pickStarters(rows, 'ko', 2).map(d => d.id)).toEqual(['a', 'b'])
  })
})

describe('fetchStarterDecks', () => {
  it('hands a Korean speaker the Korean decks, easiest first', async () => {
    stubRest({
      ko: [
        listing({ id: 'ko-advanced', study_level: 'advanced', card_count: 100 }),
        listing({ id: 'ko-beginner', study_level: 'beginner', card_count: 300 }),
      ],
    })
    expect((await fetchStarterDecks('ko', 3)).map(d => d.id)).toEqual(['ko-beginner', 'ko-advanced'])
  })

  it('narrows the query by native_language, not learning_language', async () => {
    const queries = stubRest({ ko: [listing({ id: 'ko-1' })] })
    await fetchStarterDecks('ko', 3)
    expect(queries[0]).toMatchObject({
      is_active: true,
      owner_is_official: true,
      is_paid: false,
      native_language: 'ko',
    })
    expect(queries[0]).not.toHaveProperty('learning_language')
  })

  it('normalizes a regional locale before querying', async () => {
    const queries = stubRest({ ko: [listing({ id: 'ko-1' })] })
    await fetchStarterDecks('ko-KR', 3)
    expect(queries[0].native_language).toBe('ko')
  })

  // Regression: the direction filter existed and was unit-tested, but nothing asserted
  // the fetch path applied it — removing the call kept every test green.
  it('applies the pair filter on the way out of the fetch', async () => {
    stubRest({
      ko: [
        listing({ id: 'b2-en-ko', card_count: 301, tags: ['source:en', 'target:ko'] }),
        listing({ id: 'b2-ko-en', card_count: 301, tags: ['source:ko', 'target:en'] }),
        listing({ id: 'b3', card_count: 302, tags: ['source:en', 'target:ko'] }),
      ],
    })
    expect((await fetchStarterDecks('ko', 3)).map(d => d.id)).toEqual(['b2-en-ko', 'b3'])
  })

  // The catalog has zero decks whose native_language is 'en' — every deck teaches
  // English *to* someone else — so an English speaker hits this path on first run.
  it('falls back to the catalog when the language has nothing', async () => {
    const queries = stubRest({}, [listing({ id: 'popular' })])
    expect((await fetchStarterDecks('en', 3)).map(d => d.id)).toEqual(['popular'])
    expect(queries).toHaveLength(2)
    expect(queries[1]).not.toHaveProperty('native_language')
  })

  it('returns empty rather than throwing when both queries come back empty', async () => {
    stubRest({}, [])
    expect(await fetchStarterDecks('en', 3)).toEqual([])
  })
})
