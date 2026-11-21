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
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
})

vi.mock('@reklue/shared/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabase: () => mockSupabase,
  initSupabase: vi.fn(),
}))
vi.mock('@reklue/shared/lib/rate-limit-instance', () => ({
  guard: { check: vi.fn(() => ({ allowed: true })), recordSuccess: vi.fn() },
}))

import { SrsQueueManager } from '@reklue/shared/lib/study-queue'
import { useStudyStore } from '@reklue/shared/stores/study-store'
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
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null })
  useStudyStore.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

function begin(cards: Card[]) {
  const manager = new SrsQueueManager(cards)
  useStudyStore.setState({
    phase: 'studying',
    config: { deckId: 'deck-1', mode: 'srs', batchSize: cards.length },
    queue: cards,
    currentIndex: 0,
    isFlipped: true,
    userId: 'user-1',
    clientSessionId: 'session-1',
    srsQueueManager: manager,
    sessionStats: { totalCards: cards.length, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
  })
  return manager
}

async function rate(rating: string) {
  const pending = useStudyStore.getState().rateCard(rating)
  await vi.advanceTimersByTimeAsync(120)
  await pending
}

describe('study-store timestamp-based SRS queue', () => {
  it('records the displayed card when another card becomes due while it is open', async () => {
    const first = makeCard()
    const second = { ...makeCard(), id: 'card-2' }
    begin([first, second])

    await rate('again')
    const { currentIndex, queue } = useStudyStore.getState()
    expect(queue[currentIndex]?.id).toBe(second.id)
    vi.setSystemTime(new Date(queue[0].next_review_at!))
    useStudyStore.getState().flipCard()
    await rate('easy')

    const persistedCards = mockSupabase.rpc.mock.calls
      .filter(([name]) => name === 'apply_study_rating')
      .map(([, input]) => input.p_card_id)
    expect(persistedCards).toEqual([first.id, second.id])
    const next = useStudyStore.getState()
    expect(next.queue[next.currentIndex]?.id).toBe(first.id)
  })

  it('reads the confirmed revision when a second evaluation is queued behind a slow save', async () => {
    const first = makeCard()
    const second = { ...makeCard(), id: 'card-2' }
    begin([first, second])
    let releaseFirstSave = () => {}
    mockSupabase.rpc.mockImplementation(async (name, input) => {
      if (name !== 'apply_study_rating') return { data: null, error: null }
      if (input.p_card_id === first.id && input.p_rating === 'again') {
        await new Promise<void>(resolve => { releaseFirstSave = resolve })
      }
      return { data: { applied_revision: input.p_expected_revision + 1 }, error: null }
    })

    await rate('again')
    vi.setSystemTime(new Date(useStudyStore.getState().queue[0].next_review_at!))
    useStudyStore.getState().flipCard()
    await rate('easy')
    useStudyStore.getState().flipCard()
    await rate('easy')
    releaseFirstSave()
    await useStudyStore.getState().persistenceChain

    const revisions = mockSupabase.rpc.mock.calls
      .filter(([name, input]) => name === 'apply_study_rating' && input.p_card_id === first.id)
      .map(([, input]) => input.p_expected_revision)
    expect(revisions).toEqual([0, 1])
  })

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

    // P5B: the SRS row is written inside apply_study_rating, not by a direct update.
    expect(mockSupabase.updates.find(update => update.table === 'cards')).toBeUndefined()
    const applied = mockSupabase.rpc.mock.calls
      .filter(([name]) => name === 'apply_study_rating')
      .map(([, params]) => params as { p_rating: string; p_new_srs: Record<string, unknown> })
    expect(applied.map(p => p.p_rating)).toEqual(['good'])
    expect(applied[0].p_new_srs).toMatchObject({
      srs_status: 'learning',
      repetitions: 1,
      next_review_at: expectedDue,
    })
  })
})
