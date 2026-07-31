import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { filterListings, sortListings, type SortBy, type ListingFilters, type MarketplaceListingData } from '../lib/marketplace'
import { useDeckStore } from './deck-store'
import { isCardLimitError } from '@reeeeecall/shared/stores/card-store'
import { createStaleCache } from '@reeeeecall/shared/lib/cache/stale-cache'
import type { MarketplaceListing, ShareMode } from '../types/database'

// Public catalog read cache — see DOCS/TODO/cache-optimization-phase2.md.
// Read-heavy + benign staleness; invalidated on publish/unpublish, forced on demand.
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

    // owner_display_name / owner_is_official are DENORMALIZED onto marketplace_listings
    // (mig 054), so a plain select returns them — no profiles join is needed. The old
    // `profiles!marketplace_listings_owner_id_fkey(...)` embed 400'd (PGRST200) on EVERY
    // load because that FK targets auth.users, not public.profiles, so it always fell
    // back to this same plain select anyway — just after a wasted failed request.
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

    // Fetch deck's native language + study level to mirror onto the listing
    const { data: deckRow } = await supabase
      .from('decks')
      .select('native_language, native_languages, study_level')
      .eq('id', input.deckId)
      .single()

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
        learning_language: input.learningLanguage ?? null,
        native_language: (deckRow as { native_language?: string | null } | null)?.native_language ?? null,
        native_languages: (deckRow as { native_languages?: string[] | null } | null)?.native_languages ?? null,
        study_level: (deckRow as { study_level?: string | null } | null)?.study_level ?? null,
        card_count: count ?? 0,
        is_active: true,
      } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      set({ error: error.message })
      return null
    }

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
      // copy/snapshot acquire routes through copy_deck_for_user → owned-card limit.
      else if (isCardLimitError(error)) key = 'errors:card.limitReached'
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

    if (row.is_new_acquisition) {
      // Invalidate decks + stats so the newly acquired deck appears with its real
      // card count (get_deck_stats covers subscribed decks) on next focus fetch.
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
