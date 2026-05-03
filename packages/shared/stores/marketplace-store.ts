import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { filterListings, sortListings, type SortBy, type ListingFilters, type MarketplaceListingData } from '../lib/marketplace'
import { useDeckStore } from './deck-store'
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
  acquireDeck: (listingId: string) => Promise<{ deckId: string; wasNew: boolean } | null>
  setFilters: (filters: Partial<ListingFilters & { sortBy: SortBy }>) => void
  resetFilters: () => void
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
    // Single atomic RPC call — see DOCS/DESIGN/MARKETPLACE_ACQUIRE/DESIGN.md
    // Server enforces: auth, ownership check, idempotency, transaction.
    set({ error: null })

    const { data, error } = await supabase.rpc('acquire_listing', {
      p_listing_id: listingId,
    } as Record<string, unknown>)

    if (error) {
      const hint = (error as { hint?: string }).hint
      const code = (error as { code?: string }).code
      let key = 'errors:marketplace.acquireFailed'
      if (hint === 'cannot_acquire_own' || code === 'P0001') key = 'errors:marketplace.cannotImportOwn'
      else if (hint === 'listing_not_found' || code === 'P0002') key = 'errors:marketplace.listingNotFound'
      set({ error: key })
      return null
    }

    const row = Array.isArray(data)
      ? (data[0] as { acquired_deck_id?: string; is_new_acquisition?: boolean } | undefined)
      : null
    if (!row?.acquired_deck_id) {
      set({ error: 'errors:marketplace.acquireFailed' })
      return null
    }

    // Only invalidate cache when something actually changed.
    // Idempotent re-acquire keeps cache warm.
    if (row.is_new_acquisition) {
      useDeckStore.setState({ decksFetchedAt: null })
    }

    return { deckId: row.acquired_deck_id, wasNew: !!row.is_new_acquisition }
  },

  setFilters: (filters) => {
    set((state) => ({
      filters: { ...state.filters, ...filters },
    }))
  },

  resetFilters: () => {
    set({ filters: { sortBy: 'newest' } })
  },

  getFilteredListings: () => {
    const { listings, filters } = get()
    const filtered = filterListings(listings as MarketplaceListingData[], filters)
    return sortListings(filtered, filters.sortBy) as MarketplaceListing[]
  },
}))
