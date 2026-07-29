import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSupabase = vi.hoisted(() => {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const chainable = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'insert', 'upsert']) {
      chain[method] = vi.fn().mockReturnValue(chain)
    }
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      updates.push({ table, payload })
      return chain
    })
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
    return chain
  }
  return {
    updates,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn((table: string) => chainable(table)),
    rpc: vi.fn().mockImplementation((name: string) =>
      name === 'rate_card_and_log'
        ? Promise.resolve({ data: { ok: true, log_id: `log-${name}`, idempotent: false }, error: null })
        : Promise.resolve({ data: null, error: null })
    ),
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))
vi.mock('../../lib/rate-limit-instance', () => ({
  guard: { check: vi.fn(() => ({ allowed: true })), recordSuccess: vi.fn() },
}))

import { SrsQueueManager } from '../../lib/study-queue'
import { useStudyStore } from '../study-store'
import type { Card } from '../../types/database'

function makeCard(): Card {
  return {
    id: 'card-1',
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'template-1',
    field_values: { front: 'front', back: 'back' },
    tags: [],
    sort_position: 0,
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    next_review_at: null,
    last_reviewed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as Card
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  vi.clearAllMocks()
  mockSupabase.updates.length = 0
  useStudyStore.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('study-store timestamp-based SRS queue', () => {
  it('completes a one-card session while preserving the future 10-minute due timestamp', async () => {
    const card = makeCard()
    const manager = new SrsQueueManager([{
      id: card.id,
      srs_status: card.srs_status,
      ease_factor: card.ease_factor,
      interval_days: card.interval_days,
      repetitions: card.repetitions,
    }])

    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [card],
      currentIndex: 0,
      isFlipped: true,
      isRating: false,
      userId: 'user-1',
      srsSource: 'embedded',
      srsQueueManager: manager,
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      lastRatedCard: null,
      sessionSaved: false,
    })

    const rating = useStudyStore.getState().rateCard('good')
    await vi.advanceTimersByTimeAsync(120)
    await rating

    const expectedDue = '2026-01-01T00:10:00.000Z'
    expect(useStudyStore.getState()).toMatchObject({
      phase: 'completed',
      queue: [{
        id: 'card-1',
        srs_status: 'learning',
        repetitions: 1,
        next_review_at: expectedDue,
      }],
      sessionStats: {
        totalCards: 1,
        cardsStudied: 1,
        ratings: { good: 1 },
      },
    })
    expect(manager.currentCard()).toBeNull()
    expect(manager.remaining()).toBe(0)
    expect(manager.isComplete()).toBe(true)

    // SRS state is now written by the atomic rate_card_and_log RPC, never by a
    // separate direct table update.
    expect(mockSupabase.updates.some(update => update.table === 'cards')).toBe(false)
    expect(mockSupabase.updates.some(update => update.table === 'user_card_progress')).toBe(false)

    const ratingCalls = mockSupabase.rpc.mock.calls.filter(([name]) => name === 'rate_card_and_log')
    expect(ratingCalls).toHaveLength(1)
    expect(ratingCalls[0][1]).toMatchObject({
      p_card_id: 'card-1',
      p_deck_id: 'deck-1',
      p_study_mode: 'srs',
      p_rating: 'good',
      p_new_srs_status: 'learning',
      p_new_repetitions: 1,
      p_new_next_review_at: expectedDue,
    })
  })
})
