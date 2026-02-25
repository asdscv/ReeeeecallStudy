import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Supabase mock ──────────────────────────────────────────
const mockSupabase = vi.hoisted(() => ({
  auth: { getUser: vi.fn() },
  from: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))

// ─── Rate limit guard mock ──────────────────────────────────
const mockGuard = vi.hoisted(() => ({
  check: vi.fn(() => ({ allowed: true })),
  recordSuccess: vi.fn(),
}))
vi.mock('../../lib/rate-limit-instance', () => ({ guard: mockGuard }))

import { useCardStore } from '../card-store'

// ─── Helpers ────────────────────────────────────────────────
const resetStore = () =>
  useCardStore.setState({ cards: [], loading: false, error: null })

const makeCards = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    field_values: { front: `word${i}`, back: `뜻${i}` },
    tags: ['test'],
  }))

// fetchCards를 위한 체인 mock
function setupFetchCardsMock() {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  mockSupabase.from.mockReturnValue(chain)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  // guard.check default: always allowed
  mockGuard.check.mockReturnValue({ allowed: true })
})

// ─── Tests ──────────────────────────────────────────────────
describe('createCards (bulk)', () => {
  it('should call bulk_insert_cards RPC with correct params', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { inserted: 3 }, error: null })
    setupFetchCardsMock()

    const cards = makeCards(3)
    await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards,
    })

    expect(mockSupabase.rpc).toHaveBeenCalledWith('bulk_insert_cards', {
      p_deck_id: 'deck-1',
      p_template_id: 'tmpl-1',
      p_cards: cards.map(c => ({ field_values: c.field_values, tags: c.tags })),
    })
  })

  it('should return total inserted count', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { inserted: 5 }, error: null })
    setupFetchCardsMock()

    const result = await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(5),
    })

    expect(result).toBe(5)
  })

  it('should call fetchCards exactly once after all chunks', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { inserted: 3 }, error: null })
    setupFetchCardsMock()

    await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(3),
    })

    // from('cards') should be called exactly once (fetchCards)
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)
    expect(mockSupabase.from).toHaveBeenCalledWith('cards')
  })

  it('should chunk large card sets and call RPC per chunk', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: { inserted: 500 }, error: null })
      .mockResolvedValueOnce({ data: { inserted: 200 }, error: null })
    setupFetchCardsMock()

    const result = await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(700),
    })

    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2)
    expect(result).toBe(700)
  })

  it('should call onProgress after each chunk', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: { inserted: 500 }, error: null })
      .mockResolvedValueOnce({ data: { inserted: 100 }, error: null })
    setupFetchCardsMock()

    const onProgress = vi.fn()
    await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(600),
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenNthCalledWith(1, 500, 600)
    expect(onProgress).toHaveBeenNthCalledWith(2, 600, 600)
  })

  it('should stop on RPC error and set store error', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: { inserted: 500 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'DB error' } })
    setupFetchCardsMock()

    const result = await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(700),
    })

    expect(result).toBe(500)
    expect(useCardStore.getState().error).toBe('DB error')
  })

  it('should return 0 when rate limited', async () => {
    mockGuard.check.mockReturnValue({ allowed: false, message: 'Rate limited' } as { allowed: boolean; message?: string })

    const result = await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(3),
    })

    expect(result).toBe(0)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
    expect(useCardStore.getState().error).toBe('Rate limited')
  })

  it('should record bulk count with guard.recordSuccess', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { inserted: 10 }, error: null })
    setupFetchCardsMock()

    await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(10),
    })

    expect(mockGuard.recordSuccess).toHaveBeenCalledWith('cards_total', 10)
  })

  it('should default tags to empty array when not provided', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { inserted: 1 }, error: null })
    setupFetchCardsMock()

    await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: [{ field_values: { front: 'hello', back: 'world' } }],
    })

    expect(mockSupabase.rpc).toHaveBeenCalledWith('bulk_insert_cards', {
      p_deck_id: 'deck-1',
      p_template_id: 'tmpl-1',
      p_cards: [{ field_values: { front: 'hello', back: 'world' }, tags: [] }],
    })
  })
})
