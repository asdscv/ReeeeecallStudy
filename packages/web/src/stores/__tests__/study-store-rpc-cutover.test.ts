const mockSupabase = vi.hoisted(() => {
  const writes: Array<{ table: string; op: string; payload: unknown }> = []
  const chainable = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) {
      chain[method] = vi.fn().mockReturnValue(chain)
    }
    for (const method of ['insert', 'upsert', 'update']) {
      chain[method] = vi.fn((payload: unknown) => {
        writes.push({ table, op: method, payload })
        return chain
      })
    }
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
    return chain
  }
  return {
    writes,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn((table: string) => chainable(table)),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
})

vi.mock('@reeeeecall/shared/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabase: () => mockSupabase,
  initSupabase: vi.fn(),
}))
vi.mock('@reeeeecall/shared/lib/rate-limit-instance', () => ({
  guard: { check: vi.fn(() => ({ allowed: true })), recordSuccess: vi.fn() },
}))

import { SrsQueueManager } from '@reeeeecall/shared/lib/study-queue'
import { useStudyStore } from '@reeeeecall/shared/stores/study-store'
import type { Card, DeckStudyState } from '../../types/database'

type RpcCall = [string, Record<string, unknown>]

function rpcCalls(name: string): Record<string, unknown>[] {
  return (mockSupabase.rpc.mock.calls as RpcCall[])
    .filter(([called]) => called === name)
    .map(([, params]) => params)
}

function makeCard(overrides: Partial<Card> = {}): Card {
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
    ...overrides,
  } as Card
}

function srsManager(card: Card): SrsQueueManager {
  return new SrsQueueManager([{
    id: card.id,
    srs_status: card.srs_status,
    ease_factor: card.ease_factor,
    interval_days: card.interval_days,
    repetitions: card.repetitions,
  }])
}

async function rate(rating: string): Promise<void> {
  const pending = useStudyStore.getState().rateCard(rating)
  await vi.advanceTimersByTimeAsync(120)
  await pending
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  vi.clearAllMocks()
  mockSupabase.writes.length = 0
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null })
  useStudyStore.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('study-store atomic persistence cutover', () => {
  it('persists an SRS rating through apply_study_rating only', async () => {
    const card = makeCard()
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [card],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'embedded',
      srsQueueManager: srsManager(card),
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      clientSessionId: 'session-uuid-1',
      sessionSaved: false,
    })

    await rate('good')

    const applies = rpcCalls('apply_study_rating')
    expect(applies).toHaveLength(1)
    expect(applies[0]).toMatchObject({
      p_client_session_id: 'session-uuid-1',
      p_card_id: 'card-1',
      p_deck_id: 'deck-1',
      p_study_mode: 'srs',
      p_rating: 'good',
      p_srs_source: 'embedded',
      p_expected_revision: 0,
      p_new_srs: {
        srs_status: 'learning',
        repetitions: 1,
        next_review_at: '2026-01-01T00:10:00.000Z',
      },
    })
    expect(typeof applies[0].p_event_id).toBe('string')
    expect(rpcCalls('insert_study_log')).toHaveLength(0)
    expect(mockSupabase.writes.filter(w => w.table === 'cards')).toHaveLength(0)
    expect(useStudyStore.getState().lastRatedCard?.ratingEventId).toBe(applies[0].p_event_id)
  })

  it('advances expected revision using the server applied_revision', async () => {
    const card = makeCard({ srs_revision: 3 } as Partial<Card>)
    mockSupabase.rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'apply_study_rating'
        ? { data: { applied_revision: 4, status: 'applied' }, error: null }
        : { data: null, error: null }))

    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 2 },
      queue: [card, makeCard({ id: 'card-2' })],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'embedded',
      srsQueueManager: new SrsQueueManager([
        { id: 'card-1', srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0 },
        { id: 'card-2', srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0 },
      ]),
      sessionStats: { totalCards: 2, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      clientSessionId: 'session-uuid-2',
      sessionSaved: false,
    })

    await rate('good')

    expect(rpcCalls('apply_study_rating')[0].p_expected_revision).toBe(3)
    expect(useStudyStore.getState().queue.find(c => c.id === 'card-1')?.srs_revision).toBe(4)
  })

  it('sends log-only parameters for non-SRS modes', async () => {
    const card = makeCard()
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'sequential', batchSize: 1 },
      queue: [card],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'embedded',
      studyState: { id: 'state-1', sequential_pos: 0, new_start_pos: 0, review_start_pos: 0 } as DeckStudyState,
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      maxCardPosition: 0,
      clientSessionId: 'session-uuid-3',
      sessionSaved: false,
    })

    await rate('next')

    expect(rpcCalls('apply_study_rating')[0]).toMatchObject({
      p_study_mode: 'sequential',
      p_rating: 'next',
      p_srs_source: 'none',
      p_expected_revision: null,
      p_new_srs: null,
    })
  })

  it('uses the progress-table source and revision for subscribed decks', async () => {
    const card = makeCard({ user_id: 'owner-1', srs_revision: 2 } as Partial<Card>)
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [card],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'progress_table',
      srsQueueManager: srsManager(card),
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      clientSessionId: 'session-uuid-4',
      sessionSaved: false,
    })

    await rate('good')

    expect(rpcCalls('apply_study_rating')[0]).toMatchObject({
      p_srs_source: 'progress_table',
      p_expected_revision: 2,
    })
    expect(mockSupabase.writes.filter(w => w.table === 'user_card_progress')).toHaveLength(0)
  })

  it('finalizes a sequential session with cursor payload through one RPC', async () => {
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'sequential', batchSize: 1 },
      queue: [makeCard({ sort_position: 5 })],
      currentIndex: 1,
      userId: 'user-1',
      studyState: { id: 'state-1', sequential_pos: 5, new_start_pos: 0, review_start_pos: 0 } as DeckStudyState,
      sessionStats: { totalCards: 1, cardsStudied: 1, ratings: { next: 1 }, totalDurationMs: 900 },
      sessionStartedAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
      // maxCardPosition > studied position: the cursor advances instead of wrapping
      // (P4 one-wrap cyclic rule only wraps once the deck end is consumed).
      maxCardPosition: 9,
      clientSessionId: 'session-uuid-5',
      sessionSaved: false,
    })

    await useStudyStore.getState().endSession()

    const finalize = rpcCalls('finalize_study_session')
    expect(finalize).toHaveLength(1)
    expect(finalize[0]).toMatchObject({
      p_client_session_id: 'session-uuid-5',
      p_deck_id: 'deck-1',
      p_study_mode: 'sequential',
      p_started_at: '2026-01-01T00:00:00.000Z',
      p_cursor_before: { sequential_pos: 5 },
      p_cursor_after: { sequential_pos: 6 },
    })
    expect(mockSupabase.writes.filter(w => w.table === 'study_sessions')).toHaveLength(0)
    expect(mockSupabase.writes.filter(w => w.table === 'deck_study_state')).toHaveLength(0)
  })

  it('finalizes non-sequential sessions without cursor payload', async () => {
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'random', batchSize: 1 },
      queue: [makeCard()],
      currentIndex: 1,
      userId: 'user-1',
      sessionStats: { totalCards: 1, cardsStudied: 1, ratings: { next: 1 }, totalDurationMs: 100 },
      sessionStartedAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
      clientSessionId: 'session-uuid-6',
      sessionSaved: false,
    })

    await useStudyStore.getState().endSession()

    expect(rpcCalls('finalize_study_session')[0]).toMatchObject({
      p_study_mode: 'random',
      p_cursor_before: null,
      p_cursor_after: null,
    })
  })

  it('undoes the persisted rating event on undoLastRating', async () => {
    const card = makeCard()
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [card],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'embedded',
      srsQueueManager: srsManager(card),
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      clientSessionId: 'session-uuid-7',
      sessionSaved: false,
    })
    await rate('good')
    const eventId = rpcCalls('apply_study_rating')[0].p_event_id

    useStudyStore.getState().undoLastRating()
    await vi.advanceTimersByTimeAsync(0)

    expect(rpcCalls('undo_study_rating')).toEqual([{ p_event_id: eventId }])
  })

  it('surfaces a stale-revision conflict without retrying the write', async () => {
    const card = makeCard()
    mockSupabase.rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'apply_study_rating'
        ? { data: null, error: { code: 'PT409', message: 'Stale SRS revision' } }
        : { data: null, error: null }))

    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [card],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'embedded',
      srsQueueManager: srsManager(card),
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      clientSessionId: 'session-uuid-8',
      sessionSaved: false,
    })

    await rate('good')

    expect(rpcCalls('apply_study_rating')).toHaveLength(1)
    expect(useStudyStore.getState().persistenceError).toMatchObject({ code: 'PT409', scope: 'rating' })
  })

  it('adopts the monotonic revision returned by undo so the next rating is not stale', async () => {
    const card = makeCard({ srs_revision: 1 } as Partial<Card>)
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'apply_study_rating') {
        return Promise.resolve({ data: { applied_revision: 2, status: 'applied' }, error: null })
      }
      if (name === 'undo_study_rating') {
        // The server restores the previous SRS values but bumps the revision again.
        return Promise.resolve({ data: { applied_revision: 3, status: 'undone' }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [card],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'embedded',
      srsQueueManager: srsManager(card),
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      clientSessionId: 'session-uuid-9',
      sessionSaved: false,
    })
    await rate('good')

    useStudyStore.getState().undoLastRating()
    await vi.advanceTimersByTimeAsync(0)

    const restored = useStudyStore.getState().queue.find(c => c.id === 'card-1')
    expect(restored).toMatchObject({ srs_status: 'new', repetitions: 0, srs_revision: 3 })
  })

  it('mints a replacement session id instead of dropping a rating', async () => {
    const card = makeCard()
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [card],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'embedded',
      srsQueueManager: srsManager(card),
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      clientSessionId: null,
      sessionSaved: false,
    })

    await rate('good')

    // Losing study data is worse than a session row that starts mid-session, so the
    // store issues a key and still persists atomically under it.
    const applies = rpcCalls('apply_study_rating')
    expect(applies).toHaveLength(1)
    const issued = useStudyStore.getState().clientSessionId
    expect(typeof issued).toBe('string')
    expect(applies[0].p_client_session_id).toBe(issued)
  })

  it('commits the last rating before finalizing the session', async () => {
    const order: string[] = []
    let releaseApply: (() => void) | null = null
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'apply_study_rating') {
        return new Promise(resolve => {
          releaseApply = () => {
            order.push('apply')
            resolve({ data: { applied_revision: 1, status: 'applied' }, error: null })
          }
        })
      }
      if (name === 'finalize_study_session') {
        order.push('finalize')
      }
      return Promise.resolve({ data: null, error: null })
    })

    const card = makeCard()
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [card],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'embedded',
      srsQueueManager: srsManager(card),
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      clientSessionId: 'session-uuid-10',
      sessionSaved: false,
    })

    // Completing the last card triggers endSession while the rating RPC is still open.
    await rate('good')
    expect(order).toEqual([])

    releaseApply!()
    await vi.advanceTimersByTimeAsync(0)
    await useStudyStore.getState().persistenceChain
    await vi.advanceTimersByTimeAsync(0)

    // finalize must never overtake the apply: otherwise the server aggregate misses
    // the rating and the late apply is rejected as "session already closed" (55000).
    expect(order).toEqual(['apply', 'finalize'])
  })

  it('queues undo behind the apply it compensates', async () => {
    const order: string[] = []
    let releaseApply: (() => void) | null = null
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'apply_study_rating') {
        return new Promise(resolve => {
          releaseApply = () => {
            order.push('apply')
            resolve({ data: { applied_revision: 1, status: 'applied' }, error: null })
          }
        })
      }
      if (name === 'undo_study_rating') {
        order.push('undo')
        return Promise.resolve({ data: { applied_revision: 2, status: 'undone' }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const card = makeCard()
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 2 },
      queue: [card, makeCard({ id: 'card-2' })],
      currentIndex: 0,
      isFlipped: true,
      userId: 'user-1',
      srsSource: 'embedded',
      srsQueueManager: new SrsQueueManager([
        { id: 'card-1', srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0 },
        { id: 'card-2', srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0 },
      ]),
      sessionStats: { totalCards: 2, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      cardStartTime: Date.now(),
      sessionStartedAt: Date.now(),
      clientSessionId: 'session-uuid-11',
      sessionSaved: false,
    })

    await rate('good')
    useStudyStore.getState().undoLastRating()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual([])

    releaseApply!()
    await useStudyStore.getState().persistenceChain
    await vi.advanceTimersByTimeAsync(0)

    expect(order).toEqual(['apply', 'undo'])
  })

  it('passes cramming analytics to finalize instead of updating the session row', async () => {
    const crammingManager = {
      currentRound: () => 2,
      masteryPercentage: () => 100,
      isAllMastered: () => true,
      getHardestCards: () => [{ cardId: 'card-1', missedCount: 1 }],
    }

    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'cramming', batchSize: 1 },
      queue: [makeCard()],
      currentIndex: 1,
      userId: 'user-1',
      sessionStats: { totalCards: 1, cardsStudied: 2, ratings: { got_it: 2 }, totalDurationMs: 500 },
      sessionStartedAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
      clientSessionId: 'session-uuid-12',
      sessionSaved: false,
      // Only the analytics accessors endSession uses are needed here.
      crammingManager: crammingManager as unknown as never,
    })

    await useStudyStore.getState().endSession()

    const finalize = rpcCalls('finalize_study_session')
    expect(finalize).toHaveLength(1)
    expect(finalize[0].p_metadata).toEqual({
      cramming: {
        rounds: 2,
        mastery_percentage: 100,
        all_mastered: true,
        hardest_cards: [{ card_id: 'card-1', missed_count: 1 }],
      },
    })
    // study_sessions is server-written only after migration 161.
    expect(mockSupabase.writes.filter(w => w.table === 'study_sessions')).toHaveLength(0)
  })

  it('sends a null metadata payload for non-cramming sessions', async () => {
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'random', batchSize: 1 },
      queue: [makeCard()],
      currentIndex: 1,
      userId: 'user-1',
      sessionStats: { totalCards: 1, cardsStudied: 1, ratings: { next: 1 }, totalDurationMs: 100 },
      sessionStartedAt: new Date('2026-01-01T00:00:00.000Z').getTime(),
      clientSessionId: 'session-uuid-13',
      sessionSaved: false,
    })

    await useStudyStore.getState().endSession()

    expect(rpcCalls('finalize_study_session')[0].p_metadata).toBeNull()
  })

  it('generates a client session id when a session starts', async () => {
    expect(useStudyStore.getState().clientSessionId).toBeNull()
    await useStudyStore.getState().initSession({ deckId: 'deck-1', mode: 'srs', batchSize: 1 })
    expect(typeof useStudyStore.getState().clientSessionId).toBe('string')
    expect((useStudyStore.getState().clientSessionId ?? '').length).toBeGreaterThan(30)
  })
})
