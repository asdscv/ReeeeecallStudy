import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ──

const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockAuth = {
  getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: mockAuth,
  },
}))

vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: mockAuth,
  },
  initSupabase: vi.fn(),
  getSupabase: vi.fn(),
}))

// ── Helpers for publisher stats calculation ──

interface ListingStat {
  view_count: number
  acquire_count: number
  is_active: boolean
}

function computeTotalViews(listings: ListingStat[]): number {
  return listings.reduce((sum, l) => sum + (l.view_count ?? 0), 0)
}

function computeTotalAcquires(listings: ListingStat[]): number {
  return listings.reduce((sum, l) => sum + (l.acquire_count ?? 0), 0)
}

function computeActiveCount(listings: ListingStat[]): number {
  return listings.filter((l) => l.is_active).length
}

function computeConversionRate(views: number, acquires: number): number {
  if (views === 0) return 0
  return Math.round((acquires / views) * 10000) / 100
}

interface DailyViewData {
  date: string
  views: number
  unique_viewers: number
}

function aggregateDailyViews(dailyData: DailyViewData[]): { totalViews: number; totalUnique: number } {
  return dailyData.reduce(
    (acc, d) => ({
      totalViews: acc.totalViews + d.views,
      totalUnique: acc.totalUnique + d.unique_viewers,
    }),
    { totalViews: 0, totalUnique: 0 },
  )
}

function isDeduplicated(viewerKey: string, _existingKeys: string[], windowMs: number, now: number, viewTimestamps: Map<string, number>): boolean {
  const lastView = viewTimestamps.get(viewerKey)
  if (!lastView) return false
  return (now - lastView) < windowMs
}

type SortKey = 'view_count' | 'acquire_count' | 'conversion_rate' | 'title' | 'created_at'
type SortDir = 'asc' | 'desc'

function sortListings<T extends Record<string, unknown>>(
  listings: T[],
  key: SortKey,
  dir: SortDir,
): T[] {
  return [...listings].sort((a, b) => {
    const mult = dir === 'asc' ? 1 : -1
    const aVal = a[key]
    const bVal = b[key]
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return mult * aVal.localeCompare(bVal)
    }
    return mult * (Number(aVal ?? 0) - Number(bVal ?? 0))
  })
}

// ── Tests ──

describe('Publisher Dashboard - View Recording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should record a marketplace view via RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    await mockRpc('record_marketplace_view', {
      p_listing_id: 'listing-1',
      p_session_id: 'session-abc',
      p_referrer: null,
    })

    expect(mockRpc).toHaveBeenCalledWith('record_marketplace_view', {
      p_listing_id: 'listing-1',
      p_session_id: 'session-abc',
      p_referrer: null,
    })
  })

  it('should not duplicate views within rate limit window', () => {
    const timestamps = new Map<string, number>()
    const now = Date.now()
    const hourMs = 3600_000

    // First view
    timestamps.set('user-1', now - 500_000) // 500s ago
    expect(isDeduplicated('user-1', [], hourMs, now, timestamps)).toBe(true)

    // View from >1h ago should not be deduplicated
    timestamps.set('user-2', now - hourMs - 1000)
    expect(isDeduplicated('user-2', [], hourMs, now, timestamps)).toBe(false)
  })

  it('should allow views from different sessions', () => {
    const timestamps = new Map<string, number>()
    const now = Date.now()
    const hourMs = 3600_000

    timestamps.set('session-1', now - 100_000)
    // Different session should not be deduplicated
    expect(isDeduplicated('session-2', [], hourMs, now, timestamps)).toBe(false)
  })

  it('should handle RPC errors gracefully', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Network error' } })

    const { error } = await mockRpc('record_marketplace_view', {
      p_listing_id: 'listing-1',
      p_session_id: 'session-abc',
    })

    expect(error).toBeTruthy()
    expect(error.message).toBe('Network error')
  })

  it('should pass referrer when available', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    await mockRpc('record_marketplace_view', {
      p_listing_id: 'listing-1',
      p_session_id: 'session-abc',
      p_referrer: 'https://google.com',
    })

    expect(mockRpc).toHaveBeenCalledWith('record_marketplace_view', expect.objectContaining({
      p_referrer: 'https://google.com',
    }))
  })
})

describe('Publisher Dashboard - Stats Aggregation', () => {
  it('should compute total views from listings', () => {
    const listings: ListingStat[] = [
      { view_count: 100, acquire_count: 10, is_active: true },
      { view_count: 200, acquire_count: 20, is_active: true },
      { view_count: 50, acquire_count: 5, is_active: false },
    ]

    expect(computeTotalViews(listings)).toBe(350)
  })

  it('should compute total acquires from listings', () => {
    const listings: ListingStat[] = [
      { view_count: 100, acquire_count: 10, is_active: true },
      { view_count: 200, acquire_count: 25, is_active: true },
    ]

    expect(computeTotalAcquires(listings)).toBe(35)
  })

  it('should count only active listings', () => {
    const listings: ListingStat[] = [
      { view_count: 100, acquire_count: 10, is_active: true },
      { view_count: 200, acquire_count: 20, is_active: false },
      { view_count: 50, acquire_count: 5, is_active: true },
    ]

    expect(computeActiveCount(listings)).toBe(2)
  })

  it('should handle zero views and acquires', () => {
    const listings: ListingStat[] = [
      { view_count: 0, acquire_count: 0, is_active: true },
    ]

    expect(computeTotalViews(listings)).toBe(0)
    expect(computeTotalAcquires(listings)).toBe(0)
  })

  it('should aggregate daily views correctly', () => {
    const daily: DailyViewData[] = [
      { date: '2026-03-17', views: 10, unique_viewers: 8 },
      { date: '2026-03-18', views: 15, unique_viewers: 12 },
      { date: '2026-03-19', views: 20, unique_viewers: 16 },
    ]

    const result = aggregateDailyViews(daily)
    expect(result.totalViews).toBe(45)
    expect(result.totalUnique).toBe(36)
  })

  it('should handle empty daily data', () => {
    const result = aggregateDailyViews([])
    expect(result.totalViews).toBe(0)
    expect(result.totalUnique).toBe(0)
  })
})

describe('Publisher Dashboard - Conversion Rate', () => {
  it('should calculate conversion rate correctly', () => {
    expect(computeConversionRate(100, 10)).toBe(10)
    expect(computeConversionRate(200, 50)).toBe(25)
  })

  it('should return 0 when views are 0', () => {
    expect(computeConversionRate(0, 0)).toBe(0)
    expect(computeConversionRate(0, 5)).toBe(0)
  })

  it('should handle small conversion rates', () => {
    expect(computeConversionRate(1000, 1)).toBe(0.1)
  })

  it('should handle 100% conversion', () => {
    expect(computeConversionRate(10, 10)).toBe(100)
  })

  it('should handle fractional rates with precision', () => {
    // 33.33%
    const rate = computeConversionRate(3, 1)
    expect(rate).toBe(33.33)
  })
})

describe('Publisher Dashboard - Daily Breakdown', () => {
  it('should return correct views per day', () => {
    const daily: DailyViewData[] = [
      { date: '2026-03-17', views: 10, unique_viewers: 8 },
      { date: '2026-03-18', views: 15, unique_viewers: 12 },
    ]

    expect(daily[0].views).toBe(10)
    expect(daily[1].views).toBe(15)
    expect(daily[0].unique_viewers).toBe(8)
  })

  it('should handle single day data', () => {
    const daily: DailyViewData[] = [
      { date: '2026-03-19', views: 42, unique_viewers: 30 },
    ]

    const result = aggregateDailyViews(daily)
    expect(result.totalViews).toBe(42)
    expect(result.totalUnique).toBe(30)
  })

  it('should handle days with no views', () => {
    const daily: DailyViewData[] = [
      { date: '2026-03-17', views: 0, unique_viewers: 0 },
      { date: '2026-03-18', views: 10, unique_viewers: 8 },
    ]

    const result = aggregateDailyViews(daily)
    expect(result.totalViews).toBe(10)
  })
})

describe('Publisher Dashboard - Empty State', () => {
  it('should return empty stats for user with no listings', () => {
    const listings: ListingStat[] = []

    expect(computeTotalViews(listings)).toBe(0)
    expect(computeTotalAcquires(listings)).toBe(0)
    expect(computeActiveCount(listings)).toBe(0)
    expect(computeConversionRate(0, 0)).toBe(0)
  })

  it('should handle all inactive listings', () => {
    const listings: ListingStat[] = [
      { view_count: 100, acquire_count: 10, is_active: false },
      { view_count: 50, acquire_count: 5, is_active: false },
    ]

    expect(computeActiveCount(listings)).toBe(0)
    // Total views still count even for inactive
    expect(computeTotalViews(listings)).toBe(150)
  })
})

describe('Publisher Dashboard - Listing Sort', () => {
  const listings = [
    { title: 'Alpha', view_count: 50, acquire_count: 5, conversion_rate: 10, created_at: '2026-01-01' },
    { title: 'Charlie', view_count: 200, acquire_count: 40, conversion_rate: 20, created_at: '2026-03-01' },
    { title: 'Bravo', view_count: 100, acquire_count: 10, conversion_rate: 10, created_at: '2026-02-01' },
  ]

  it('should sort by view_count descending', () => {
    const sorted = sortListings(listings, 'view_count', 'desc')
    expect(sorted[0].title).toBe('Charlie')
    expect(sorted[1].title).toBe('Bravo')
    expect(sorted[2].title).toBe('Alpha')
  })

  it('should sort by view_count ascending', () => {
    const sorted = sortListings(listings, 'view_count', 'asc')
    expect(sorted[0].title).toBe('Alpha')
    expect(sorted[2].title).toBe('Charlie')
  })

  it('should sort by title alphabetically', () => {
    const sorted = sortListings(listings, 'title', 'asc')
    expect(sorted[0].title).toBe('Alpha')
    expect(sorted[1].title).toBe('Bravo')
    expect(sorted[2].title).toBe('Charlie')
  })

  it('should sort by acquire_count descending', () => {
    const sorted = sortListings(listings, 'acquire_count', 'desc')
    expect(sorted[0].title).toBe('Charlie')
    expect(sorted[0].acquire_count).toBe(40)
  })

  it('should sort by conversion_rate descending', () => {
    const sorted = sortListings(listings, 'conversion_rate', 'desc')
    expect(sorted[0].title).toBe('Charlie')
    expect(sorted[0].conversion_rate).toBe(20)
  })

  it('should sort by created_at descending (newest first)', () => {
    const sorted = sortListings(listings, 'created_at', 'desc')
    expect(sorted[0].title).toBe('Charlie')
    expect(sorted[2].title).toBe('Alpha')
  })

  it('should handle single item array', () => {
    const single = [{ title: 'Only', view_count: 10, acquire_count: 1, conversion_rate: 10, created_at: '2026-01-01' }]
    const sorted = sortListings(single, 'view_count', 'desc')
    expect(sorted).toHaveLength(1)
    expect(sorted[0].title).toBe('Only')
  })

  it('should handle empty array', () => {
    const sorted = sortListings([], 'view_count', 'desc')
    expect(sorted).toHaveLength(0)
  })

  it('should not mutate original array', () => {
    const original = [...listings]
    sortListings(listings, 'view_count', 'desc')
    expect(listings[0].title).toBe(original[0].title)
  })
})

describe('Publisher Dashboard - Publisher Store RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call get_publisher_stats RPC', async () => {
    const mockStats = {
      total_listings: 3,
      total_views: 500,
      total_acquires: 50,
      avg_conversion_rate: 10,
      listings: [],
      daily_views: [],
      daily_acquires: [],
      top_listings: [],
      recent_acquires: [],
      recent_reviews: [],
    }

    mockRpc.mockResolvedValueOnce({ data: mockStats, error: null })

    const { data } = await mockRpc('get_publisher_stats')

    expect(mockRpc).toHaveBeenCalledWith('get_publisher_stats')
    expect(data.total_listings).toBe(3)
    expect(data.total_views).toBe(500)
  })

  it('should call get_listing_stats RPC with listing ID', async () => {
    const mockDetail = {
      total_views: 100,
      total_acquires: 15,
      conversion_rate: 15,
      daily_views: [],
      avg_rating: 4.2,
      review_count: 5,
    }

    mockRpc.mockResolvedValueOnce({ data: mockDetail, error: null })

    const { data } = await mockRpc('get_listing_stats', { p_listing_id: 'listing-1' })

    expect(mockRpc).toHaveBeenCalledWith('get_listing_stats', { p_listing_id: 'listing-1' })
    expect(data.total_views).toBe(100)
    expect(data.conversion_rate).toBe(15)
  })

  it('should handle unauthenticated user', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Not authenticated' } })

    const { error } = await mockRpc('get_publisher_stats')

    expect(error.message).toBe('Not authenticated')
  })

  it('should handle non-owner access to listing stats', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Not the owner of this listing' } })

    const { error } = await mockRpc('get_listing_stats', { p_listing_id: 'listing-other' })

    expect(error.message).toBe('Not the owner of this listing')
  })
})

describe('Publisher Dashboard - View Count Dedup Logic', () => {
  it('should deduplicate within 1-hour window', () => {
    const timestamps = new Map<string, number>()
    const now = Date.now()
    const hourMs = 3600_000

    // Record a view
    timestamps.set('viewer-A:listing-1', now - 1000) // 1s ago

    // Same viewer+listing within 1h -> deduplicated
    expect(isDeduplicated('viewer-A:listing-1', [], hourMs, now, timestamps)).toBe(true)
  })

  it('should allow same viewer on different listings', () => {
    const timestamps = new Map<string, number>()
    const now = Date.now()
    const hourMs = 3600_000

    timestamps.set('viewer-A:listing-1', now - 1000)

    // Different listing key -> not deduplicated
    expect(isDeduplicated('viewer-A:listing-2', [], hourMs, now, timestamps)).toBe(false)
  })

  it('should allow view after window expires', () => {
    const timestamps = new Map<string, number>()
    const now = Date.now()
    const hourMs = 3600_000

    // View from 2 hours ago
    timestamps.set('viewer-A:listing-1', now - 2 * hourMs)

    expect(isDeduplicated('viewer-A:listing-1', [], hourMs, now, timestamps)).toBe(false)
  })

  it('should handle anonymous sessions (null viewer_id)', () => {
    const timestamps = new Map<string, number>()
    const now = Date.now()
    const hourMs = 3600_000

    // Anonymous view with session ID
    timestamps.set('session-xyz:listing-1', now - 500_000)

    expect(isDeduplicated('session-xyz:listing-1', [], hourMs, now, timestamps)).toBe(true)
    expect(isDeduplicated('session-other:listing-1', [], hourMs, now, timestamps)).toBe(false)
  })
})

describe('Publisher Dashboard - Formatting', () => {
  function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  it('should format small numbers as-is', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(999)).toBe('999')
  })

  it('should format thousands with K suffix', () => {
    expect(formatNumber(1000)).toBe('1.0K')
    expect(formatNumber(1500)).toBe('1.5K')
    expect(formatNumber(99999)).toBe('100.0K')
  })

  it('should format millions with M suffix', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M')
    expect(formatNumber(2_500_000)).toBe('2.5M')
  })
})
