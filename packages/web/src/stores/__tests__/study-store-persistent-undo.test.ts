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
import type { Card } from '../../types/database'

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

function srsManager(...ids: string[]): SrsQueueManager {
  return new SrsQueueManager(ids.map(id => ({
    id, srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0,
  })))
}

function startStudying(overrides: Record<string, unknown> = {}): void {
  const card = makeCard()
  useStudyStore.setState({
    phase: 'studying',
    config: { deckId: 'deck-1', mode: 'srs', batchSize: 2 },
    queue: [card, makeCard({ id: 'card-2' })],
    currentIndex: 0,
    isFlipped: true,
    isRating: false,
    userId: 'user-1',
    srsSource: 'embedded',
    srsQueueManager: srsManager('card-1', 'card-2'),
    sessionStats: { totalCards: 2, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
    cardStartTime: Date.now(),
    sessionStartedAt: Date.now(),
    clientSessionId: 'session-p6',
    sessionSaved: false,
    ...overrides,
  })
}

async function rate(rating: string): Promise<void> {
  const pending = useStudyStore.getState().rateCard(rating)
  await vi.advanceTimersByTimeAsync(120)
  await pending
  await useStudyStore.getState().persistenceChain
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

describe('study-store persistent undo', () => {
  it('restores local state only after the server undo succeeds', async () => {
    mockSupabase.rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'apply_study_rating'
        ? { data: { applied_revision: 1, status: 'applied' }, error: null }
        : name === 'undo_study_rating'
          ? { data: { applied_revision: 2, status: 'undone' }, error: null }
          : { data: null, error: null }))

    startStudying()
    await rate('good')
    expect(useStudyStore.getState().sessionStats.cardsStudied).toBe(1)

    await useStudyStore.getState().undoLastRating()

    expect(rpcCalls('undo_study_rating')).toHaveLength(1)
    expect(useStudyStore.getState()).toMatchObject({
      phase: 'studying',
      currentIndex: 0,
      undoState: 'idle',
      sessionStats: { cardsStudied: 0 },
    })
    expect(useStudyStore.getState().queue.find(c => c.id === 'card-1')).toMatchObject({
      srs_status: 'new',
      repetitions: 0,
      srs_revision: 2,
    })
    expect(useStudyStore.getState().lastRatedCard).toBeNull()
  })

  it('keeps the UI in the rated state when the server rejects the undo', async () => {
    mockSupabase.rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'apply_study_rating'
        ? { data: { applied_revision: 1, status: 'applied' }, error: null }
        : name === 'undo_study_rating'
          ? { data: null, error: { code: '55000', message: 'Only the latest applied rating can be undone' } }
          : { data: null, error: null }))

    startStudying()
    await rate('good')
    const ratedStats = { ...useStudyStore.getState().sessionStats }

    await useStudyStore.getState().undoLastRating()

    // A local rollback here would leave the UI claiming an undo the DB refused.
    expect(useStudyStore.getState().sessionStats).toEqual(ratedStats)
    expect(useStudyStore.getState().lastRatedCard).not.toBeNull()
    expect(useStudyStore.getState().undoState).toBe('idle')
    expect(useStudyStore.getState().persistenceError).toMatchObject({ scope: 'undo', code: '55000' })
  })

  it('ignores a second undo while the first is still in flight', async () => {
    let releaseUndo: (() => void) | null = null
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'apply_study_rating') {
        return Promise.resolve({ data: { applied_revision: 1, status: 'applied' }, error: null })
      }
      if (name === 'undo_study_rating') {
        return new Promise(resolve => {
          releaseUndo = () => resolve({ data: { applied_revision: 2, status: 'undone' }, error: null })
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    startStudying()
    await rate('good')

    const first = useStudyStore.getState().undoLastRating()
    await vi.advanceTimersByTimeAsync(0)
    expect(useStudyStore.getState().undoState).toBe('pending')

    await useStudyStore.getState().undoLastRating()
    expect(rpcCalls('undo_study_rating')).toHaveLength(1)

    releaseUndo!()
    await first
    expect(useStudyStore.getState().undoState).toBe('idle')
  })

  it('blocks rating while an undo is pending', async () => {
    let releaseUndo: (() => void) | null = null
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === 'apply_study_rating') {
        return Promise.resolve({ data: { applied_revision: 1, status: 'applied' }, error: null })
      }
      if (name === 'undo_study_rating') {
        return new Promise(resolve => {
          releaseUndo = () => resolve({ data: { applied_revision: 2, status: 'undone' }, error: null })
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    startStudying()
    await rate('good')
    const appliedBefore = rpcCalls('apply_study_rating').length

    const undo = useStudyStore.getState().undoLastRating()
    await vi.advanceTimersByTimeAsync(0)

    useStudyStore.setState({ isFlipped: true })
    // Not the `rate` helper: it drains persistenceChain, which cannot settle while the
    // undo is deliberately held open.
    const blocked = useStudyStore.getState().rateCard('good')
    await vi.advanceTimersByTimeAsync(120)
    await blocked
    expect(rpcCalls('apply_study_rating')).toHaveLength(appliedBefore)

    releaseUndo!()
    await undo
  })

  it('treats an already-undone event as success and restores', async () => {
    mockSupabase.rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'apply_study_rating'
        ? { data: { applied_revision: 1, status: 'applied' }, error: null }
        : name === 'undo_study_rating'
          ? { data: { applied_revision: 2, status: 'undone' }, error: null }
          : { data: null, error: null }))

    startStudying()
    await rate('good')
    await useStudyStore.getState().undoLastRating()

    expect(useStudyStore.getState().phase).toBe('studying')
    expect(useStudyStore.getState().sessionStats.cardsStudied).toBe(0)
  })

  it('refreshes an already-finalized session instead of finalizing twice', async () => {
    mockSupabase.rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'apply_study_rating'
        ? { data: { applied_revision: 1, status: 'applied' }, error: null }
        : name === 'undo_study_rating'
          ? { data: { applied_revision: 2, status: 'undone' }, error: null }
          : name === 'refresh_study_session'
            ? { data: { status: 'finalized', cards_studied: 2 }, error: null }
            : { data: null, error: null }))

    // Two cards: undoing the last one leaves the session with one applied rating, so
    // the row must be corrected rather than discarded.
    startStudying()
    await rate('good')
    useStudyStore.setState({ isFlipped: true })
    await rate('good')
    await vi.advanceTimersByTimeAsync(0)
    expect(useStudyStore.getState().phase).toBe('completed')
    expect(rpcCalls('finalize_study_session')).toHaveLength(1)

    // Undo from the completion screen, re-rate, complete again.
    await useStudyStore.getState().undoLastRating()
    expect(useStudyStore.getState().phase).toBe('studying')
    expect(useStudyStore.getState().sessionStats.cardsStudied).toBe(1)
    useStudyStore.setState({ isFlipped: true })
    await rate('easy')
    await vi.advanceTimersByTimeAsync(0)

    // Re-finalizing is a no-op server-side (idempotent by session id), so the corrected
    // aggregate has to come from a refresh. srs mode carries no cursor payload.
    expect(rpcCalls('finalize_study_session')).toHaveLength(1)
    expect(rpcCalls('refresh_study_session')).toEqual([{
      p_client_session_id: 'session-p6',
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    }])
  })

  it('discards the session row when the undo empties a finalized session', async () => {
    mockSupabase.rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'apply_study_rating'
        ? { data: { applied_revision: 1, status: 'applied' }, error: null }
        : name === 'undo_study_rating'
          ? { data: { applied_revision: 2, status: 'undone' }, error: null }
          : name === 'refresh_study_session'
            ? { data: { status: 'discarded' }, error: null }
            : { data: null, error: null }))

    // One-card session: rating it completes and finalizes the session.
    startStudying({
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [makeCard()],
      srsQueueManager: srsManager('card-1'),
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
    })
    await rate('good')
    await vi.advanceTimersByTimeAsync(0)
    expect(rpcCalls('finalize_study_session')).toHaveLength(1)

    await useStudyStore.getState().undoLastRating()

    // Nothing was studied any more, so the row must not survive as a 0-card session.
    expect(rpcCalls('refresh_study_session')).toEqual([{
      p_client_session_id: 'session-p6',
      p_cursor_before: null,
      p_cursor_after: null,
      p_metadata: null,
    }])
    expect(useStudyStore.getState().undoState).toBe('idle')

    // The row is gone, so re-completion finalizes a fresh one instead of refreshing.
    useStudyStore.setState({ isFlipped: true })
    await rate('easy')
    await vi.advanceTimersByTimeAsync(0)
    expect(rpcCalls('finalize_study_session')).toHaveLength(2)
    expect(rpcCalls('refresh_study_session')).toHaveLength(1)
  })

  it('finalizes the first completion rather than refreshing', async () => {
    startStudying({
      config: { deckId: 'deck-1', mode: 'srs', batchSize: 1 },
      queue: [makeCard()],
      srsQueueManager: srsManager('card-1'),
      sessionStats: { totalCards: 1, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
    })
    await rate('good')
    await vi.advanceTimersByTimeAsync(0)

    expect(rpcCalls('finalize_study_session')).toHaveLength(1)
    expect(rpcCalls('refresh_study_session')).toHaveLength(0)
  })

  it('neither finalizes nor refreshes a session with no applied ratings', async () => {
    startStudying({ sessionStats: { totalCards: 2, cardsStudied: 0, ratings: {}, totalDurationMs: 0 } })

    await useStudyStore.getState().endSession()

    expect(rpcCalls('finalize_study_session')).toHaveLength(0)
    expect(rpcCalls('refresh_study_session')).toHaveLength(0)
  })
})
