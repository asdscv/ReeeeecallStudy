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

import { CrammingQueueManager } from '../../lib/cramming-queue'
import { useStudyStore } from '../study-store'
import type { Card } from '../../types/database'

function makeCard(id: string): Card {
  return {
    id,
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'template-1',
    field_values: { front: id, back: `${id}-back` },
    tags: [],
    sort_position: id === 'a' ? 0 : 1,
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
  vi.clearAllMocks()
  useStudyStore.getState().reset()
})

describe('study-store cramming true rounds', () => {
  it('shows a missed card in round 2 and completes after it is mastered', async () => {
    const cards = [makeCard('a'), makeCard('b')]
    const manager = new CrammingQueueManager(cards.map(card => card.id), {
      filter: { type: 'all' },
      timeLimitMinutes: null,
      shuffleCards: false,
    })

    useStudyStore.setState({
      phase: 'studying',
      config: {
        deckId: 'deck-1',
        mode: 'cramming',
        batchSize: 2,
        crammingFilter: { type: 'all' },
        crammingTimeLimitMinutes: null,
        crammingShuffle: false,
      },
      queue: cards,
      currentIndex: 0,
      isFlipped: true,
      isRating: false,
      userId: 'user-1',
      crammingManager: manager,
      sessionStats: { totalCards: 2, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      lastRatedCard: null,
      sessionSaved: false,
    })

    await useStudyStore.getState().rateCard('got_it')
    expect(useStudyStore.getState().currentIndex).toBe(1)

    useStudyStore.setState({ isFlipped: true })
    await useStudyStore.getState().rateCard('missed')

    expect(manager.currentRound()).toBe(2)
    expect(manager.currentCardId()).toBe('b')
    expect(useStudyStore.getState()).toMatchObject({
      phase: 'studying',
      currentIndex: 1,
      sessionStats: {
        totalCards: 2,
        cardsStudied: 2,
        ratings: { got_it: 1, missed: 1 },
      },
    })

    useStudyStore.setState({ isFlipped: true })
    await useStudyStore.getState().rateCard('got_it')

    expect(manager.currentRound()).toBe(2)
    expect(manager.isAllMastered()).toBe(true)
    expect(manager.masteryPercentage()).toBe(100)
    expect(useStudyStore.getState()).toMatchObject({
      phase: 'completed',
      sessionStats: {
        totalCards: 2,
        cardsStudied: 3,
        ratings: { got_it: 2, missed: 1 },
      },
    })

    expect(mockSupabase.from).not.toHaveBeenCalledWith('cards')
    expect(mockSupabase.from).not.toHaveBeenCalledWith('user_card_progress')
    const loggedRatings = mockSupabase.rpc.mock.calls
      .filter(([name]) => name === 'insert_study_log')
      .map(([, params]) => (params as { p_rating: string }).p_rating)
    expect(loggedRatings).toEqual(['got_it', 'missed', 'got_it'])
  })
})
