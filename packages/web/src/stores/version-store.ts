import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { DeckVersion } from '../types/database'

interface VersionState {
  versions: DeckVersion[]
  loading: boolean
  error: string | null
  creating: boolean

  fetchVersions: (deckId: string) => Promise<void>
  createVersion: (deckId: string, changeSummary?: string) => Promise<{ id: string } | null>
  reset: () => void
}

export const useVersionStore = create<VersionState>((set, get) => ({
  versions: [],
  loading: false,
  error: null,
  creating: false,

  fetchVersions: async (deckId) => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const { data, error } = await supabase.rpc('get_deck_versions', {
        p_deck_id: deckId,
      } as Record<string, unknown>)

      if (error) throw error

      set({ versions: (data ?? []) as DeckVersion[], loading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to fetch versions'
      set({ error: msg, loading: false })
    }
  },

  createVersion: async (deckId, changeSummary) => {
    set({ creating: true, error: null })
    try {
      const { data, error } = await supabase.rpc('create_deck_version', {
        p_deck_id: deckId,
        p_change_summary: changeSummary ?? null,
      } as Record<string, unknown>)

      if (error) throw error

      // Refresh the list
      await get().fetchVersions(deckId)
      set({ creating: false })
      return { id: data as string }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create version'
      set({ error: msg, creating: false })
      return null
    }
  },

  reset: () => set({ versions: [], loading: false, error: null, creating: false }),
}))
