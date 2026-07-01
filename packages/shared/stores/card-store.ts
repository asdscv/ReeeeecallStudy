import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { guard } from '../lib/rate-limit-instance'
import { useDeckStore } from './deck-store'
import { createStaleCache } from '../lib/cache/stale-cache'
import type { Card } from '../types/database'

/**
 * The owned-card limit guard (mig 116) raises SQLSTATE PT402 with hint
 * CARD_LIMIT_REACHED from reserve_card_positions. Detect on code/hint (robust to
 * whether PostgREST maps PT402→HTTP 402) so we can show the subscribe message.
 */
function isCardLimitError(err: { code?: string; hint?: string } | null): boolean {
  return err?.code === 'PT402' || err?.hint === 'CARD_LIMIT_REACHED'
}

/**
 * Card mutations change the per-deck card/SRS counts surfaced by
 * get_deck_stats (deck list + Quick Study). The deck store caches stats with a
 * TTL, and consumers fetch on focus without `force`, so we must invalidate that
 * cache here or the deck list keeps showing stale counts until the TTL expires.
 * (deck-store does not import card-store → no cycle.)
 */
function invalidateDeckStats(): void {
  useDeckStore.getState().invalidate('stats')
}

/**
 * Owned-card usage (mig 116) drives the usage meter + create pre-flights. It is
 * fetched once on mount, but the create modals stay mounted, so without an explicit
 * refresh after a mutation the meter/pre-flight go stale — most seriously, a user at
 * the cap who DELETES cards would stay blocked. Refresh it after every create/delete
 * (mirrors invalidateDeckStats). Fire-and-forget; fetchCardUsage is fail-safe.
 */
function refreshCardUsage(): void {
  void useDeckStore.getState().fetchCardUsage()
}

// ── Per-deck card-list cache ─────────────────────────────────────────────────
// fetchCards re-hit the network on every deck open; cache each deck's list so
// re-opening within the TTL is instant. Two safeguards make this safe despite
// card lists being edit-heavy + large:
//   1) Bounded LRU data cache (MAX_DECKS) → memory stays small.
//   2) Invalidated on EVERY write path: card-store mutations + study-store SRS
//      writes (study bypasses card-store) → DeckDetail's srs_status filter never
//      goes stale. useCards refetches on focus to pick up invalidations.
const MAX_DECKS = 6
const cardListCache = createStaleCache({ ttlMs: 5 * 60 * 1000 })
const cardsByDeck = new Map<string, Card[]>()

function cacheDeckCards(deckId: string, cards: Card[]): void {
  cardsByDeck.delete(deckId) // re-insert at end → most-recently-used
  cardsByDeck.set(deckId, cards)
  cardListCache.markFetched(deckId)
  while (cardsByDeck.size > MAX_DECKS) {
    const oldest = cardsByDeck.keys().next().value as string | undefined
    if (oldest === undefined) break
    cardsByDeck.delete(oldest)
    cardListCache.invalidate(oldest)
  }
}

function dropDeckCards(deckId?: string): void {
  if (deckId === undefined) cardsByDeck.clear()
  else cardsByDeck.delete(deckId)
  cardListCache.invalidate(deckId)
}

interface CardState {
  cards: Card[]
  loading: boolean
  error: string | null

  fetchCards: (deckId: string, opts?: { force?: boolean }) => Promise<void>
  /** Drop cached card list(s) so the next fetch hits the network. Omit → all. */
  invalidateCards: (deckId?: string) => void
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

  invalidateCards: (deckId) => dropDeckCards(deckId),

  fetchCards: async (deckId: string, opts) => {
    // Cache hit: serve the cached list for this deck without a network round-trip.
    if (!opts?.force && cardListCache.isFresh(deckId) && cardsByDeck.has(deckId)) {
      cacheDeckCards(deckId, cardsByDeck.get(deckId)!) // bump LRU recency
      set({ cards: cardsByDeck.get(deckId)!, loading: false, error: null })
      return
    }
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('deck_id', deckId)
      .order('sort_position', { ascending: true })

    if (error) {
      set({ error: error.message, loading: false })
    } else {
      const cards = (data ?? []) as Card[]
      cacheDeckCards(deckId, cards)
      set({ cards, loading: false })
    }
  },

  createCard: async (input) => {
    const check = guard.check('card_create', 'cards_total')
    if (!check.allowed) { set({ error: check.message ?? 'errors:card.rateLimitReached' }); return null }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // readonly 체크
    const { data: deck } = await supabase
      .from('decks')
      .select('is_readonly')
      .eq('id', input.deck_id)
      .single()

    if (deck && (deck as { is_readonly: boolean }).is_readonly) {
      set({ error: 'errors:card.readonlyDeckNoAdd' })
      return null
    }

    // 원자적 sort_position 예약 (mig 105) — next_position read-modify-write 레이스 제거
    const { data: position, error: posError } = await supabase
      .rpc('reserve_card_positions', { p_deck_id: input.deck_id, p_count: 1 })
    if (posError || position === null) {
      if (isCardLimitError(posError)) refreshCardUsage()  // sync UI to the real at-cap state
      set({ error: isCardLimitError(posError) ? 'errors:card.limitReached' : (posError?.message ?? 'Failed to create card') })
      return null
    }

    const { data: card, error } = await supabase
      .from('cards')
      .insert({
        deck_id: input.deck_id,
        user_id: user.id,
        template_id: input.template_id,
        field_values: input.field_values,
        tags: input.tags || [],
        sort_position: position as number,
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

    // (next_position 증가는 reserve_card_positions가 원자적으로 처리)

    guard.recordSuccess('cards_total')
    invalidateDeckStats()
    refreshCardUsage()
    dropDeckCards(input.deck_id)
    await get().fetchCards(input.deck_id)
    return card as Card
  },

  createCards: async ({ deck_id, template_id, cards, onProgress }) => {
    // Clear any stale error from a previous op so the success-gated cache
    // invalidation below (`if (!get().error)`) reflects THIS call's outcome.
    // Without this, a leftover error (e.g. a prior failed attempt) would make a
    // fully-successful retry skip invalidateDeckStats/dropDeckCards, leaving the
    // deck list showing a stale card count (a freshly-created deck stuck at 0).
    set({ error: null })
    const check = guard.check('bulk_card_create', 'cards_total')
    if (!check.allowed) { set({ error: check.message ?? 'errors:card.rateLimitReached' }); return 0 }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { set({ error: 'Not authenticated' }); return 0 }

    // 원자적으로 cards.length 칸 예약 (mig 105) — read-modify-write 레이스 제거.
    // basePos부터 연속 블록을 받으며, next_position 증가도 RPC가 처리.
    const { data: basePos, error: posError } = await supabase
      .rpc('reserve_card_positions', { p_deck_id: deck_id, p_count: cards.length })
    if (posError || basePos === null) {
      if (isCardLimitError(posError)) refreshCardUsage()  // sync UI to the real at-cap state
      set({ error: isCardLimitError(posError) ? 'errors:card.limitReached' : (posError?.message ?? 'Failed to create cards') })
      return 0
    }

    const CHUNK_SIZE = 200
    let totalInserted = 0

    for (let i = 0; i < cards.length; i += CHUNK_SIZE) {
      const chunk = cards.slice(i, i + CHUNK_SIZE)
      const rows = chunk.map((c, idx) => ({
        deck_id,
        user_id: user.id,
        template_id,
        field_values: c.field_values,
        tags: c.tags ?? [],
        sort_position: (basePos as number) + i + idx,
        srs_status: 'new',
        ease_factor: 2.5,
        interval_days: 0,
        repetitions: 0,
      } as Record<string, unknown>))

      const { error } = await supabase.from('cards').insert(rows)

      if (error) {
        set({ error: error.message })
        break
      }

      totalInserted += chunk.length
      onProgress?.(totalInserted, cards.length)
    }

    // (next_position 증가는 reserve_card_positions가 원자적으로 처리)

    guard.recordSuccess('cards_total', totalInserted)
    if (!get().error) {
      invalidateDeckStats()
      refreshCardUsage()
      dropDeckCards(deck_id)
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
    invalidateDeckStats()
    refreshCardUsage()
    const card = get().cards.find((c) => c.id === id)
    if (card) {
      dropDeckCards(card.deck_id)
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

    invalidateDeckStats()
    refreshCardUsage()
    if (card) {
      dropDeckCards(card.deck_id)
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

    invalidateDeckStats()
    refreshCardUsage()
    if (deckId) {
      dropDeckCards(deckId)
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

    invalidateDeckStats()
    refreshCardUsage()
    const card = get().cards.find((c) => c.id === id)
    if (card) {
      dropDeckCards(card.deck_id)
      await get().fetchCards(card.deck_id)
    }
  },
}))
