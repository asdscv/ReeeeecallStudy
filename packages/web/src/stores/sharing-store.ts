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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // Find the pending share by invite_code
    const { data: share, error: findError } = await supabase
      .from('deck_shares')
      .select('*')
      .eq('invite_code', inviteCode)
      .eq('status', 'pending')
      .single()

    if (findError || !share) {
      set({ error: 'errors:sharing.invalidOrExpired' })
      return null
    }

    const typedShare = share as DeckShare

    if (typedShare.owner_id === user.id) {
      set({ error: 'errors:sharing.cannotAcceptOwn' })
      return null
    }

    if (typedShare.share_mode === 'subscribe') {
      // Create subscription: just update the share status + add recipient
      const { error: updateError } = await supabase
        .from('deck_shares')
        .update({
          recipient_id: user.id,
          status: 'active',
          accepted_at: new Date().toISOString(),
        } as Record<string, unknown>)
        .eq('id', typedShare.id)

      if (updateError) {
        set({ error: updateError.message })
        return null
      }

      // Initialize subscriber progress
      await supabase.rpc('init_subscriber_progress', {
        p_user_id: user.id,
        p_deck_id: typedShare.deck_id,
      } as Record<string, unknown>)

      await get().fetchSharedWithMe()
      return { deckId: typedShare.deck_id }
    } else {
      // Copy or snapshot: use RPC to copy deck
      const isReadonly = typedShare.share_mode === 'snapshot'
      const { data: newDeckId, error: rpcError } = await supabase.rpc('copy_deck_for_user', {
        p_source_deck_id: typedShare.deck_id,
        p_recipient_id: user.id,
        p_is_readonly: isReadonly,
        p_share_mode: typedShare.share_mode,
      } as Record<string, unknown>)

      if (rpcError) {
        set({ error: rpcError.message })
        return null
      }

      // Update share status
      await supabase
        .from('deck_shares')
        .update({
          recipient_id: user.id,
          status: 'active',
          accepted_at: new Date().toISOString(),
          copied_deck_id: newDeckId,
        } as Record<string, unknown>)
        .eq('id', typedShare.id)

      await get().fetchSharedWithMe()
      return { deckId: newDeckId as string }
    }
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
