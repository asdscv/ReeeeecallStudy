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
    // rateCard persists the study log via an RPC (insert_study_log) — mock it so the
    // fire-and-forget write resolves instead of throwing "rpc is not a function".
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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
    userId: null,
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
    // Reset the completion guard so each test's endSession actually runs (it leaks
    // true across tests otherwise, making a later endSession a silent no-op).
    sessionSaved: false,
    lastRatedCard: null,
  })

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})

// ─── rateCard: sequential_review does NOT persist position per-card (S-L3) ──────────
// The old design fired a per-card deck_study_state UPDATE from rateCard, with no ordering
// guarantee — a delayed earlier write could regress the saved position. The position is now
// computed authoritatively once in endSession, so rateCard must NOT write deck_study_state
// and must NOT mutate the in-memory studyState (endSession needs the session-start baseline).

describe('rateCard — sequential_review does NOT persist position per-card (S-L3)', () => {
  function setupSequentialReviewSession(cards: Card[], studyState: DeckStudyState, maxPos: number) {
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'sequential_review', batchSize: 20 },
      queue: cards,
      currentIndex: 0,
      isFlipped: true,
      isRating: false,
      userId: 'user-1',
      cardStartTime: Date.now() - 1000,
      sessionStartedAt: Date.now() - 5000,
      sessionStats: { totalCards: cards.length, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      studyState,
      maxCardPosition: maxPos,
      srsQueueManager: null,
      crammingManager: null,
    })
  }

  function trackUpdates() {
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
    return updateCalls
  }

  it('does NOT write deck_study_state when rating a new card', async () => {
    const cards = [makeCard('c1', 5, 'new'), makeCard('c2', 6, 'new')]
    setupSequentialReviewSession(cards, { ...fakeStudyState }, 39)
    const updateCalls = trackUpdates()

    await useStudyStore.getState().rateCard('known')
    await new Promise(r => setTimeout(r, 0)) // flush background DB writes

    expect(updateCalls).toEqual([])
  })

  it('does NOT write deck_study_state when rating a review card', async () => {
    const cards = [makeCard('c1', 10, 'review'), makeCard('c2', 11, 'review')]
    setupSequentialReviewSession(cards, { ...fakeStudyState, new_start_pos: 50, review_start_pos: 10 }, 39)
    const updateCalls = trackUpdates()

    await useStudyStore.getState().rateCard('unknown')
    await new Promise(r => setTimeout(r, 0)) // flush background DB writes

    expect(updateCalls).toEqual([])
  })

  it('leaves the in-memory studyState at its session-start baseline (no per-card mutation)', async () => {
    const cards = [makeCard('c1', 5, 'new'), makeCard('c2', 6, 'new')]
    setupSequentialReviewSession(cards, { ...fakeStudyState, new_start_pos: 5 }, 39)
    trackUpdates()

    await useStudyStore.getState().rateCard('known')
    await new Promise(r => setTimeout(r, 0)) // flush background DB writes

    // studyState is NOT advanced per-card — endSession recomputes from the baseline.
    expect(useStudyStore.getState().studyState!.new_start_pos).toBe(5)
  })

  it('does NOT write deck_study_state for non-sequential_review modes either', async () => {
    const cards = [makeCard('c1', 5, 'new'), makeCard('c2', 6, 'new')]
    useStudyStore.setState({
      phase: 'studying',
      config: { deckId: 'deck-1', mode: 'random', batchSize: 20 },
      queue: cards,
      currentIndex: 0,
      isFlipped: true,
      isRating: false,
      userId: 'user-1',
      cardStartTime: Date.now() - 1000,
      sessionStartedAt: Date.now() - 5000,
      sessionStats: { totalCards: cards.length, cardsStudied: 0, ratings: {}, totalDurationMs: 0 },
      studyState: { ...fakeStudyState },
      maxCardPosition: 39,
      srsQueueManager: null,
      crammingManager: null,
    })
    const updateCalls = trackUpdates()

    await useStudyStore.getState().rateCard('next')
    await new Promise(r => setTimeout(r, 0)) // flush background DB writes

    expect(updateCalls).toEqual([])
  })
})

// ─── endSession: sequential_review positions saved authoritatively (S-L3) ───────────

describe('endSession — sequential_review position saved authoritatively (S-L3)', () => {
  it('writes the recomputed position ONCE for sequential_review in endSession', async () => {
    const cards = [makeCard('c1', 5, 'review'), makeCard('c2', 6, 'review')]

    useStudyStore.setState({
      phase: 'completed',
      config: { deckId: 'deck-1', mode: 'sequential_review', batchSize: 20 },
      queue: cards,
      currentIndex: 1,
      userId: 'user-1',
      sessionStartedAt: Date.now() - 5000,
      // session-start baseline: review_start_pos 0 → studied review cards at 5 and 6 →
      // computeSequentialReviewPositions advances review_start_pos to max(5,6)+1 = 7.
      sessionStats: { totalCards: 2, cardsStudied: 2, ratings: { known: 2 }, totalDurationMs: 3000 },
      studyState: { ...fakeStudyState, new_start_pos: 0, review_start_pos: 0 },
      maxCardPosition: 39,
      crammingManager: null,
    })

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

    await useStudyStore.getState().endSession()

    // Exactly one authoritative write, with the recomputed positions.
    expect(updateCalls).toEqual([{ new_start_pos: 0, review_start_pos: 7 }])
    expect(updateEq).toHaveBeenCalledWith('id', 'state-1')
  })

  it('should still save deck_study_state for sequential mode in endSession', async () => {
    const cards = [makeCard('c1', 5, 'review'), makeCard('c2', 6, 'review')]

    useStudyStore.setState({
      phase: 'completed',
      config: { deckId: 'deck-1', mode: 'sequential', batchSize: 20 },
      queue: cards,
      currentIndex: 1,
      userId: 'user-1',
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
