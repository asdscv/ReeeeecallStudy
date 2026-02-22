import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Supabase mock (HOISTED — runs before imports) ──────────
const mockSupabase = vi.hoisted(() => {
  const chainable = () => {
    const chain: Record<string, any> = {}
    chain.select = vi.fn().mockReturnValue(chain)
    chain.eq = vi.fn().mockReturnValue(chain)
    chain.neq = vi.fn().mockReturnValue(chain)
    chain.gte = vi.fn().mockReturnValue(chain)
    chain.lte = vi.fn().mockReturnValue(chain)
    chain.order = vi.fn().mockReturnValue(chain)
    chain.limit = vi.fn().mockReturnValue(chain)
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
    chain.insert = vi.fn().mockReturnValue(chain)
    chain.update = vi.fn().mockReturnValue(chain)
    chain.upsert = vi.fn().mockReturnValue(chain)
    return chain
  }

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: vi.fn().mockImplementation(() => chainable()),
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))

// Mock rate limiter
vi.mock('../../lib/rate-limit-instance', () => ({
  guard: {
    check: vi.fn().mockReturnValue({ allowed: true }),
    recordSuccess: vi.fn(),
  },
}))

// Mock SRS utilities (not needed for sequential_review)
vi.mock('../../lib/srs', () => ({
  calculateSRS: vi.fn(),
}))

vi.mock('../../lib/srs-access', () => ({
  getSrsSource: vi.fn().mockReturnValue('embedded'),
  mergeCardWithProgress: vi.fn(),
}))

import { useStudyStore } from '../study-store'
import { advanceSequentialReviewPosition } from '../../lib/study-session-utils'
import type { Card, DeckStudyState } from '../../types/database'

// ─── Helpers ────────────────────────────────────────────────

function makeCard(id: string, pos: number, status: Card['srs_status'] = 'new'): Card {
  return {
    id,
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'tmpl-1',
    field_values: { front: `front-${id}`, back: `back-${id}` },
    tags: [],
    sort_position: pos,
    srs_status: status,
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    next_review_at: null,
    last_reviewed_at: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
  } as unknown as Card
}

const fakeStudyState: DeckStudyState = {
  id: 'state-1',
  user_id: 'user-1',
  deck_id: 'deck-1',
  new_start_pos: 0,
  review_start_pos: 0,
  new_batch_size: 20,
  review_batch_size: 50,
  sequential_pos: 0,
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
} as DeckStudyState

const resetStore = () =>
  useStudyStore.setState({
    phase: 'idle',
    config: null,
    template: null,
    srsSettings: null,
    srsSource: 'embedded',
    queue: [],
    currentIndex: 0,
    isFlipped: false,
    isRating: false,
    cardStartTime: Date.now(),
    sessionStartedAt: Date.now(),
    sessionStats: { totalCards: 0, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
    studyState: null,
    srsQueueManager: null,
    crammingManager: null,
    maxCardPosition: 0,
  })

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})

// ─── rateCard: per-card position saving ─────────────────────

describe('rateCard — sequential_review per-card position saving', () => {
  function setupSequentialReviewSession(cards: Card[], studyState: DeckStudyState, maxPos: number) {
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'sequential_review', batchSize: 20 },
      queue: cards,
      currentIndex: 0,
      isFlipped: true,
      isRating: false,
      cardStartTime: Date.now() - 1000,
      sessionStartedAt: Date.now() - 5000,
      sessionStats: { totalCards: cards.length, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      studyState,
      maxCardPosition: maxPos,
      srsQueueManager: null,
      crammingManager: null,
    })
  }

  it('should update deck_study_state in DB when rating a new card', async () => {
    const cards = [makeCard('c1', 5, 'new'), makeCard('c2', 6, 'new')]
    setupSequentialReviewSession(cards, { ...fakeStudyState }, 39)

    // Track the update call
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'deck_study_state') {
        return { update: updateFn }
      }
      // study_logs insert
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await useStudyStore.getState().rateCard('known')

    // Verify deck_study_state.update was called with correct position
    expect(mockSupabase.from).toHaveBeenCalledWith('deck_study_state')
    expect(updateFn).toHaveBeenCalledWith({ new_start_pos: 6 })
    expect(updateEq).toHaveBeenCalledWith('id', 'state-1')
  })

  it('should update deck_study_state in DB when rating a review card', async () => {
    const cards = [makeCard('c1', 10, 'review'), makeCard('c2', 11, 'review')]
    setupSequentialReviewSession(cards, { ...fakeStudyState, new_start_pos: 50, review_start_pos: 10 }, 39)

    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'deck_study_state') {
        return { update: updateFn }
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await useStudyStore.getState().rateCard('unknown')

    expect(updateFn).toHaveBeenCalledWith({ review_start_pos: 11 })
    expect(updateEq).toHaveBeenCalledWith('id', 'state-1')
  })

  it('should wrap review_start_pos to 0 when past maxCardPosition', async () => {
    const cards = [makeCard('c1', 39, 'review')]
    setupSequentialReviewSession(cards, { ...fakeStudyState, review_start_pos: 39 }, 39)

    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'deck_study_state') {
        return { update: updateFn }
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await useStudyStore.getState().rateCard('known')

    expect(updateFn).toHaveBeenCalledWith({ review_start_pos: 0 })
  })

  it('should update local studyState after DB save', async () => {
    const cards = [makeCard('c1', 5, 'new'), makeCard('c2', 6, 'new')]
    setupSequentialReviewSession(cards, { ...fakeStudyState, new_start_pos: 5 }, 39)

    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'deck_study_state') {
        return { update: vi.fn().mockReturnValue({ eq: updateEq }) }
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await useStudyStore.getState().rateCard('known')

    // Local studyState should be updated
    const state = useStudyStore.getState()
    expect(state.studyState!.new_start_pos).toBe(6)
  })

  it('should NOT update deck_study_state for non-sequential_review modes', async () => {
    const cards = [makeCard('c1', 5, 'new'), makeCard('c2', 6, 'new')]
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'random', batchSize: 20 },
      queue: cards,
      currentIndex: 0,
      isFlipped: true,
      isRating: false,
      cardStartTime: Date.now() - 1000,
      sessionStartedAt: Date.now() - 5000,
      sessionStats: { totalCards: cards.length, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      studyState: { ...fakeStudyState },
      maxCardPosition: 39,
      srsQueueManager: null,
      crammingManager: null,
    })

    const updateFn = vi.fn()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'deck_study_state') {
        return { update: updateFn }
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await useStudyStore.getState().rateCard('next')

    // deck_study_state.update should NOT have been called
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('should save positions for consecutive cards correctly', async () => {
    const cards = [
      makeCard('c1', 0, 'review'),
      makeCard('c2', 1, 'review'),
      makeCard('c3', 2, 'review'),
    ]
    setupSequentialReviewSession(cards, { ...fakeStudyState, review_start_pos: 0 }, 39)

    const updateCalls: unknown[] = []
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'deck_study_state') {
        return {
          update: vi.fn().mockImplementation((data: unknown) => {
            updateCalls.push(data)
            return { eq: updateEq }
          }),
        }
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    // Rate card 1
    await useStudyStore.getState().rateCard('known')
    // Rate card 2
    await useStudyStore.getState().rateCard('known')

    // Should have 2 DB updates with incrementing positions
    expect(updateCalls).toEqual([
      { review_start_pos: 1 },
      { review_start_pos: 2 },
    ])

    // Local state should reflect latest position
    expect(useStudyStore.getState().studyState!.review_start_pos).toBe(2)
  })
})

// ─── endSession: sequential_review block removed ────────────

describe('endSession — sequential_review positions NOT saved', () => {
  it('should NOT call deck_study_state.update for sequential_review in endSession', async () => {
    const cards = [makeCard('c1', 5, 'review'), makeCard('c2', 6, 'review')]

    useStudyStore.setState({
      phase: 'completed',
      config: { deckId: 'deck-1', mode: 'sequential_review', batchSize: 20 },
      queue: cards,
      currentIndex: 1,
      sessionStartedAt: Date.now() - 5000,
      sessionStats: { totalCards: 2, cardsStudied: 2, ratings: { known: 2 }, totalDurationMs: 3000 },
      studyState: { ...fakeStudyState, review_start_pos: 7 },
      maxCardPosition: 39,
      crammingManager: null,
    })

    const updateFn = vi.fn()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'deck_study_state') {
        return { update: updateFn }
      }
      // study_sessions insert
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await useStudyStore.getState().endSession()

    // endSession should NOT update deck_study_state for sequential_review
    // (positions are already saved per-card in rateCard)
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('should still save deck_study_state for sequential mode in endSession', async () => {
    const cards = [makeCard('c1', 5, 'review'), makeCard('c2', 6, 'review')]

    useStudyStore.setState({
      phase: 'completed',
      config: { deckId: 'deck-1', mode: 'sequential', batchSize: 20 },
      queue: cards,
      currentIndex: 1,
      sessionStartedAt: Date.now() - 5000,
      sessionStats: { totalCards: 2, cardsStudied: 2, ratings: { next: 2 }, totalDurationMs: 3000 },
      studyState: { ...fakeStudyState, sequential_pos: 5 },
      maxCardPosition: 39,
      crammingManager: null,
    })

    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'deck_study_state') {
        return { update: updateFn }
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    await useStudyStore.getState().endSession()

    // sequential mode SHOULD still update sequential_pos
    expect(updateFn).toHaveBeenCalledWith({ sequential_pos: 7 })
  })
})

// ─── advanceSequentialReviewPosition correctness (re-verify) ─

describe('advanceSequentialReviewPosition — edge cases', () => {
  it('should handle sort_position=0 correctly', () => {
    const result = advanceSequentialReviewPosition({ sort_position: 0, srs_status: 'new' }, 39)
    expect(result).toEqual({ new_start_pos: 1 })
  })

  it('should handle maxCardPosition=0 (single card deck)', () => {
    const resultNew = advanceSequentialReviewPosition({ sort_position: 0, srs_status: 'new' }, 0)
    expect(resultNew).toEqual({ new_start_pos: 1 })

    const resultReview = advanceSequentialReviewPosition({ sort_position: 0, srs_status: 'review' }, 0)
    expect(resultReview).toEqual({ review_start_pos: 0 }) // wraps
  })

  it('should handle suspended card as non-new (same as review)', () => {
    const result = advanceSequentialReviewPosition({ sort_position: 10, srs_status: 'suspended' }, 39)
    expect(result).toEqual({ review_start_pos: 11 })
  })
})
