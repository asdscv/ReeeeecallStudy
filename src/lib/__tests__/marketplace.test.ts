import { describe, it, expect } from 'vitest'
import {
  filterListings,
  sortListings,
  isListingOwner,
  MARKETPLACE_CATEGORIES,
  type MarketplaceListingData,
} from '../marketplace'

function makeListing(overrides?: Partial<MarketplaceListingData>): MarketplaceListingData {
  return {
    id: 'listing-1',
    deck_id: 'deck-1',
    owner_id: 'user-1',
    title: '영어 단어장',
    description: 'TOEIC 필수 단어',
    tags: ['english', 'toeic'],
    category: 'language',
    share_mode: 'copy',
    card_count: 100,
    acquire_count: 50,
    is_active: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('filterListings', () => {
  const listings: MarketplaceListingData[] = [
    makeListing({ id: '1', title: '영어 단어장', description: 'TOEIC 필수 단어', category: 'language', tags: ['english', 'toeic'] }),
    makeListing({ id: '2', title: '일본어 히라가나', description: '기초 일본어', category: 'language', tags: ['japanese'] }),
    makeListing({ id: '3', title: '세계 수도 퀴즈', description: '세계 지리 퀴즈', category: 'trivia', tags: ['geography'] }),
    makeListing({ id: '4', title: 'React 면접 준비', description: '프론트엔드 면접', category: 'programming', tags: ['react', 'frontend'] }),
  ]

  it('should return all listings when no filters', () => {
    expect(filterListings(listings, {})).toHaveLength(4)
  })

  it('should filter by category', () => {
    const result = filterListings(listings, { category: 'language' })
    expect(result).toHaveLength(2)
    expect(result.every((l) => l.category === 'language')).toBe(true)
  })

  it('should filter by query (title match)', () => {
    const result = filterListings(listings, { query: '영어' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('should filter by query (description match)', () => {
    const result = filterListings(listings, { query: 'TOEIC' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('should filter by tags', () => {
    const result = filterListings(listings, { tags: ['react'] })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('4')
  })

  it('should combine category + query filters', () => {
    const result = filterListings(listings, { category: 'language', query: '일본' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })

  it('should be case-insensitive for query', () => {
    const result = filterListings(listings, { query: 'react' })
    expect(result).toHaveLength(1)
  })
})

describe('sortListings', () => {
  const listings: MarketplaceListingData[] = [
    makeListing({ id: '1', acquire_count: 10, created_at: '2025-03-01T00:00:00Z', card_count: 50 }),
    makeListing({ id: '2', acquire_count: 100, created_at: '2025-01-01T00:00:00Z', card_count: 200 }),
    makeListing({ id: '3', acquire_count: 50, created_at: '2025-02-01T00:00:00Z', card_count: 30 }),
  ]

  it('should sort by newest (created_at desc)', () => {
    const result = sortListings(listings, 'newest')
    expect(result.map((l) => l.id)).toEqual(['1', '3', '2'])
  })

  it('should sort by popular (acquire_count desc)', () => {
    const result = sortListings(listings, 'popular')
    expect(result.map((l) => l.id)).toEqual(['2', '3', '1'])
  })

  it('should sort by card_count desc', () => {
    const result = sortListings(listings, 'card_count')
    expect(result.map((l) => l.id)).toEqual(['2', '1', '3'])
  })

  it('should not mutate original array', () => {
    const original = [...listings]
    sortListings(listings, 'popular')
    expect(listings.map((l) => l.id)).toEqual(original.map((l) => l.id))
  })
})

describe('isListingOwner', () => {
  it('should return true when userId matches owner_id', () => {
    const listing = makeListing({ owner_id: 'user-1' })
    expect(isListingOwner(listing, 'user-1')).toBe(true)
  })

  it('should return false when userId does not match', () => {
    const listing = makeListing({ owner_id: 'user-1' })
    expect(isListingOwner(listing, 'user-2')).toBe(false)
  })
})

describe('MARKETPLACE_CATEGORIES', () => {
  it('should include general category', () => {
    expect(MARKETPLACE_CATEGORIES).toContainEqual(
      expect.objectContaining({ value: 'general' })
    )
  })

  it('should have at least 5 categories', () => {
    expect(MARKETPLACE_CATEGORIES.length).toBeGreaterThanOrEqual(5)
  })

  it('should have value and labelKey for each category', () => {
    for (const cat of MARKETPLACE_CATEGORIES) {
      expect(cat.value).toBeTruthy()
      expect(cat.labelKey).toBeTruthy()
    }
  })
})
