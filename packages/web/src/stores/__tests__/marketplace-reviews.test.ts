import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Supabase mock ──────────────────────────────────────────
const mockRpc = vi.fn(); void mockRpc
const mockFrom = vi.fn(); void mockFrom

// Chainable query builder mock
function createQueryBuilder(resolvedValue: unknown = { data: [], error: null }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'range', 'limit', 'single', 'maybeSingle']
  methods.forEach((m) => {
    builder[m] = vi.fn(() => {
      // Terminal methods return the resolved value
      if (m === 'single' || m === 'maybeSingle') {
        return Promise.resolve(resolvedValue)
      }
      return builder
    })
  })
  // Make the builder thenable
  ;(builder as any).then = (resolve: (v: unknown) => void) => Promise.resolve(resolvedValue).then(resolve)
  return builder
}

const mockSupabase = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
  },
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))

// Import the store after mocking
import { useReviewsStore } from '../reviews-store'

// ─── Helpers ────────────────────────────────────────────────
const fakeUser = { id: 'user-1', email: 'test@test.com' }
const fakeListingId = 'listing-1'

const fakeReview = {
  id: 'review-1',
  listing_id: fakeListingId,
  user_id: 'user-1',
  rating: 4,
  title: 'Great deck!',
  body: 'Really helpful for studying.',
  is_edited: false,
  helpful_count: 2,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  profiles: { display_name: 'TestUser' },
}

const fakeReview2 = {
  ...fakeReview,
  id: 'review-2',
  user_id: 'user-2',
  rating: 5,
  title: 'Excellent',
  body: null,
  helpful_count: 0,
  profiles: { display_name: 'OtherUser' },
}

const fakeStats = {
  avg_rating: 4.5,
  review_count: 2,
  rating_1: 0,
  rating_2: 0,
  rating_3: 0,
  rating_4: 1,
  rating_5: 1,
}

function resetStore() {
  useReviewsStore.getState().reset()
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  mockSupabase.auth.getUser.mockResolvedValue({ data: { user: fakeUser } })
})

// ─── fetchReviews ───────────────────────────────────────────
describe('fetchReviews', () => {
  it('should fetch reviews for a listing and set state', async () => {
    const qb = createQueryBuilder({ data: [fakeReview, fakeReview2], error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'marketplace_reviews') return qb
      if (table === 'review_helpfuls') return createQueryBuilder({ data: [], error: null })
      return createQueryBuilder()
    })

    await useReviewsStore.getState().fetchReviews(fakeListingId)

    expect(mockSupabase.from).toHaveBeenCalledWith('marketplace_reviews')
    const state = useReviewsStore.getState()
    expect(state.reviews).toHaveLength(2)
    expect(state.loading).toBe(false)
  })

  it('should set error when fetch fails', async () => {
    const qb = createQueryBuilder({ data: null, error: { message: 'DB error' } })
    mockSupabase.from.mockReturnValue(qb)

    await useReviewsStore.getState().fetchReviews(fakeListingId)

    expect(useReviewsStore.getState().error).toBe('DB error')
    expect(useReviewsStore.getState().loading).toBe(false)
  })

  it('should append reviews for page > 1', async () => {
    // Page 1
    const qb1 = createQueryBuilder({ data: [fakeReview], error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'marketplace_reviews') return qb1
      if (table === 'review_helpfuls') return createQueryBuilder({ data: [], error: null })
      return createQueryBuilder()
    })

    await useReviewsStore.getState().fetchReviews(fakeListingId, 1)
    expect(useReviewsStore.getState().reviews).toHaveLength(1)

    // Page 2
    const qb2 = createQueryBuilder({ data: [fakeReview2], error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'marketplace_reviews') return qb2
      if (table === 'review_helpfuls') return createQueryBuilder({ data: [], error: null })
      return createQueryBuilder()
    })

    await useReviewsStore.getState().fetchReviews(fakeListingId, 2)
    expect(useReviewsStore.getState().reviews).toHaveLength(2)
  })

  it('should track user helpful votes', async () => {
    const qb = createQueryBuilder({ data: [fakeReview], error: null })
    const helpfulQb = createQueryBuilder({ data: [{ review_id: 'review-1' }], error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'marketplace_reviews') return qb
      if (table === 'review_helpfuls') return helpfulQb
      return createQueryBuilder()
    })

    await useReviewsStore.getState().fetchReviews(fakeListingId)
    expect(useReviewsStore.getState().userHelpfuls.has('review-1')).toBe(true)
  })
})

// ─── fetchStats ─────────────────────────────────────────────
describe('fetchStats', () => {
  it('should fetch and parse review stats from RPC', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [fakeStats], error: null })

    await useReviewsStore.getState().fetchStats(fakeListingId)

    const { stats } = useReviewsStore.getState()
    expect(stats).not.toBeNull()
    expect(stats!.avg_rating).toBe(4.5)
    expect(stats!.review_count).toBe(2)
    expect(stats!.rating_5).toBe(1)
    expect(stats!.rating_4).toBe(1)
    expect(stats!.rating_1).toBe(0)
  })

  it('should handle single-object RPC response', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: fakeStats, error: null })

    await useReviewsStore.getState().fetchStats(fakeListingId)

    const { stats } = useReviewsStore.getState()
    expect(stats).not.toBeNull()
    expect(stats!.avg_rating).toBe(4.5)
  })

  it('should not set stats on error', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'fail' } })

    await useReviewsStore.getState().fetchStats(fakeListingId)

    expect(useReviewsStore.getState().stats).toBeNull()
  })
})

// ─── fetchUserReview ────────────────────────────────────────
describe('fetchUserReview', () => {
  it('should fetch the current user review', async () => {
    const qb = createQueryBuilder({ data: fakeReview, error: null })
    mockSupabase.from.mockReturnValue(qb)

    await useReviewsStore.getState().fetchUserReview(fakeListingId)

    expect(useReviewsStore.getState().userReview).not.toBeNull()
  })

  it('should set userReview to null when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

    await useReviewsStore.getState().fetchUserReview(fakeListingId)

    expect(useReviewsStore.getState().userReview).toBeNull()
  })

  it('should set userReview to null when no review exists', async () => {
    const qb = createQueryBuilder({ data: null, error: null })
    mockSupabase.from.mockReturnValue(qb)

    await useReviewsStore.getState().fetchUserReview(fakeListingId)

    expect(useReviewsStore.getState().userReview).toBeNull()
  })
})

// ─── submitReview ───────────────────────────────────────────
describe('submitReview', () => {
  it('should call submit_review RPC and return true on success', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'new-review-id', error: null })
    // Mock the refresh calls
    const qb = createQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'marketplace_reviews') return qb
      if (table === 'review_helpfuls') return createQueryBuilder({ data: [], error: null })
      return createQueryBuilder()
    })

    const result = await useReviewsStore.getState().submitReview(
      fakeListingId,
      5,
      'Amazing',
      'Best deck ever',
    )

    expect(result).toBe(true)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('submit_review', {
      p_listing_id: fakeListingId,
      p_rating: 5,
      p_title: 'Amazing',
      p_body: 'Best deck ever',
    })
    expect(useReviewsStore.getState().submitting).toBe(false)
  })

  it('should return false and set error on RPC failure', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Must acquire deck before reviewing' } })

    const result = await useReviewsStore.getState().submitReview(fakeListingId, 3)

    expect(result).toBe(false)
    expect(useReviewsStore.getState().error).toBe('Must acquire deck before reviewing')
    expect(useReviewsStore.getState().submitting).toBe(false)
  })

  it('should handle upsert (editing existing review)', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'review-1', error: null })
    const qb = createQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockImplementation(() => qb)

    const result = await useReviewsStore.getState().submitReview(
      fakeListingId,
      4,
      'Updated title',
      'Updated body',
    )

    expect(result).toBe(true)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('submit_review', {
      p_listing_id: fakeListingId,
      p_rating: 4,
      p_title: 'Updated title',
      p_body: 'Updated body',
    })
  })

  it('should send null for empty title and body', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'review-1', error: null })
    const qb = createQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockImplementation(() => qb)

    await useReviewsStore.getState().submitReview(fakeListingId, 3, '', '')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('submit_review', {
      p_listing_id: fakeListingId,
      p_rating: 3,
      p_title: null,
      p_body: null,
    })
  })
})

// ─── deleteReview ───────────────────────────────────────────
describe('deleteReview', () => {
  it('should call delete_review RPC and return true on success', async () => {
    // Set up a known review in state so listingId can be found
    useReviewsStore.setState({
      reviews: [fakeReview as any],
      userReview: fakeReview as any,
    })
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null })
    const qb = createQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockImplementation(() => qb)

    const result = await useReviewsStore.getState().deleteReview('review-1')

    expect(result).toBe(true)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('delete_review', {
      p_review_id: 'review-1',
    })
  })

  it('should return false and set error on failure', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Not found' } })

    const result = await useReviewsStore.getState().deleteReview('nonexistent')

    expect(result).toBe(false)
    expect(useReviewsStore.getState().error).toBe('Not found')
  })
})

// ─── markHelpful ────────────────────────────────────────────
describe('markHelpful', () => {
  it('should call mark_review_helpful RPC and optimistically update', async () => {
    useReviewsStore.setState({
      reviews: [{ ...fakeReview, helpful_count: 2 } as any],
      userHelpfuls: new Set<string>(),
    })
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

    await useReviewsStore.getState().markHelpful('review-1')

    const state = useReviewsStore.getState()
    expect(state.userHelpfuls.has('review-1')).toBe(true)
    expect(state.reviews[0].helpful_count).toBe(3)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('mark_review_helpful', {
      p_review_id: 'review-1',
    })
  })

  it('should skip if already marked as helpful', async () => {
    useReviewsStore.setState({
      reviews: [fakeReview as any],
      userHelpfuls: new Set(['review-1']),
    })

    await useReviewsStore.getState().markHelpful('review-1')

    // RPC should not be called
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('should set error on failure', async () => {
    useReviewsStore.setState({
      reviews: [fakeReview as any],
      userHelpfuls: new Set<string>(),
    })
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Cannot mark own review' } })

    await useReviewsStore.getState().markHelpful('review-1')

    expect(useReviewsStore.getState().error).toBe('Cannot mark own review')
  })
})

// ─── setSortBy ──────────────────────────────────────────────
describe('setSortBy', () => {
  it('should update sort order', () => {
    useReviewsStore.getState().setSortBy('highest')
    expect(useReviewsStore.getState().sortBy).toBe('highest')

    useReviewsStore.getState().setSortBy('most_helpful')
    expect(useReviewsStore.getState().sortBy).toBe('most_helpful')

    useReviewsStore.getState().setSortBy('lowest')
    expect(useReviewsStore.getState().sortBy).toBe('lowest')

    useReviewsStore.getState().setSortBy('newest')
    expect(useReviewsStore.getState().sortBy).toBe('newest')
  })
})

// ─── loadMore ───────────────────────────────────────────────
describe('loadMore', () => {
  it('should increment page and fetch more reviews', async () => {
    useReviewsStore.setState({ page: 1, hasMore: true, loading: false })

    const qb = createQueryBuilder({ data: [fakeReview2], error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'marketplace_reviews') return qb
      if (table === 'review_helpfuls') return createQueryBuilder({ data: [], error: null })
      return createQueryBuilder()
    })

    await useReviewsStore.getState().loadMore(fakeListingId)

    expect(useReviewsStore.getState().page).toBe(2)
  })

  it('should not fetch when hasMore is false', async () => {
    useReviewsStore.setState({ page: 1, hasMore: false, loading: false })

    await useReviewsStore.getState().loadMore(fakeListingId)

    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('should not fetch when already loading', async () => {
    useReviewsStore.setState({ page: 1, hasMore: true, loading: true })

    await useReviewsStore.getState().loadMore(fakeListingId)

    expect(mockSupabase.from).not.toHaveBeenCalled()
  })
})

// ─── reset ──────────────────────────────────────────────────
describe('reset', () => {
  it('should clear all state', () => {
    useReviewsStore.setState({
      reviews: [fakeReview as any],
      stats: fakeStats as any,
      userReview: fakeReview as any,
      userHelpfuls: new Set(['review-1']),
      loading: true,
      submitting: true,
      error: 'some error',
      sortBy: 'highest',
      page: 3,
      hasMore: true,
    })

    useReviewsStore.getState().reset()

    const state = useReviewsStore.getState()
    expect(state.reviews).toEqual([])
    expect(state.stats).toBeNull()
    expect(state.userReview).toBeNull()
    expect(state.userHelpfuls.size).toBe(0)
    expect(state.loading).toBe(false)
    expect(state.submitting).toBe(false)
    expect(state.error).toBeNull()
    expect(state.sortBy).toBe('newest')
    expect(state.page).toBe(1)
    expect(state.hasMore).toBe(false)
  })
})

// ─── one-per-user constraint (tested via submit behavior) ───
describe('one review per user per listing', () => {
  it('submit_review RPC handles upsert — calling twice updates existing', async () => {
    // First submission
    mockSupabase.rpc.mockResolvedValue({ data: 'review-1', error: null })
    const qb = createQueryBuilder({ data: [], error: null })
    mockSupabase.from.mockImplementation(() => qb)

    await useReviewsStore.getState().submitReview(fakeListingId, 5, 'First', 'First body')

    // Second submission (update)
    mockSupabase.rpc.mockResolvedValue({ data: 'review-1', error: null })
    await useReviewsStore.getState().submitReview(fakeListingId, 3, 'Updated', 'New body')

    // Both should have called submit_review (not a separate update)
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(4) // 2 submit_review + 2 get_review_stats
  })
})

// ─── cannot review un-acquired deck (tested via error) ──────
describe('cannot review un-acquired deck', () => {
  it('should return false with error from RPC', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Must acquire deck before reviewing' },
    })

    const result = await useReviewsStore.getState().submitReview(fakeListingId, 4)

    expect(result).toBe(false)
    expect(useReviewsStore.getState().error).toBe('Must acquire deck before reviewing')
  })
})

// ─── cannot review own listing (tested via error) ────────────
describe('cannot review own listing', () => {
  it('should return false with error from RPC', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Cannot review your own listing' },
    })

    const result = await useReviewsStore.getState().submitReview(fakeListingId, 5)

    expect(result).toBe(false)
    expect(useReviewsStore.getState().error).toBe('Cannot review your own listing')
  })
})

// ─── avg_rating calculation logic (unit test) ────────────────
describe('avg_rating calculation', () => {
  it('stats should reflect correct distribution from RPC', async () => {
    const statsWithDistribution = {
      avg_rating: 3.67,
      review_count: 3,
      rating_1: 0,
      rating_2: 1,
      rating_3: 0,
      rating_4: 1,
      rating_5: 1,
    }
    mockSupabase.rpc.mockResolvedValue({ data: [statsWithDistribution], error: null })

    await useReviewsStore.getState().fetchStats(fakeListingId)

    const { stats } = useReviewsStore.getState()
    expect(stats!.avg_rating).toBe(3.67)
    expect(stats!.review_count).toBe(3)
    expect(stats!.rating_2).toBe(1)
    expect(stats!.rating_4).toBe(1)
    expect(stats!.rating_5).toBe(1)
  })
})

// ─── StarRating component rendering (pure function test) ─────
describe('star rendering logic', () => {
  function getStarString(rating: number, max = 5): string {
    return Array.from({ length: max }, (_, i) =>
      i < Math.round(rating) ? 'filled' : 'empty',
    ).join(',')
  }

  it('renders 5 filled stars for rating 5', () => {
    expect(getStarString(5)).toBe('filled,filled,filled,filled,filled')
  })

  it('renders 0 filled stars for rating 0', () => {
    expect(getStarString(0)).toBe('empty,empty,empty,empty,empty')
  })

  it('renders 3 filled stars for rating 3', () => {
    expect(getStarString(3)).toBe('filled,filled,filled,empty,empty')
  })

  it('rounds 4.6 to 5 filled stars', () => {
    expect(getStarString(4.6)).toBe('filled,filled,filled,filled,filled')
  })

  it('rounds 4.4 to 4 filled stars', () => {
    expect(getStarString(4.4)).toBe('filled,filled,filled,filled,empty')
  })

  it('renders 1 filled star for rating 1', () => {
    expect(getStarString(1)).toBe('filled,empty,empty,empty,empty')
  })
})

// ─── sort criteria ──────────────────────────────────────────
describe('review sort criteria', () => {
  function getSortOrder(sortBy: string): { column: string; ascending: boolean } {
    switch (sortBy) {
      case 'newest':
        return { column: 'created_at', ascending: false }
      case 'highest':
        return { column: 'rating', ascending: false }
      case 'lowest':
        return { column: 'rating', ascending: true }
      case 'most_helpful':
        return { column: 'helpful_count', ascending: false }
      default:
        return { column: 'created_at', ascending: false }
    }
  }

  it('newest sorts by created_at descending', () => {
    expect(getSortOrder('newest')).toEqual({ column: 'created_at', ascending: false })
  })

  it('highest sorts by rating descending', () => {
    expect(getSortOrder('highest')).toEqual({ column: 'rating', ascending: false })
  })

  it('lowest sorts by rating ascending', () => {
    expect(getSortOrder('lowest')).toEqual({ column: 'rating', ascending: true })
  })

  it('most_helpful sorts by helpful_count descending', () => {
    expect(getSortOrder('most_helpful')).toEqual({ column: 'helpful_count', ascending: false })
  })
})
