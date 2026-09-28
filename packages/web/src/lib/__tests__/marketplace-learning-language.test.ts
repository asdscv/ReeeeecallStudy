/**
 * "I want to learn Korean" has to find the Korean decks.
 *
 * It found nothing. Official decks are `en↔X` pairs shipped in both directions, and the
 * importer wrote `learning_language = 'en'` on all 649 of them, because it treated the
 * non-English speaker as the only audience. So the marketplace's learning-language
 * filter — which compared that scalar — returned zero for an English speaker, while 327
 * decks with Korean, Japanese, Thai and Spanish on the front sat in the catalog.
 *
 * What a deck teaches depends on who is asking. A `ko → en` deck teaches English to a
 * Korean speaker and Korean to an English speaker; it is the same rows either way.
 */
import { describe, it, expect } from 'vitest'
import { filterListings, getLearningLanguages } from '@reeeeecall/shared/lib/marketplace'
import type { MarketplaceListingData } from '@reeeeecall/shared/lib/marketplace'

function deck(over: Partial<MarketplaceListingData> & { id: string }): MarketplaceListingData {
  return {
    deck_id: `d-${over.id}`,
    owner_id: 'official',
    title: over.id,
    description: null,
    tags: ['official', 'source:ko', 'target:en'],
    category: 'language',
    share_mode: 'subscribe',
    card_count: 300,
    acquire_count: 0,
    view_count: 0,
    avg_rating: 0,
    review_count: 0,
    is_active: true,
    is_paid: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    // What migration 281 writes: the deck's language pair, both audiences.
    native_languages: ['en', 'ko'],
    native_language: 'ko',
    learning_language: 'en',
    study_level: 'beginner',
    owner_is_official: true,
    ...over,
  } as MarketplaceListingData
}

describe('getLearningLanguages', () => {
  it('reports both sides of a pair, not just the recorded scalar', () => {
    expect(getLearningLanguages(deck({ id: 'ko-en' })).sort()).toEqual(['en', 'ko'])
  })

  it('falls back to the scalar for a deck that only ever named one side', () => {
    const oneSided = deck({ id: 'solo', native_languages: ['ko'], learning_language: 'en' })
    expect(getLearningLanguages(oneSided)).toEqual(['en'])
  })

  it('returns nothing rather than guessing when there is neither', () => {
    const bare = deck({ id: 'bare', native_languages: [], native_language: null, tags: [], learning_language: null })
    expect(getLearningLanguages(bare)).toEqual([])
  })
})

describe('the learning-language filter', () => {
  const catalog = [deck({ id: 'ko-en' })]

  // The defect, stated as a test: this returned [] because the stored scalar said 'en'.
  it('finds the Korean decks for someone who wants to learn Korean', () => {
    const found = filterListings(catalog, { nativeLanguages: ['en'], learningLanguage: 'ko' })
    expect(found.map((d) => d.id)).toEqual(['ko-en'])
  })

  it('still finds the same rows for the audience they were labelled for', () => {
    const found = filterListings(catalog, { nativeLanguages: ['ko'], learningLanguage: 'en' })
    expect(found.map((d) => d.id)).toEqual(['ko-en'])
  })

  // Nobody learns the language they already speak.
  it('refuses to offer a Korean speaker a deck for learning Korean', () => {
    expect(filterListings(catalog, { nativeLanguages: ['ko'], learningLanguage: 'ko' })).toEqual([])
  })

  it('refuses to offer an English speaker a deck for learning English', () => {
    expect(filterListings(catalog, { nativeLanguages: ['en'], learningLanguage: 'en' })).toEqual([])
  })

  it('excludes a language the deck has nothing to do with', () => {
    expect(filterListings(catalog, { learningLanguage: 'th' })).toEqual([])
  })

  it('works without a mother tongue selected', () => {
    expect(filterListings(catalog, { learningLanguage: 'ko' }).map((d) => d.id)).toEqual(['ko-en'])
  })

  it('leaves a one-sided deck matching only its recorded language', () => {
    const solo = [deck({ id: 'solo', native_languages: ['ko'], learning_language: 'en' })]
    expect(filterListings(solo, { learningLanguage: 'en' }).map((d) => d.id)).toEqual(['solo'])
    expect(filterListings(solo, { learningLanguage: 'ko' })).toEqual([])
  })
})
