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
  taughtLanguages,
  normalizeLang,
} from '@reeeeecall/shared/lib/starter-decks'
import type { MarketplaceListing } from '@reeeeecall/shared/types/database'

const from = vi.fn()
const rpc = vi.fn()
const getUser = vi.fn()
const client = {
  from: (...a: unknown[]) => from(...a),
  rpc: (...a: unknown[]) => rpc(...a),
  auth: { getUser: () => getUser() },
}
vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: client,
  getSupabase: () => client,
  initSupabase: vi.fn(),
}))

const { fetchStarterDecks, ensureStarterSubscriptions } =
  await import('@reeeeecall/shared/stores/starter-decks')

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
      contains: (col: string, val: unknown) => { eqs[col] = val; return b },
      order: () => b,
      limit: () => {
        queries.push({ ...eqs })
        const langs = eqs.native_languages as string[] | undefined
        if (!langs) return Promise.resolve({ data: fallback, error: null })
        return Promise.resolve({ data: byLang[langs[0]] ?? [], error: null })
      },
    })
    return b
  })
  return queries
}

beforeEach(() => {
  from.mockReset(); rpc.mockReset(); getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  rpc.mockResolvedValue({ data: null, error: null })
})

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

/**
 * An English speaker is the one audience with a choice to make.
 *
 * Every audience the catalog was built for has exactly one counterpart — a Korean
 * speaker's decks all teach English. An English speaker's decks teach seven different
 * languages, and nothing about a fresh signup says which one they came for.
 */
describe('a viewer whose decks span several languages', () => {
  const en = (id: string, taught: string, cards: number) =>
    listing({ id, card_count: cards, native_language: taught, tags: [`source:${taught}`, 'target:en'] })

  it('counts one taught language for the audience the catalog was built for', () => {
    const rows = [listing({ id: 'a' }), listing({ id: 'b' })]   // source:en target:ko
    expect(taughtLanguages(rows, 'ko')).toEqual(['en'])
  })

  it('counts every counterpart for an English speaker', () => {
    expect(taughtLanguages([en('k', 'ko', 300), en('j', 'ja', 301)], 'en')).toEqual(['ja', 'ko'])
  })

  // Three rows reading Korean / Japanese / Spanish are a language choice. Three batches
  // of whichever language sorted first is a decision made for them.
  it('leads with one deck per language instead of three batches of one', () => {
    const rows = [
      en('ko-1', 'ko', 300), en('ko-2', 'ko', 301), en('ko-3', 'ko', 302),
      en('ja-1', 'ja', 303), en('es-1', 'es', 304),
    ]
    expect(pickStarters(rows, 'en', 3).map(d => d.id)).toEqual(['ko-1', 'ja-1', 'es-1'])
  })

  it('tops up from the ranked pool when there are fewer languages than slots', () => {
    const rows = [en('ko-1', 'ko', 300), en('ko-2', 'ko', 301), en('ja-1', 'ja', 302)]
    expect(pickStarters(rows, 'en', 3).map(d => d.id)).toEqual(['ko-1', 'ja-1', 'ko-2'])
  })

  it('leaves the single-language case exactly as it was', () => {
    const rows = [
      listing({ id: 'a', card_count: 300 }),
      listing({ id: 'b', card_count: 301 }),
      listing({ id: 'c', card_count: 302 }),
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

  it('narrows the query by mother tongue, not learning_language', async () => {
    const queries = stubRest({ ko: [listing({ id: 'ko-1' })] })
    await fetchStarterDecks('ko', 3)
    expect(queries[0]).toMatchObject({
      is_active: true,
      owner_is_official: true,
      is_paid: false,
      native_languages: ['ko'],
    })
    expect(queries[0]).not.toHaveProperty('learning_language')
    // The singular column only ever held the non-English side, so an English speaker
    // matched nothing. Both audiences live in the array (migration 281).
    expect(queries[0]).not.toHaveProperty('native_language')
  })

  it('normalizes a regional locale before querying', async () => {
    const queries = stubRest({ ko: [listing({ id: 'ko-1' })] })
    await fetchStarterDecks('ko-KR', 3)
    expect(queries[0].native_languages).toEqual(['ko'])
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
    expect(queries[1]).not.toHaveProperty('native_languages')
  })

  it('returns empty rather than throwing when both queries come back empty', async () => {
    stubRest({}, [])
    expect(await fetchStarterDecks('en', 3)).toEqual([])
  })
})

/**
 * Furnishing an empty account.
 *
 * A first screen reading "no decks yet" with nothing to do but author cards is where 13
 * of 16 accounts stopped. This hands over a small shelf instead — but it must never
 * touch an account that already chose something, and it runs on every launch, so the
 * guard is the whole design.
 */
describe('ensureStarterSubscriptions', () => {
  /** Routes the four table reads the function makes. */
  function stubAccount(opts: {
    decks?: unknown[]; shares?: unknown[]; progress?: unknown[]; catalog?: MarketplaceListing[]
  }) {
    from.mockImplementation((table: string) => {
      const rowsFor = (t: string) =>
        t === 'decks' ? (opts.decks ?? [])
        : t === 'deck_shares' ? (opts.shares ?? [])
        : (opts.progress ?? [])
      if (table === 'decks' || table === 'deck_shares' || table === 'user_card_progress') {
        const b: Record<string, unknown> = {}
        Object.assign(b, {
          select: () => b, eq: () => b,
          limit: () => Promise.resolve({ data: rowsFor(table), error: null }),
        })
        return b
      }
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b, eq: () => b, contains: () => b, order: () => b,
        limit: () => Promise.resolve({ data: opts.catalog ?? [], error: null }),
      })
      return b
    })
  }

  const catalog = [
    listing({ id: 'a', card_count: 300 }),
    listing({ id: 'b', card_count: 301 }),
    listing({ id: 'c', card_count: 302 }),
  ]

  it('subscribes the ranked starters for an empty account', async () => {
    stubAccount({ catalog })
    expect(await ensureStarterSubscriptions('ko', 3)).toBe(3)
    expect(rpc.mock.calls.map((c) => c[1].p_listing_id).sort()).toEqual(['a', 'b', 'c'])
  })

  // Production: the first launch subscribed one deck and the tab closed before the rest
  // of the sequential calls landed. A has-anything guard freezes that account at one
  // deck forever, so a half-filled shelf has to be repairable.
  it('repairs a shelf that a closed tab left half-filled', async () => {
    stubAccount({ shares: [{ id: 's1' }], catalog })
    expect(await ensureStarterSubscriptions('ko', 3)).toBe(3)
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  it('sends the acquires together rather than one after another', async () => {
    stubAccount({ catalog })
    let inFlight = 0, peak = 0
    rpc.mockImplementation(() => {
      inFlight++; peak = Math.max(peak, inFlight)
      return Promise.resolve({ data: null, error: null }).finally(() => { inFlight-- })
    })
    await ensureStarterSubscriptions('ko', 3)
    expect(peak).toBeGreaterThan(1)
  })

  it('leaves an account that authored a deck of its own alone', async () => {
    stubAccount({ decks: [{ id: 'd1' }], catalog })
    expect(await ensureStarterSubscriptions('ko', 3)).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('leaves a full shelf alone', async () => {
    stubAccount({ shares: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], catalog })
    expect(await ensureStarterSubscriptions('ko', 3)).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  // Someone who has begun studying has made their choices; do not top them back up.
  it('leaves an account that has started studying alone', async () => {
    stubAccount({ shares: [{ id: 's1' }], progress: [{ card_id: 'c1' }], catalog })
    expect(await ensureStarterSubscriptions('ko', 3)).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does nothing when nobody is signed in', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    stubAccount({ catalog })
    expect(await ensureStarterSubscriptions('ko', 3)).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps going when a single acquire is refused', async () => {
    stubAccount({ catalog })
    rpc.mockResolvedValueOnce({ data: null, error: new Error('card limit') })
       .mockResolvedValue({ data: null, error: null })
    expect(await ensureStarterSubscriptions('ko', 3)).toBe(2)
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  // Filling an English speaker's account with five languages is worse than leaving it
  // empty — the picker can ask, an auto-subscribe cannot.
  it('subscribes nothing when it cannot tell which language they came for', async () => {
    stubAccount({ catalog: [
      listing({ id: 'ko-1', card_count: 300, tags: ['source:ko', 'target:en'] }),
      listing({ id: 'ja-1', card_count: 301, tags: ['source:ja', 'target:en'] }),
    ] })
    expect(await ensureStarterSubscriptions('en', 5)).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('still furnishes an audience with exactly one counterpart language', async () => {
    stubAccount({ catalog: [listing({ id: 'a', card_count: 300 }), listing({ id: 'b', card_count: 301 })] })
    expect(await ensureStarterSubscriptions('ko', 5)).toBe(2)
  })

  it('reports nothing added when the catalog comes back empty', async () => {
    stubAccount({ catalog: [] })
    expect(await ensureStarterSubscriptions('ko', 3)).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })
})
