import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { filterListings, sortListings, type SortBy, type ListingFilters, type MarketplaceListingData } from '../lib/marketplace'
import { useDeckStore } from './deck-store'
import { createStaleCache } from '../lib/cache/stale-cache'
import type { MarketplaceListing, ShareMode } from '../types/database'

// The public catalog (fetchListings) is read-heavy and benign to serve slightly
// stale (the viewer doesn't own/edit it). TTL-cache it so re-opening Marketplace
// doesn't refetch every active listing. Invalidated on publish/unpublish; pull-to-
// refresh forces. Freshness is not render state → kept outside the store.
const listingsCache = createStaleCache({ ttlMs: 5 * 60 * 1000 })

interface MarketplaceState {
  listings: MarketplaceListing[]
  myListings: MarketplaceListing[]
  loading: boolean
  error: string | null
  filters: ListingFilters & { sortBy: SortBy }

  fetchListings: (opts?: { force?: boolean }) => Promise<void>
  fetchMyListings: () => Promise<void>
  publishDeck: (data: {
    deckId: string
    title: string
    description?: string
    tags?: string[]
    category?: string
    shareMode: ShareMode
    learningLanguage?: string
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

  fetchListings: async (opts) => {
    if (!listingsCache.shouldFetch('listings', opts)) return
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
      listingsCache.markFetched('listings')
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
        learning_language: input.learningLanguage ?? null,
        is_active: true,
      } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      set({ error: error.message })
      return null
    }

    // New listing changes the public catalog → drop its cache so it refetches.
    listingsCache.invalidate('listings')
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

    listingsCache.invalidate('listings')
    await get().fetchMyListings()
    await get().fetchListings({ force: true })
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
    // Invalidate decks + stats so the newly acquired deck shows up with its real
    // card count (get_deck_stats covers subscribed decks) instead of 0 on next focus.
    if (row.is_new_acquisition) {
      const deckStore = useDeckStore.getState()
      deckStore.invalidate('decks')
      deckStore.invalidate('stats')
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
