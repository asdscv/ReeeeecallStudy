import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { guard } from '../lib/rate-limit-instance'
import type { Deck, CardTemplate, SrsSettings } from '../types/database'

interface DeckStats {
  deck_id: string
  deck_name: string
  total_cards: number
  new_cards: number
  review_cards: number
  learning_cards: number
  last_studied: string | null
}

// 데이터 신선도 — 이 시간 이내면 네트워크 재요청 스킵
const STALE_AFTER_MS = 5 * 60 * 1000 // 5분

interface DeckState {
  decks: Deck[]
  stats: DeckStats[]
  templates: CardTemplate[]
  loading: boolean
  error: string | null

  // staleness tracking
  decksFetchedAt: number | null
  statsFetchedAt: number | null
  templatesFetchedAt: number | null

  fetchDecks: (opts?: { force?: boolean }) => Promise<void>
  fetchStats: (userId: string, opts?: { force?: boolean }) => Promise<void>
  fetchTemplates: (opts?: { force?: boolean }) => Promise<void>
  createDeck: (data: {
    name: string
    description?: string
    color?: string
    icon?: string
    default_template_id?: string
    srs_settings?: SrsSettings
  }) => Promise<Deck | null>
  updateDeck: (id: string, data: Partial<Deck>) => Promise<void>
  deleteDeck: (id: string) => Promise<void>
}

export const useDeckStore = create<DeckState>((set, get) => ({
  decks: [],
  stats: [],
  templates: [],
  loading: false,
  error: null,
  decksFetchedAt: null,
  statsFetchedAt: null,
  templatesFetchedAt: null,

  fetchDecks: async (opts) => {
    const { decksFetchedAt } = get()
    if (!opts?.force && decksFetchedAt && Date.now() - decksFetchedAt < STALE_AFTER_MS) return
    set({ loading: true, error: null })

    const { data: { user } } = await supabase.auth.getUser()

    // Fetch own decks
    const { data, error } = await supabase
      .from('decks')
      .select('*')
      .eq('is_archived', false)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (error) {
      set({ error: error.message, loading: false })
      return
    }

    let allDecks = (data ?? []) as Deck[]

    // Fetch subscribed decks (via active subscribe shares)
    if (user) {
      const { data: shares } = await supabase
        .from('deck_shares')
        .select('deck_id')
        .eq('recipient_id', user.id)
        .eq('share_mode', 'subscribe')
        .eq('status', 'active')

      if (shares && shares.length > 0) {
        const subscribedDeckIds = shares.map((s: { deck_id: string }) => s.deck_id)
        const existingDeckIds = new Set(allDecks.map((d) => d.id))
        const newIds = subscribedDeckIds.filter((id: string) => !existingDeckIds.has(id))

        if (newIds.length > 0) {
          const { data: subscribedDecks } = await supabase
            .from('decks')
            .select('*')
            .in('id', newIds)

          if (subscribedDecks) {
            allDecks = [...allDecks, ...(subscribedDecks as Deck[])]
          }
        }
      }
    }

    set({ decks: allDecks, loading: false, decksFetchedAt: Date.now() })
  },

  fetchStats: async (userId: string, opts?) => {
    const { statsFetchedAt } = get()
    if (!opts?.force && statsFetchedAt && Date.now() - statsFetchedAt < STALE_AFTER_MS) return
    const { data, error } = await supabase.rpc('get_deck_stats', {
      p_user_id: userId,
    } as Record<string, unknown>)

    if (!error && data) {
      set({ stats: data as DeckStats[], statsFetchedAt: Date.now() })
    }
  },

  fetchTemplates: async (opts?) => {
    const { templatesFetchedAt } = get()
    if (!opts?.force && templatesFetchedAt && Date.now() - templatesFetchedAt < STALE_AFTER_MS) return
    const { data } = await supabase
      .from('card_templates')
      .select('*')
      .order('is_default', { ascending: false })
      .order('name')

    if (data) {
      set({ templates: data as CardTemplate[], templatesFetchedAt: Date.now() })
    }
  },

  createDeck: async (input) => {
    const check = guard.check('deck_create', 'decks_total')
    if (!check.allowed) { set({ error: check.message ?? 'errors:deck.rateLimitReached' }); return null }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // 템플릿 미지정 시 첫 번째 기본 템플릿 사용
    let templateId = input.default_template_id
    if (!templateId) {
      const { templates } = get()
      const defaultTemplate = templates.find((t) => t.is_default)
      templateId = defaultTemplate?.id
    }

    const { data: deck, error } = await supabase
      .from('decks')
      .insert({
        user_id: user.id,
        name: input.name,
        description: input.description || null,
        color: input.color || '#3B82F6',
        icon: input.icon || '📚',
        default_template_id: templateId || null,
        srs_settings: input.srs_settings,
      } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      set({ error: error.message })
      return null
    }

    guard.recordSuccess('decks_total')
    await get().fetchDecks()
    await get().fetchStats(user.id)
    return deck as Deck
  },

  updateDeck: async (id, data) => {
    const { error } = await supabase
      .from('decks')
      .update(data as Record<string, unknown>)
      .eq('id', id)

    if (error) {
      set({ error: error.message })
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    await get().fetchDecks()
    if (user) await get().fetchStats(user.id)
  },

  deleteDeck: async (id) => {
    const { error } = await supabase
      .from('decks')
      .delete()
      .eq('id', id)

    if (error) {
      set({ error: error.message })
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    await get().fetchDecks()
    if (user) await get().fetchStats(user.id)
  },
}))
