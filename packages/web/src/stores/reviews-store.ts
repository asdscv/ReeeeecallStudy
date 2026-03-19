import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { MarketplaceReview, ReviewStats, ReviewSortBy } from '../types/database'

const REVIEWS_PER_PAGE = 10

interface ReviewsState {
  reviews: MarketplaceReview[]
  stats: ReviewStats | null
  userReview: MarketplaceReview | null
  userHelpfuls: Set<string>
  loading: boolean
  submitting: boolean
  error: string | null
  sortBy: ReviewSortBy
  page: number
  hasMore: boolean

  fetchReviews: (listingId: string, page?: number) => Promise<void>
  fetchStats: (listingId: string) => Promise<void>
  fetchUserReview: (listingId: string) => Promise<void>
  submitReview: (listingId: string, rating: number, title?: string, body?: string) => Promise<boolean>
  deleteReview: (reviewId: string) => Promise<boolean>
  markHelpful: (reviewId: string) => Promise<void>
  setSortBy: (sortBy: ReviewSortBy) => void
  loadMore: (listingId: string) => Promise<void>
  reset: () => void
}

function getSortOrder(sortBy: ReviewSortBy): { column: string; ascending: boolean } {
  switch (sortBy) {
    case 'newest':
      return { column: 'created_at', ascending: false }
    case 'highest':
      return { column: 'rating', ascending: false }
    case 'lowest':
      return { column: 'rating', ascending: true }
    case 'most_helpful':
      return { column: 'helpful_count', ascending: false }
  }
}

export const useReviewsStore = create<ReviewsState>((set, get) => ({
  reviews: [],
  stats: null,
  userReview: null,
  userHelpfuls: new Set(),
  loading: false,
  submitting: false,
  error: null,
  sortBy: 'newest',
  page: 1,
  hasMore: false,

  fetchReviews: async (listingId: string, page = 1) => {
    set({ loading: true, error: null })

    const { sortBy } = get()
    const { column, ascending } = getSortOrder(sortBy)
    const from = (page - 1) * REVIEWS_PER_PAGE
    const to = from + REVIEWS_PER_PAGE - 1

    const { data, error } = await supabase
      .from('marketplace_reviews')
      .select('*, profiles:user_id(display_name)')
      .eq('listing_id', listingId)
      .order(column, { ascending })
      .range(from, to)

    if (error) {
      set({ error: error.message, loading: false })
      return
    }

    const reviews: MarketplaceReview[] = (data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      user_display_name: (r.profiles as { display_name: string | null } | null)?.display_name ?? null,
    })) as MarketplaceReview[]

    // Fetch user's helpful votes for these reviews
    const { data: { user } } = await supabase.auth.getUser()
    let helpfuls = new Set<string>()
    if (user && reviews.length > 0) {
      const reviewIds = reviews.map((r) => r.id)
      const { data: helpfulData } = await supabase
        .from('review_helpfuls')
        .select('review_id')
        .eq('user_id', user.id)
        .in('review_id', reviewIds)
      if (helpfulData) {
        helpfuls = new Set(helpfulData.map((h: { review_id: string }) => h.review_id))
      }
    }

    if (page === 1) {
      set({
        reviews,
        userHelpfuls: helpfuls,
        page: 1,
        hasMore: reviews.length === REVIEWS_PER_PAGE,
        loading: false,
      })
    } else {
      set((state) => ({
        reviews: [...state.reviews, ...reviews],
        userHelpfuls: new Set([...state.userHelpfuls, ...helpfuls]),
        page,
        hasMore: reviews.length === REVIEWS_PER_PAGE,
        loading: false,
      }))
    }
  },

  fetchStats: async (listingId: string) => {
    const { data, error } = await supabase.rpc('get_review_stats', {
      p_listing_id: listingId,
    } as Record<string, unknown>)

    if (error || !data) return

    const row = Array.isArray(data) ? data[0] : data
    if (row) {
      set({
        stats: {
          avg_rating: Number(row.avg_rating) || 0,
          review_count: Number(row.review_count) || 0,
          rating_1: Number(row.rating_1) || 0,
          rating_2: Number(row.rating_2) || 0,
          rating_3: Number(row.rating_3) || 0,
          rating_4: Number(row.rating_4) || 0,
          rating_5: Number(row.rating_5) || 0,
        },
      })
    }
  },

  fetchUserReview: async (listingId: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      set({ userReview: null })
      return
    }

    const { data } = await supabase
      .from('marketplace_reviews')
      .select('*')
      .eq('listing_id', listingId)
      .eq('user_id', user.id)
      .maybeSingle()

    set({ userReview: data as MarketplaceReview | null })
  },

  submitReview: async (listingId: string, rating: number, title?: string, body?: string) => {
    set({ submitting: true, error: null })

    const { error } = await supabase.rpc('submit_review', {
      p_listing_id: listingId,
      p_rating: rating,
      p_title: title || null,
      p_body: body || null,
    } as Record<string, unknown>)

    if (error) {
      set({ error: error.message, submitting: false })
      return false
    }

    set({ submitting: false })

    await Promise.all([
      get().fetchReviews(listingId),
      get().fetchStats(listingId),
      get().fetchUserReview(listingId),
    ])

    return true
  },

  deleteReview: async (reviewId: string) => {
    set({ error: null })

    const review = get().reviews.find((r) => r.id === reviewId) ?? get().userReview
    const listingId = review?.listing_id

    const { error } = await supabase.rpc('delete_review', {
      p_review_id: reviewId,
    } as Record<string, unknown>)

    if (error) {
      set({ error: error.message })
      return false
    }

    if (listingId) {
      await Promise.all([
        get().fetchReviews(listingId),
        get().fetchStats(listingId),
        get().fetchUserReview(listingId),
      ])
    }

    return true
  },

  markHelpful: async (reviewId: string) => {
    const { userHelpfuls } = get()
    if (userHelpfuls.has(reviewId)) return

    const { error } = await supabase.rpc('mark_review_helpful', {
      p_review_id: reviewId,
    } as Record<string, unknown>)

    if (error) {
      set({ error: error.message })
      return
    }

    set((state) => ({
      userHelpfuls: new Set([...state.userHelpfuls, reviewId]),
      reviews: state.reviews.map((r) =>
        r.id === reviewId ? { ...r, helpful_count: r.helpful_count + 1 } : r,
      ),
    }))
  },

  setSortBy: (sortBy: ReviewSortBy) => {
    set({ sortBy })
  },

  loadMore: async (listingId: string) => {
    const { page, hasMore, loading } = get()
    if (!hasMore || loading) return
    await get().fetchReviews(listingId, page + 1)
  },

  reset: () => {
    set({
      reviews: [],
      stats: null,
      userReview: null,
      userHelpfuls: new Set(),
      loading: false,
      submitting: false,
      error: null,
      sortBy: 'newest',
      page: 1,
      hasMore: false,
    })
  },
}))
