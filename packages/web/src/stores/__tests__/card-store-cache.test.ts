/**
 * Phase-4 cache: per-deck card-list TTL cache with bounded LRU.
 * Verifies fetchCards serves from cache without a network round-trip, force
 * bypasses, invalidateCards forces a refetch, and the LRU evicts the
 * least-recently-used deck past MAX_DECKS (6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

const cardsChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data: [{ id: 'c1', deck_id: 'd1' }], error: null }),
}

const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  rpc: vi.fn(),
  from: (...a: unknown[]) => mockFrom(...a),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))
vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: mockSupabase, getSupabase: () => mockSupabase, initSupabase: vi.fn(),
}))

import { useCardStore } from '../card-store'

const store = () => useCardStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue(cardsChain)
  store().invalidateCards() // clear the module-level cache for isolation
})

describe('card-store per-deck list cache', () => {
  it('serves a fresh deck from cache without re-hitting the network', async () => {
    await store().fetchCards('d1')
    expect(mockFrom).toHaveBeenCalledTimes(1)
    await store().fetchCards('d1')
    expect(mockFrom).toHaveBeenCalledTimes(1) // cache hit, no extra fetch
    expect(store().cards).toHaveLength(1)
  })

  it('force bypasses the cache', async () => {
    await store().fetchCards('d1')
    await store().fetchCards('d1', { force: true })
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('invalidateCards(deckId) forces the next fetch to hit the network', async () => {
    await store().fetchCards('d1')
    store().invalidateCards('d1')
    await store().fetchCards('d1')
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('keeps different decks independently cached', async () => {
    await store().fetchCards('d1')
    await store().fetchCards('d2')
    expect(mockFrom).toHaveBeenCalledTimes(2)
    await store().fetchCards('d1') // still cached
    await store().fetchCards('d2')
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('evicts the least-recently-used deck past MAX_DECKS (6)', async () => {
    // Open 7 distinct decks → d1 (oldest) evicted.
    for (let i = 1; i <= 7; i++) await store().fetchCards(`deck-${i}`)
    expect(mockFrom).toHaveBeenCalledTimes(7)

    await store().fetchCards('deck-7') // most-recent → still cached
    expect(mockFrom).toHaveBeenCalledTimes(7)

    await store().fetchCards('deck-1') // evicted → refetch
    expect(mockFrom).toHaveBeenCalledTimes(8)
  })
})
