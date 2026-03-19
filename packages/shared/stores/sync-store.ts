import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { DeckChangeLogEntry, SyncResult } from '../types/database'

interface SyncState {
  /** Pending change counts per deck_id */
  pendingCounts: Record<string, number>
  /** Last sync results per deck_id */
  lastSyncResults: Record<string, SyncResult>
  /** Loading state per deck_id */
  syncing: Record<string, boolean>
  /** Global loading for syncAll */
  syncingAll: boolean
  error: string | null

  /**
   * Sync a single subscribed deck.
   * Calls the `sync_subscriber_deck` RPC and returns the result.
   */
  syncSubscribedDeck: (deckId: string) => Promise<SyncResult | null>

  /**
   * Sync all active subscriptions for the current user.
   */
  syncAllSubscriptions: () => Promise<void>

  /**
   * Fetch the number of pending changes for a subscribed deck.
   */
  fetchPendingCount: (deckId: string) => Promise<number>

  /**
   * Fetch pending counts for all active subscriptions.
   */
  fetchAllPendingCounts: () => Promise<void>

  /**
   * Fetch the change log for a deck since a given timestamp.
   */
  getChangeLog: (deckId: string, since?: string) => Promise<DeckChangeLogEntry[]>
}

export const useSyncStore = create<SyncState>((set, get) => ({
  pendingCounts: {},
  lastSyncResults: {},
  syncing: {},
  syncingAll: false,
  error: null,

  syncSubscribedDeck: async (deckId: string) => {
    set((s) => ({
      syncing: { ...s.syncing, [deckId]: true },
      error: null,
    }))

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      set((s) => ({ syncing: { ...s.syncing, [deckId]: false } }))
      return null
    }

    const { data, error } = await supabase.rpc('sync_subscriber_deck', {
      p_user_id: user.id,
      p_deck_id: deckId,
    } as Record<string, unknown>)

    if (error) {
      set((s) => ({
        syncing: { ...s.syncing, [deckId]: false },
        error: error.message,
      }))
      return null
    }

    const result = data as unknown as SyncResult
    set((s) => ({
      syncing: { ...s.syncing, [deckId]: false },
      lastSyncResults: { ...s.lastSyncResults, [deckId]: result },
      pendingCounts: { ...s.pendingCounts, [deckId]: 0 },
    }))
    return result
  },

  syncAllSubscriptions: async () => {
    set({ syncingAll: true, error: null })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      set({ syncingAll: false })
      return
    }

    // Get all active subscriptions
    const { data: shares, error: sharesError } = await supabase
      .from('deck_shares')
      .select('deck_id')
      .eq('recipient_id', user.id)
      .eq('share_mode', 'subscribe')
      .eq('status', 'active')

    if (sharesError || !shares) {
      set({ syncingAll: false, error: sharesError?.message ?? 'Failed to fetch subscriptions' })
      return
    }

    const { syncSubscribedDeck } = get()
    await Promise.all(
      (shares as { deck_id: string }[]).map((s) => syncSubscribedDeck(s.deck_id))
    )

    set({ syncingAll: false })
  },

  fetchPendingCount: async (deckId: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 0

    const { data, error } = await supabase.rpc('get_pending_sync_count', {
      p_user_id: user.id,
      p_deck_id: deckId,
    } as Record<string, unknown>)

    if (error) return 0

    const count = (data as number) ?? 0
    set((s) => ({
      pendingCounts: { ...s.pendingCounts, [deckId]: count },
    }))
    return count
  },

  fetchAllPendingCounts: async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: shares } = await supabase
      .from('deck_shares')
      .select('deck_id')
      .eq('recipient_id', user.id)
      .eq('share_mode', 'subscribe')
      .eq('status', 'active')

    if (!shares) return

    const { fetchPendingCount } = get()
    await Promise.all(
      (shares as { deck_id: string }[]).map((s) => fetchPendingCount(s.deck_id))
    )
  },

  getChangeLog: async (deckId: string, since?: string) => {
    let query = supabase
      .from('deck_change_log')
      .select('*')
      .eq('deck_id', deckId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (since) {
      query = query.gt('created_at', since)
    }

    const { data, error } = await query
    if (error) return []
    return (data ?? []) as DeckChangeLogEntry[]
  },
}))
