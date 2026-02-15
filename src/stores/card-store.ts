import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Card } from '../types/database'

interface CardState {
  cards: Card[]
  loading: boolean
  error: string | null

  fetchCards: (deckId: string) => Promise<void>
  createCard: (data: {
    deck_id: string
    template_id: string
    field_values: Record<string, string>
    tags?: string[]
  }) => Promise<Card | null>
  updateCard: (id: string, data: {
    field_values?: Record<string, string>
    tags?: string[]
    srs_status?: string
  }) => Promise<void>
  deleteCard: (id: string) => Promise<void>
  deleteCards: (ids: string[]) => Promise<void>
  resetSRS: (id: string) => Promise<void>
}

export const useCardStore = create<CardState>((set, get) => ({
  cards: [],
  loading: false,
  error: null,

  fetchCards: async (deckId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('deck_id', deckId)
      .order('sort_position', { ascending: true })

    if (error) {
      set({ error: error.message, loading: false })
    } else {
      set({ cards: (data ?? []) as Card[], loading: false })
    }
  },

  createCard: async (input) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // 현재 덱의 next_position 가져오기
    const { data: deck } = await supabase
      .from('decks')
      .select('next_position')
      .eq('id', input.deck_id)
      .single()

    const position = (deck as { next_position: number } | null)?.next_position ?? 0

    const { data: card, error } = await supabase
      .from('cards')
      .insert({
        deck_id: input.deck_id,
        user_id: user.id,
        template_id: input.template_id,
        field_values: input.field_values,
        tags: input.tags || [],
        sort_position: position,
        srs_status: 'new',
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 0,
      } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      set({ error: error.message })
      return null
    }

    // next_position 증가
    await supabase
      .from('decks')
      .update({ next_position: position + 1 } as Record<string, unknown>)
      .eq('id', input.deck_id)

    await get().fetchCards(input.deck_id)
    return card as Card
  },

  updateCard: async (id, data) => {
    const { error } = await supabase
      .from('cards')
      .update(data as Record<string, unknown>)
      .eq('id', id)

    if (error) {
      set({ error: error.message })
      return
    }

    // 현재 카드 목록에서 해당 카드의 deck_id를 찾아 갱신
    const card = get().cards.find((c) => c.id === id)
    if (card) {
      await get().fetchCards(card.deck_id)
    }
  },

  deleteCard: async (id) => {
    const card = get().cards.find((c) => c.id === id)
    const { error } = await supabase
      .from('cards')
      .delete()
      .eq('id', id)

    if (error) {
      set({ error: error.message })
      return
    }

    if (card) {
      await get().fetchCards(card.deck_id)
    }
  },

  deleteCards: async (ids) => {
    if (ids.length === 0) return
    const deckId = get().cards.find((c) => ids.includes(c.id))?.deck_id

    const { error } = await supabase
      .from('cards')
      .delete()
      .in('id', ids)

    if (error) {
      set({ error: error.message })
      return
    }

    if (deckId) {
      await get().fetchCards(deckId)
    }
  },

  resetSRS: async (id) => {
    const { error } = await supabase
      .from('cards')
      .update({
        srs_status: 'new',
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 0,
        next_review_at: null,
        last_reviewed_at: null,
      } as Record<string, unknown>)
      .eq('id', id)

    if (error) {
      set({ error: error.message })
      return
    }

    const card = get().cards.find((c) => c.id === id)
    if (card) {
      await get().fetchCards(card.deck_id)
    }
  },
}))
