import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { filterListings, sortListings, type SortBy, type ListingFilters, type MarketplaceListingData } from '../lib/marketplace'
import type { MarketplaceListing, ShareMode } from '../types/database'

interface MarketplaceState {
  listings: MarketplaceListing[]
  myListings: MarketplaceListing[]
  loading: boolean
  error: string | null
  filters: ListingFilters & { sortBy: SortBy }

  fetchListings: () => Promise<void>
  fetchMyListings: () => Promise<void>
  publishDeck: (data: {
    deckId: string
    title: string
    description?: string
    tags?: string[]
    category?: string
    shareMode: ShareMode
  }) => Promise<MarketplaceListing | null>
  unpublishDeck: (listingId: string) => Promise<void>
  acquireDeck: (listingId: string) => Promise<{ deckId: string } | null>
  setFilters: (filters: Partial<ListingFilters & { sortBy: SortBy }>) => void
  getFilteredListings: () => MarketplaceListing[]
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  listings: [],
  myListings: [],
  loading: false,
  error: null,
  filters: { sortBy: 'newest' },

  fetchListings: async () => {
    set({ loading: true, error: null })

    const { data, error } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      set({ error: error.message, loading: false })
    } else {
      set({ listings: (data ?? []) as MarketplaceListing[], loading: false })
    }
  },

  fetchMyListings: async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      set({ error: error.message })
    } else {
      set({ myListings: (data ?? []) as MarketplaceListing[] })
    }
  },

  publishDeck: async (input) => {
    set({ error: null })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // Get card count
    const { count } = await supabase
      .from('cards')
      .select('*', { count: 'exact', head: true })
      .eq('deck_id', input.deckId)

    const { data, error } = await supabase
      .from('marketplace_listings')
      .insert({
        deck_id: input.deckId,
        owner_id: user.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        tags: input.tags || [],
        category: input.category || 'general',
        share_mode: input.shareMode,
        card_count: count ?? 0,
        is_active: true,
      } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      set({ error: error.message })
      return null
    }

    await get().fetchMyListings()
    return data as MarketplaceListing
  },

  unpublishDeck: async (listingId: string) => {
    const { error } = await supabase
      .from('marketplace_listings')
      .update({ is_active: false } as Record<string, unknown>)
      .eq('id', listingId)

    if (error) {
      set({ error: error.message })
      return
    }

    await get().fetchMyListings()
    await get().fetchListings()
  },

  acquireDeck: async (listingId: string) => {
    set({ error: null })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // Get listing details
    const { data: listing, error: listingError } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('id', listingId)
      .single()

    if (listingError || !listing) {
      set({ error: '리스팅을 찾을 수 없습니다.' })
      return null
    }

    const typedListing = listing as MarketplaceListing

    if (typedListing.owner_id === user.id) {
      set({ error: '자신의 덱은 가져올 수 없습니다.' })
      return null
    }

    if (typedListing.share_mode === 'subscribe') {
      // Create a subscription share
      const { error: shareError } = await supabase
        .from('deck_shares')
        .insert({
          deck_id: typedListing.deck_id,
          owner_id: typedListing.owner_id,
          recipient_id: user.id,
          share_mode: 'subscribe',
          status: 'active',
          accepted_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .select()
        .single()

      if (shareError) {
        set({ error: shareError.message })
        return null
      }

      // Initialize progress
      await supabase.rpc('init_subscriber_progress', {
        p_user_id: user.id,
        p_deck_id: typedListing.deck_id,
      } as Record<string, unknown>)

      // Increment acquire count
      await supabase.rpc('increment_acquire_count', {
        p_listing_id: listingId,
      } as Record<string, unknown>)

      return { deckId: typedListing.deck_id }
    } else {
      // Copy or snapshot
      const isReadonly = typedListing.share_mode === 'snapshot'
      const { data: newDeckId, error: rpcError } = await supabase.rpc('copy_deck_for_user', {
        p_source_deck_id: typedListing.deck_id,
        p_recipient_id: user.id,
        p_is_readonly: isReadonly,
        p_share_mode: typedListing.share_mode,
      } as Record<string, unknown>)

      if (rpcError) {
        set({ error: rpcError.message })
        return null
      }

      // Create share record for tracking
      await supabase
        .from('deck_shares')
        .insert({
          deck_id: typedListing.deck_id,
          owner_id: typedListing.owner_id,
          recipient_id: user.id,
          share_mode: typedListing.share_mode,
          status: 'active',
          accepted_at: new Date().toISOString(),
          copied_deck_id: newDeckId,
        } as Record<string, unknown>)

      // Increment acquire count
      await supabase.rpc('increment_acquire_count', {
        p_listing_id: listingId,
      } as Record<string, unknown>)

      return { deckId: newDeckId as string }
    }
  },

  setFilters: (filters) => {
    set((state) => ({
      filters: { ...state.filters, ...filters },
    }))
  },

  getFilteredListings: () => {
    const { listings, filters } = get()
    const filtered = filterListings(listings as MarketplaceListingData[], {
      category: filters.category,
      tags: filters.tags,
      query: filters.query,
    })
    return sortListings(filtered, filters.sortBy) as MarketplaceListing[]
  },
}))
