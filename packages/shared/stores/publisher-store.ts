import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// ── Types ──

export interface PublisherListingStats {
  id: string
  title: string
  is_active: boolean
  view_count: number
  acquire_count: number
  card_count: number
  share_mode: string
  category: string
  avg_rating: number
  review_count: number
  created_at: string
  conversion_rate: number
}

export interface DailyViewData {
  date: string
  views: number
  unique_viewers: number
}

export interface DailyAcquireData {
  date: string
  acquires: number
}

export interface TopListing {
  id: string
  title: string
  view_count: number
}

export interface RecentAcquire {
  id: string
  deck_title: string
  user_name: string | null
  accepted_at: string
}

export interface RecentReview {
  id: string
  rating: number
  title: string | null
  body: string | null
  created_at: string
  deck_title: string
  user_name: string | null
}

export interface PublisherStats {
  total_listings: number
  total_views: number
  total_acquires: number
  avg_conversion_rate: number
  listings: PublisherListingStats[]
  daily_views: DailyViewData[]
  daily_acquires: DailyAcquireData[]
  top_listings: TopListing[]
  recent_acquires: RecentAcquire[]
  recent_reviews: RecentReview[]
}

export interface ListingDetailStats {
  total_views: number
  total_acquires: number
  conversion_rate: number
  daily_views: DailyViewData[]
  avg_rating: number
  review_count: number
}

// ── Store ──

interface PublisherState {
  stats: PublisherStats | null
  listingStats: Record<string, ListingDetailStats>
  loading: boolean
  error: string | null
  hasListings: boolean | null  // null = not yet checked

  fetchPublisherStats: () => Promise<void>
  fetchListingStats: (listingId: string) => Promise<void>
  checkHasListings: () => Promise<void>
}

export const usePublisherStore = create<PublisherState>((set, _get) => ({
  stats: null,
  listingStats: {},
  loading: false,
  error: null,
  hasListings: null,

  checkHasListings: async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      set({ hasListings: false })
      return
    }

    const { count } = await supabase
      .from('marketplace_listings')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', user.id)

    set({ hasListings: (count ?? 0) > 0 })
  },

  fetchPublisherStats: async () => {
    set({ loading: true, error: null })

    const { data, error } = await supabase.rpc('get_publisher_stats')

    if (error) {
      set({ error: error.message, loading: false })
      return
    }

    const stats = data as PublisherStats
    set({
      stats,
      loading: false,
      hasListings: (stats?.total_listings ?? 0) > 0 || (stats?.listings?.length ?? 0) > 0,
    })
  },

  fetchListingStats: async (listingId: string) => {
    const { data, error } = await supabase.rpc('get_listing_stats', {
      p_listing_id: listingId,
    } as Record<string, unknown>)

    if (error) {
      set({ error: error.message })
      return
    }

    const detail = data as ListingDetailStats
    set((state) => ({
      listingStats: {
        ...state.listingStats,
        [listingId]: detail,
      },
    }))
  },
}))
