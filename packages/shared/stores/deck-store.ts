import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { guard } from '../lib/rate-limit-instance'
import { createStaleCache } from '../lib/cache/stale-cache'
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

// 데이터 신선도 — 이 시간 이내면 네트워크 재요청 스킵 (5분).
// Freshness is tracked outside Zustand state via a shared TTL cache: it is not
// render state (no component reads it), so it must not live in the store or
// trigger re-renders. Keys: 'decks' | 'stats' | 'templates'.
export type DeckCacheKey = 'decks' | 'stats' | 'templates'
const deckCache = createStaleCache({ ttlMs: 5 * 60 * 1000 })

interface DeckState {
  decks: Deck[]
  stats: DeckStats[]
  templates: CardTemplate[]
  loading: boolean
  error: string | null

  fetchDecks: (opts?: { force?: boolean }) => Promise<void>
  fetchStats: (userId: string, opts?: { force?: boolean }) => Promise<void>
  fetchTemplates: (opts?: { force?: boolean }) => Promise<void>
  /** Drop cached freshness so the next fetch hits the network. Omit key → all. */
  invalidate: (key?: DeckCacheKey) => void
  createDeck: (data: {
    name: string
    description?: string
    color?: string
    icon?: string
    default_template_id?: string
    srs_settings?: SrsSettings
    learning_language?: string
    native_language?: string
    native_languages?: string[]
    study_level?: string
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

  invalidate: (key) => deckCache.invalidate(key),

  fetchDecks: async (opts) => {
    if (!deckCache.shouldFetch('decks', opts)) return
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

    set({ decks: allDecks, loading: false })
    deckCache.markFetched('decks')
  },

  fetchStats: async (userId: string, opts?) => {
    if (!deckCache.shouldFetch('stats', opts)) return
    const { data, error } = await supabase.rpc('get_deck_stats', {
      p_user_id: userId,
    } as Record<string, unknown>)

    if (!error && data) {
      set({ stats: data as DeckStats[] })
      deckCache.markFetched('stats')
    }
  },

  fetchTemplates: async (opts?) => {
    if (!deckCache.shouldFetch('templates', opts)) return
    const { data } = await supabase
      .from('card_templates')
      .select('*')
      .order('is_default', { ascending: false })
      .order('name')

    if (data) {
      set({ templates: data as CardTemplate[] })
      deckCache.markFetched('templates')
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
        learning_language: input.learning_language ?? null,
        native_language: input.native_language ?? (input.native_languages?.[0] ?? null),
        native_languages: input.native_languages ?? (input.native_language ? [input.native_language] : null),
        study_level: input.study_level ?? null,
      } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      set({ error: error.message })
      return null
    }

    guard.recordSuccess('decks_total')
    // force: the 'decks'/'stats' cache entries were just marked fresh, so a plain
    // fetch would short-circuit on the TTL cache and the new deck would not appear
    // until the cache expired or the user pull-to-refreshed.
    await get().fetchDecks({ force: true })
    await get().fetchStats(user.id, { force: true })
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
    // force past the staleness cache so the edit is reflected immediately.
    await get().fetchDecks({ force: true })
    if (user) await get().fetchStats(user.id, { force: true })
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
    // force past the staleness cache so the deletion is reflected immediately.
    await get().fetchDecks({ force: true })
    if (user) await get().fetchStats(user.id, { force: true })
  },
}))
