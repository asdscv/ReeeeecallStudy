import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  filterListings,
  sortListings,
  calculateTrendingScore,
  countActiveFilters,
  extractPopularTags,
  getTrendingListingIds,
  type MarketplaceListingData,
  type ListingFilters,
  type SortBy,
  SHARE_MODES,
  DATE_RANGE_OPTIONS,
} from '../marketplace'

// ─── Helpers ───────────────────────────────────────────────────

function makeListing(overrides?: Partial<MarketplaceListingData>): MarketplaceListingData {
  return {
    id: 'listing-1',
    deck_id: 'deck-1',
    owner_id: 'user-1',
    title: 'English Vocabulary',
    description: 'TOEIC essential words',
    tags: ['english', 'toeic'],
    category: 'language',
    share_mode: 'copy',
    card_count: 100,
    acquire_count: 50,
    avg_rating: 4.5,
    review_count: 10,
    is_active: true,
    created_at: '2026-03-10T00:00:00Z',
    updated_at: '2026-03-10T00:00:00Z',
    owner_display_name: 'TestUser',
    owner_is_official: false,
    ...overrides,
  }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString()
}

// ─── Trending Score ────────────────────────────────────────────

describe('calculateTrendingScore', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Fix time to 2026-03-19T00:00:00Z
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-19T00:00:00Z').getTime())
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  it('should calculate trending score correctly', () => {
    const listing = makeListing({
      acquire_count: 100,
      created_at: '2026-03-17T00:00:00Z', // 2 days ago
    })
    // days_since = 2, score = 100 / (2 + 2)^1.5 = 100 / 8 = 12.5
    expect(calculateTrendingScore(listing)).toBeCloseTo(12.5, 1)
  })

  it('should favor recent popular decks over old popular ones', () => {
    const recent = makeListing({
      id: 'recent',
      acquire_count: 50,
      created_at: daysAgo(3), // 3 days ago
    })
    const old = makeListing({
      id: 'old',
      acquire_count: 50,
      created_at: daysAgo(60), // 60 days ago
    })
    expect(calculateTrendingScore(recent)).toBeGreaterThan(calculateTrendingScore(old))
  })

  it('should favor very popular old decks over unpopular new ones', () => {
    const popularOld = makeListing({
      id: 'popular-old',
      acquire_count: 1000,
      created_at: daysAgo(30),
    })
    const unpopularNew = makeListing({
      id: 'unpopular-new',
      acquire_count: 1,
      created_at: daysAgo(1),
    })
    expect(calculateTrendingScore(popularOld)).toBeGreaterThan(calculateTrendingScore(unpopularNew))
  })

  it('should handle zero acquires', () => {
    const listing = makeListing({ acquire_count: 0, created_at: daysAgo(5) })
    expect(calculateTrendingScore(listing)).toBe(0)
  })

  it('should handle brand-new listing (0 days)', () => {
    const listing = makeListing({
      acquire_count: 10,
      created_at: new Date(Date.now()).toISOString(),
    })
    // days_since ~= 0, score = 10 / (0 + 2)^1.5 = 10 / 2.828... = ~3.54
    expect(calculateTrendingScore(listing)).toBeGreaterThan(3)
  })
})

// ─── Sort by Trending ──────────────────────────────────────────

describe('sortListings - trending', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-19T00:00:00Z').getTime())
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  it('should sort by trending score descending', () => {
    const listings = [
      makeListing({ id: 'old-popular', acquire_count: 100, created_at: daysAgo(60) }),
      makeListing({ id: 'new-popular', acquire_count: 80, created_at: daysAgo(3) }),
      makeListing({ id: 'medium', acquire_count: 50, created_at: daysAgo(10) }),
    ]
    const result = sortListings(listings, 'trending')
    // new-popular should rank highest due to recency
    expect(result[0].id).toBe('new-popular')
  })

  it('should not mutate original array', () => {
    const listings = [
      makeListing({ id: 'a', acquire_count: 10 }),
      makeListing({ id: 'b', acquire_count: 100 }),
    ]
    const original = listings.map((l) => l.id)
    sortListings(listings, 'trending')
    expect(listings.map((l) => l.id)).toEqual(original)
  })
})

// ─── Verified-Only Filter ──────────────────────────────────────

describe('filterListings - verifiedOnly', () => {
  const listings = [
    makeListing({ id: '1', owner_is_official: true }),
    makeListing({ id: '2', owner_is_official: false }),
    makeListing({ id: '3', owner_is_official: true }),
    makeListing({ id: '4', owner_is_official: undefined }),
  ]

  it('should return only verified listings when verifiedOnly is true', () => {
    const result = filterListings(listings, { verifiedOnly: true })
    expect(result).toHaveLength(2)
    expect(result.every((l) => l.owner_is_official === true)).toBe(true)
  })

  it('should return all listings when verifiedOnly is false', () => {
    const result = filterListings(listings, { verifiedOnly: false })
    expect(result).toHaveLength(4)
  })

  it('should return all listings when verifiedOnly is undefined', () => {
    const result = filterListings(listings, {})
    expect(result).toHaveLength(4)
  })
})

// ─── Date Range Filter ─────────────────────────────────────────

describe('filterListings - dateRange', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-19T00:00:00Z').getTime())
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  const listings = [
    makeListing({ id: 'today', created_at: daysAgo(0) }),
    makeListing({ id: '3d', created_at: daysAgo(3) }),
    makeListing({ id: '10d', created_at: daysAgo(10) }),
    makeListing({ id: '45d', created_at: daysAgo(45) }),
    makeListing({ id: '100d', created_at: daysAgo(100) }),
  ]

  it('should filter to last 7 days', () => {
    const result = filterListings(listings, { dateRange: '7d' })
    expect(result.map((l) => l.id)).toEqual(['today', '3d'])
  })

  it('should filter to last 30 days', () => {
    const result = filterListings(listings, { dateRange: '30d' })
    expect(result.map((l) => l.id)).toEqual(['today', '3d', '10d'])
  })

  it('should filter to last 90 days', () => {
    const result = filterListings(listings, { dateRange: '90d' })
    expect(result.map((l) => l.id)).toEqual(['today', '3d', '10d', '45d'])
  })

  it('should return all for dateRange "all"', () => {
    const result = filterListings(listings, { dateRange: 'all' })
    expect(result).toHaveLength(5)
  })

  it('should return all when dateRange is undefined', () => {
    const result = filterListings(listings, {})
    expect(result).toHaveLength(5)
  })
})

// ─── Card Count Filter ─────────────────────────────────────────

describe('filterListings - minCardCount', () => {
  const listings = [
    makeListing({ id: 'small', card_count: 5 }),
    makeListing({ id: 'medium', card_count: 50 }),
    makeListing({ id: 'large', card_count: 200 }),
  ]

  it('should filter by minimum card count', () => {
    const result = filterListings(listings, { minCardCount: 20 })
    expect(result.map((l) => l.id)).toEqual(['medium', 'large'])
  })

  it('should return all when minCardCount is 0', () => {
    const result = filterListings(listings, { minCardCount: 0 })
    expect(result).toHaveLength(3)
  })

  it('should return none when minCardCount is very high', () => {
    const result = filterListings(listings, { minCardCount: 500 })
    expect(result).toHaveLength(0)
  })

  it('should include exact boundary value', () => {
    const result = filterListings(listings, { minCardCount: 50 })
    expect(result.map((l) => l.id)).toEqual(['medium', 'large'])
  })
})

// ─── Share Mode Filter ─────────────────────────────────────────

describe('filterListings - shareMode', () => {
  const listings = [
    makeListing({ id: 'copy1', share_mode: 'copy' }),
    makeListing({ id: 'sub1', share_mode: 'subscribe' }),
    makeListing({ id: 'snap1', share_mode: 'snapshot' }),
    makeListing({ id: 'copy2', share_mode: 'copy' }),
  ]

  it('should filter by copy share mode', () => {
    const result = filterListings(listings, { shareMode: 'copy' })
    expect(result).toHaveLength(2)
    expect(result.every((l) => l.share_mode === 'copy')).toBe(true)
  })

  it('should filter by subscribe share mode', () => {
    const result = filterListings(listings, { shareMode: 'subscribe' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sub1')
  })

  it('should filter by snapshot share mode', () => {
    const result = filterListings(listings, { shareMode: 'snapshot' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('snap1')
  })

  it('should return all when shareMode is undefined', () => {
    const result = filterListings(listings, {})
    expect(result).toHaveLength(4)
  })
})

// ─── Min Rating Filter ─────────────────────────────────────────

describe('filterListings - minRating', () => {
  const listings = [
    makeListing({ id: 'low', avg_rating: 2.0, review_count: 5 }),
    makeListing({ id: 'mid', avg_rating: 3.5, review_count: 10 }),
    makeListing({ id: 'high', avg_rating: 4.8, review_count: 20 }),
    makeListing({ id: 'none', avg_rating: 0, review_count: 0 }),
  ]

  it('should filter by minimum rating', () => {
    const result = filterListings(listings, { minRating: 3 })
    expect(result.map((l) => l.id)).toEqual(['mid', 'high'])
  })

  it('should return all when minRating is 0', () => {
    const result = filterListings(listings, { minRating: 0 })
    expect(result).toHaveLength(4)
  })

  it('should return all when minRating is undefined', () => {
    const result = filterListings(listings, {})
    expect(result).toHaveLength(4)
  })
})

// ─── Combined Filters ──────────────────────────────────────────

describe('filterListings - combined filters', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-19T00:00:00Z').getTime())
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  const listings = [
    makeListing({
      id: '1',
      title: 'TOEIC Words',
      category: 'language',
      share_mode: 'copy',
      card_count: 100,
      owner_is_official: true,
      created_at: daysAgo(5),
      tags: ['english'],
    }),
    makeListing({
      id: '2',
      title: 'React Patterns',
      category: 'programming',
      share_mode: 'subscribe',
      card_count: 30,
      owner_is_official: false,
      created_at: daysAgo(20),
      tags: ['react'],
    }),
    makeListing({
      id: '3',
      title: 'Math Formulas',
      category: 'math',
      share_mode: 'copy',
      card_count: 200,
      owner_is_official: true,
      created_at: daysAgo(50),
      tags: ['math', 'formulas'],
    }),
    makeListing({
      id: '4',
      title: 'History Dates',
      category: 'history',
      share_mode: 'snapshot',
      card_count: 80,
      owner_is_official: false,
      created_at: daysAgo(3),
      tags: ['history'],
    }),
  ]

  it('should combine query + category', () => {
    const result = filterListings(listings, { query: 'toeic', category: 'language' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('should combine category + verified + dateRange', () => {
    const result = filterListings(listings, {
      category: 'language',
      verifiedOnly: true,
      dateRange: '7d',
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('should combine shareMode + minCardCount', () => {
    const result = filterListings(listings, {
      shareMode: 'copy',
      minCardCount: 50,
    })
    expect(result).toHaveLength(2)
    expect(result.map((l) => l.id).sort()).toEqual(['1', '3'])
  })

  it('should return empty when no listing matches all filters', () => {
    const result = filterListings(listings, {
      category: 'language',
      shareMode: 'subscribe',
      verifiedOnly: true,
    })
    expect(result).toHaveLength(0)
  })

  it('should combine query + verified + dateRange + shareMode + minCardCount', () => {
    const result = filterListings(listings, {
      query: 'words',
      verifiedOnly: true,
      dateRange: '7d',
      shareMode: 'copy',
      minCardCount: 50,
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('should combine tags + category', () => {
    const result = filterListings(listings, { tags: ['react'], category: 'programming' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('2')
  })
})

// ─── countActiveFilters ────────────────────────────────────────

describe('countActiveFilters', () => {
  it('should return 0 for empty filters', () => {
    expect(countActiveFilters({})).toBe(0)
  })

  it('should not count query or category', () => {
    expect(countActiveFilters({ query: 'test', category: 'language' })).toBe(0)
  })

  it('should count minCardCount', () => {
    expect(countActiveFilters({ minCardCount: 20 })).toBe(1)
  })

  it('should count shareMode', () => {
    expect(countActiveFilters({ shareMode: 'copy' })).toBe(1)
  })

  it('should count dateRange (non-all)', () => {
    expect(countActiveFilters({ dateRange: '7d' })).toBe(1)
  })

  it('should not count dateRange "all"', () => {
    expect(countActiveFilters({ dateRange: 'all' })).toBe(0)
  })

  it('should count verifiedOnly', () => {
    expect(countActiveFilters({ verifiedOnly: true })).toBe(1)
  })

  it('should count minRating', () => {
    expect(countActiveFilters({ minRating: 3 })).toBe(1)
  })

  it('should count tags', () => {
    expect(countActiveFilters({ tags: ['english'] })).toBe(1)
  })

  it('should count all active filters combined', () => {
    expect(countActiveFilters({
      minCardCount: 20,
      shareMode: 'copy',
      dateRange: '30d',
      verifiedOnly: true,
      minRating: 3,
      tags: ['english'],
    })).toBe(6)
  })
})

// ─── extractPopularTags ────────────────────────────────────────

describe('extractPopularTags', () => {
  const listings = [
    makeListing({ tags: ['english', 'toeic'] }),
    makeListing({ tags: ['english', 'vocabulary'] }),
    makeListing({ tags: ['math', 'algebra'] }),
    makeListing({ tags: ['english', 'grammar'] }),
  ]

  it('should return tags sorted by frequency', () => {
    const tags = extractPopularTags(listings)
    expect(tags[0]).toBe('english') // appears 3 times
  })

  it('should respect limit parameter', () => {
    const tags = extractPopularTags(listings, 3)
    expect(tags).toHaveLength(3)
  })

  it('should handle empty listings', () => {
    expect(extractPopularTags([])).toEqual([])
  })

  it('should lowercase tags for deduplication', () => {
    const data = [
      makeListing({ tags: ['English'] }),
      makeListing({ tags: ['english'] }),
    ]
    const tags = extractPopularTags(data)
    expect(tags.filter((t) => t === 'english')).toHaveLength(1)
  })

  it('should handle listings with no tags', () => {
    const data = [makeListing({ tags: [] }), makeListing({ tags: [] })]
    expect(extractPopularTags(data)).toEqual([])
  })
})

// ─── getTrendingListingIds ─────────────────────────────────────

describe('getTrendingListingIds', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-19T00:00:00Z').getTime())
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  it('should return top 10% by default', () => {
    const listings = Array.from({ length: 20 }, (_, i) =>
      makeListing({
        id: `listing-${i}`,
        acquire_count: (i + 1) * 10,
        created_at: daysAgo(i),
      }),
    )
    const trending = getTrendingListingIds(listings)
    // 10% of 20 = 2 items
    expect(trending.size).toBe(2)
  })

  it('should return at least 1 item for small lists', () => {
    const listings = [makeListing({ id: 'only-one', acquire_count: 5, created_at: daysAgo(1) })]
    const trending = getTrendingListingIds(listings)
    expect(trending.size).toBe(1)
    expect(trending.has('only-one')).toBe(true)
  })

  it('should return empty set for empty listings', () => {
    expect(getTrendingListingIds([])).toEqual(new Set())
  })

  it('should respect custom topPercent', () => {
    const listings = Array.from({ length: 10 }, (_, i) =>
      makeListing({
        id: `listing-${i}`,
        acquire_count: (i + 1) * 10,
        created_at: daysAgo(i),
      }),
    )
    const trending = getTrendingListingIds(listings, 0.3) // top 30%
    expect(trending.size).toBe(3)
  })
})

// ─── Sort Options ──────────────────────────────────────────────

describe('sortListings - all options', () => {
  const listings = [
    makeListing({ id: 'a', acquire_count: 10, created_at: '2026-03-01T00:00:00Z', card_count: 50, avg_rating: 3.0 }),
    makeListing({ id: 'b', acquire_count: 100, created_at: '2026-01-01T00:00:00Z', card_count: 200, avg_rating: 4.5 }),
    makeListing({ id: 'c', acquire_count: 50, created_at: '2026-02-01T00:00:00Z', card_count: 30, avg_rating: 5.0 }),
  ]

  it('should sort by newest', () => {
    const result = sortListings(listings, 'newest')
    expect(result.map((l) => l.id)).toEqual(['a', 'c', 'b'])
  })

  it('should sort by popular', () => {
    const result = sortListings(listings, 'popular')
    expect(result.map((l) => l.id)).toEqual(['b', 'c', 'a'])
  })

  it('should sort by card_count', () => {
    const result = sortListings(listings, 'card_count')
    expect(result.map((l) => l.id)).toEqual(['b', 'a', 'c'])
  })

  it('should sort by top_rated', () => {
    const result = sortListings(listings, 'top_rated')
    expect(result.map((l) => l.id)).toEqual(['c', 'b', 'a'])
  })
})

// ─── Empty Results ─────────────────────────────────────────────

describe('filterListings - empty results', () => {
  it('should return empty array when no listings match', () => {
    const listings = [makeListing({ category: 'language' })]
    const result = filterListings(listings, { category: 'math' })
    expect(result).toHaveLength(0)
  })

  it('should return empty array for empty input', () => {
    const result = filterListings([], { query: 'test' })
    expect(result).toHaveLength(0)
  })

  it('should handle sort on empty array', () => {
    const result = sortListings([], 'trending')
    expect(result).toEqual([])
  })
})

// ─── Constants ─────────────────────────────────────────────────

describe('constants', () => {
  it('SHARE_MODES should include copy, subscribe, snapshot', () => {
    expect(SHARE_MODES).toContain('copy')
    expect(SHARE_MODES).toContain('subscribe')
    expect(SHARE_MODES).toContain('snapshot')
  })

  it('DATE_RANGE_OPTIONS should include 7d, 30d, 90d, all', () => {
    expect(DATE_RANGE_OPTIONS).toContain('7d')
    expect(DATE_RANGE_OPTIONS).toContain('30d')
    expect(DATE_RANGE_OPTIONS).toContain('90d')
    expect(DATE_RANGE_OPTIONS).toContain('all')
  })
})

// ─── Filter extensibility (type checks) ───────────────────────

describe('filter extensibility', () => {
  it('should accept unknown filter properties without errors', () => {
    const filters: ListingFilters = {
      query: 'test',
      category: 'language',
      minCardCount: 10,
      shareMode: 'copy',
      dateRange: '7d',
      verifiedOnly: true,
      minRating: 4,
      tags: ['english'],
    }
    const listings = [makeListing()]
    // Should not throw
    expect(() => filterListings(listings, filters)).not.toThrow()
  })

  it('should accept all sort options', () => {
    const allSorts: SortBy[] = ['newest', 'popular', 'card_count', 'top_rated', 'trending']
    const listings = [makeListing()]
    for (const sort of allSorts) {
      expect(() => sortListings(listings, sort)).not.toThrow()
    }
  })
})
