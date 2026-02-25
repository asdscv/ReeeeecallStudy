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

function setupMocks(insertError: { message: string } | null = null) {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  })

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'decks') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { next_position: 0 }, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }
    }
    // 'cards' table — needs both insert (for createCards) and select chain (for fetchCards)
    return {
      insert: vi.fn().mockResolvedValue({ error: insertError }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
  mockGuard.check.mockReturnValue({ allowed: true })
})

// ─── Tests ──────────────────────────────────────────────────
describe('createCards (bulk)', () => {
  it('should insert cards via direct table insert', async () => {
    setupMocks()

    const result = await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(3),
    })

    expect(result).toBe(3)
  })

  it('should return total inserted count', async () => {
    setupMocks()

    const result = await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(5),
    })

    expect(result).toBe(5)
  })

  it('should call onProgress after each chunk', async () => {
    setupMocks()

    const onProgress = vi.fn()
    await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(3),
      onProgress,
    })

    expect(onProgress).toHaveBeenCalled()
  })

  it('should stop on insert error and set store error', async () => {
    setupMocks({ message: 'DB error' })

    const result = await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(3),
    })

    expect(result).toBe(0)
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
    expect(useCardStore.getState().error).toBe('Rate limited')
  })

  it('should record bulk count with guard.recordSuccess', async () => {
    setupMocks()

    await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(10),
    })

    expect(mockGuard.recordSuccess).toHaveBeenCalledWith('cards_total', 10)
  })

  it('should return 0 when not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const result = await useCardStore.getState().createCards({
      deck_id: 'deck-1',
      template_id: 'tmpl-1',
      cards: makeCards(3),
    })

    expect(result).toBe(0)
  })
})
