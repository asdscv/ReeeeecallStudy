import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSupabase = vi.hoisted(() => {
  const chainable = () => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'insert', 'update', 'upsert']) {
      chain[method] = vi.fn().mockReturnValue(chain)
    }
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
    return chain
  }
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn().mockImplementation(() => chainable()),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))
vi.mock('../../lib/rate-limit-instance', () => ({
  guard: { check: vi.fn(() => ({ allowed: true })), recordSuccess: vi.fn() },
}))

import { useStudyStore } from '../study-store'
import type { Card } from '../../types/database'

const card = {
  id: 'card-1', deck_id: 'deck-1', user_id: 'user-1', template_id: 'template-1',
  field_values: { front: 'front', back: 'back' }, tags: [], sort_position: 0,
  srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0,
  next_review_at: null, last_reviewed_at: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
} as Card

function setSession(overrides: Record<string, unknown> = {}) {
  useStudyStore.setState({
    phase: 'studying',
    config: { deckId: 'deck-1', mode: 'srs', batchSize: 20 },
    queue: [card], currentIndex: 0, isFlipped: true, isRating: false,
    userId: 'user-1', srsSettings: null, srsSource: 'embedded',
    cardStartTime: Date.now(), sessionStartedAt: Date.now(),
    sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
    studyState: null, srsQueueManager: null, crammingManager: null,
    lastRatedCard: null, sessionSaved: false,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useStudyStore.getState().reset()
})

describe('study-store rating guardrails', () => {
  it('does nothing before the card is flipped', async () => {
    setSession({ isFlipped: false })
    await useStudyStore.getState().rateCard('good')
    expect(useStudyStore.getState().sessionStats.cardsStudied).toBe(0)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('does nothing outside the studying phase', async () => {
    setSession({ phase: 'completed' })
    await useStudyStore.getState().rateCard('good')
    expect(useStudyStore.getState().sessionStats.cardsStudied).toBe(0)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects a cross-mode or unknown rating without mutating state', async () => {
    setSession()
    await expect(useStudyStore.getState().rateCard('known')).resolves.toBeUndefined()
    expect(useStudyStore.getState().sessionStats).toEqual({
      totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0,
    })
    expect(useStudyStore.getState().lastRatedCard).toBeNull()
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects an invalid init config before authentication or queries', async () => {
    setSession({
      currentIndex: 7,
      isFlipped: true,
      isRating: true,
      lastRatedCard: { stale: true },
      sessionSaved: true,
    })

    await useStudyStore.getState().initSession({
      deckId: 'deck-1', mode: 'bogus' as never, batchSize: Number.NaN,
    })
    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled()
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(useStudyStore.getState()).toMatchObject({
      phase: 'completed',
      config: null,
      queue: [],
      currentIndex: 0,
      isFlipped: false,
      isRating: false,
      userId: null,
      studyState: null,
      lastRatedCard: null,
      sessionSaved: false,
      sessionStats: { totalCards: 0, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
    })
  })
})
