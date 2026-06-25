import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { generateInviteCode } from '../lib/invite'
import type { DeckShare, ShareMode } from '../types/database'

interface SharingState {
  myShares: DeckShare[]
  sharedWithMe: DeckShare[]
  loading: boolean
  error: string | null

  fetchMyShares: () => Promise<void>
  fetchSharedWithMe: () => Promise<void>
  createShare: (options: {
    deckId: string
    mode: ShareMode
    recipientEmail?: string
    generateLink?: boolean
  }) => Promise<DeckShare | null>
  acceptInvite: (inviteCode: string) => Promise<{ deckId: string } | null>
  revokeShare: (shareId: string) => Promise<void>
  unsubscribe: (shareId: string) => Promise<void>
}

export const useSharingStore = create<SharingState>((set, get) => ({
  myShares: [],
  sharedWithMe: [],
  loading: false,
  error: null,

  fetchMyShares: async () => {
    set({ loading: true, error: null })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { set({ loading: false }); return }

    const { data, error } = await supabase
      .from('deck_shares')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      set({ error: error.message, loading: false })
    } else {
      set({ myShares: (data ?? []) as DeckShare[], loading: false })
    }
  },

  fetchSharedWithMe: async () => {
    set({ loading: true, error: null })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { set({ loading: false }); return }

    const { data, error } = await supabase
      .from('deck_shares')
      .select('*')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      set({ error: error.message, loading: false })
    } else {
      set({ sharedWithMe: (data ?? []) as DeckShare[], loading: false })
    }
  },

  createShare: async (options) => {
    set({ error: null })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const inviteCode = options.generateLink ? generateInviteCode() : null

    const { data, error } = await supabase
      .from('deck_shares')
      .insert({
        deck_id: options.deckId,
        owner_id: user.id,
        share_mode: options.mode,
        invite_code: inviteCode,
        invite_email: options.recipientEmail || null,
        status: 'pending',
      } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      set({ error: error.message })
      return null
    }

    await get().fetchMyShares()
    return data as DeckShare
  },

  acceptInvite: async (inviteCode: string) => {
    set({ error: null })
    // Whole accept runs server-side in accept_invite() (SECURITY DEFINER): it
    // validates the code, claims the pending share for the caller, and copies /
    // subscribes — so the client no longer needs blanket SELECT on pending
    // deck_shares (that over-broad anon policy leaked every invite token and was
    // dropped in migration 094).
    const { data, error } = await supabase.rpc('accept_invite', {
      p_code: inviteCode,
    } as Record<string, unknown>)

    if (error) {
      set({ error: error.message })
      return null
    }

    await get().fetchSharedWithMe()
    const deckId = (data as { deck_id?: string } | null)?.deck_id
    return deckId ? { deckId } : null
  },

  revokeShare: async (shareId: string) => {
    const { error } = await supabase
      .from('deck_shares')
      .update({ status: 'revoked' } as Record<string, unknown>)
      .eq('id', shareId)

    if (error) {
      set({ error: error.message })
      return
    }

    await get().fetchMyShares()
  },

  unsubscribe: async (shareId: string) => {
    const { error } = await supabase
      .from('deck_shares')
      .update({ status: 'revoked' } as Record<string, unknown>)
      .eq('id', shareId)

    if (error) {
      set({ error: error.message })
      return
    }

    await get().fetchSharedWithMe()
  },
}))
