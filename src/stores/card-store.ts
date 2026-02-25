import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { guard } from '../lib/rate-limit-instance'
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
  createCards: (data: {
    deck_id: string
    template_id: string
    cards: { field_values: Record<string, string>; tags?: string[] }[]
    onProgress?: (inserted: number, total: number) => void
  }) => Promise<number>
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
    const check = guard.check('card_create', 'cards_total')
    if (!check.allowed) { set({ error: check.message ?? 'errors:card.rateLimitReached' }); return null }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // 현재 덱의 next_position + readonly 체크
    const { data: deck } = await supabase
      .from('decks')
      .select('next_position, is_readonly')
      .eq('id', input.deck_id)
      .single()

    if (deck && (deck as { is_readonly: boolean }).is_readonly) {
      set({ error: 'errors:card.readonlyDeckNoAdd' })
      return null
    }

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

    guard.recordSuccess('cards_total')
    await get().fetchCards(input.deck_id)
    return card as Card
  },

  createCards: async ({ deck_id, template_id, cards, onProgress }) => {
    const check = guard.check('bulk_card_create', 'cards_total')
    if (!check.allowed) { set({ error: check.message ?? 'errors:card.rateLimitReached' }); return 0 }

    const CHUNK_SIZE = 500
    let totalInserted = 0

    for (let i = 0; i < cards.length; i += CHUNK_SIZE) {
      const chunk = cards.slice(i, i + CHUNK_SIZE)
      const payload = chunk.map(c => ({
        field_values: c.field_values,
        tags: c.tags ?? [],
      }))

      const { data, error } = await supabase.rpc('bulk_insert_cards', {
        p_deck_id: deck_id,
        p_template_id: template_id,
        p_cards: payload,
      })

      if (error) {
        set({ error: error.message })
        break
      }

      const inserted = (data as { inserted: number })?.inserted ?? chunk.length
      totalInserted += inserted
      onProgress?.(totalInserted, cards.length)
    }

    guard.recordSuccess('cards_total', totalInserted)
    if (!get().error) {
      await get().fetchCards(deck_id)
    }
    return totalInserted
  },

  updateCard: async (id, data) => {
    // readonly 체크
    const existingCard = get().cards.find((c) => c.id === id)
    if (existingCard) {
      const { data: deck } = await supabase
        .from('decks')
        .select('is_readonly')
        .eq('id', existingCard.deck_id)
        .single()
      if (deck && (deck as { is_readonly: boolean }).is_readonly) {
        set({ error: 'errors:card.readonlyDeckNoEdit' })
        return
      }
    }

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
