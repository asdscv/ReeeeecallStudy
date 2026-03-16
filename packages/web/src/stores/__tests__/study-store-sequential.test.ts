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

vi.mock('../../lib/rate-limit-instance', () => ({
  guard: {
    check: vi.fn().mockReturnValue({ allowed: true }),
    recordSuccess: vi.fn(),
  },
}))

vi.mock('../../lib/srs', () => ({
  calculateSRS: vi.fn(),
}))

vi.mock('../../lib/srs-access', () => ({
  getSrsSource: vi.fn().mockReturnValue('embedded'),
  mergeCardWithProgress: vi.fn(),
}))

import { useStudyStore } from '../study-store'
import type { Card, DeckStudyState } from '../../types/database'

// ─── Helpers ────────────────────────────────────────────────

function makeCard(id: string, pos: number): Card {
  return {
    id,
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'tmpl-1',
    field_values: { front: `front-${id}`, back: `back-${id}` },
    tags: [],
    sort_position: pos,
    srs_status: 'new',
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

function setupSequentialSession(opts: {
  cards: Card[]
  sequentialPos: number
  cardsStudied: number
  maxCardPosition: number
}) {
  useStudyStore.setState({
    phase: 'completed',
    config: { deckId: 'deck-1', mode: 'sequential', batchSize: opts.cards.length },
    queue: opts.cards,
    currentIndex: opts.cardsStudied - 1,
    isFlipped: false,
    isRating: false,
    userId: 'user-1',
    cardStartTime: Date.now() - 1000,
    sessionStartedAt: Date.now() - 5000,
    sessionStats: {
      totalCards: opts.cards.length,
      cardsStudied: opts.cardsStudied,
      ratings: { next: opts.cardsStudied },
      totalDurationMs: 3000,
    },
    studyState: { ...fakeStudyState, sequential_pos: opts.sequentialPos },
    maxCardPosition: opts.maxCardPosition,
    srsQueueManager: null,
    crammingManager: null,
  })
}

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
  })

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})

// ─── endSession: sequential mode position calculation ────────

describe('endSession — sequential mode early exit bug fix', () => {
  function setupMockAndGetUpdateCalls() {
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
      // study_sessions insert
      const chain: Record<string, any> = {}
      chain.insert = vi.fn().mockResolvedValue({ data: null, error: null })
      return chain
    })
    return updateCalls
  }

  it('should set sequential_pos to max+1 when all cards studied (normal completion)', async () => {
    // Cards [0,1,2,3,4], sequential_pos=0, all 5 studied
    const cards = [0, 1, 2, 3, 4].map(p => makeCard(`c${p}`, p))
    setupSequentialSession({
      cards,
      sequentialPos: 0,
      cardsStudied: 5,
      maxCardPosition: 9,
    })
    const updateCalls = setupMockAndGetUpdateCalls()

    await useStudyStore.getState().endSession()

    expect(updateCalls).toEqual([{ sequential_pos: 5 }])
  })

  it('should set sequential_pos based on studied cards only (early exit — 3 of 5)', async () => {
    // Cards [0,1,2,3,4], sequential_pos=0, only 3 studied (0,1,2)
    // Bug: would set sequential_pos=5 (skipping 3,4)
    // Fix: should set sequential_pos=3
    const cards = [0, 1, 2, 3, 4].map(p => makeCard(`c${p}`, p))
    setupSequentialSession({
      cards,
      sequentialPos: 0,
      cardsStudied: 3,
      maxCardPosition: 9,
    })
    const updateCalls = setupMockAndGetUpdateCalls()

    await useStudyStore.getState().endSession()

    expect(updateCalls).toEqual([{ sequential_pos: 3 }])
  })

  it('should handle wrapped queue with all cards studied', async () => {
    // Cards [98,99,0,1,2], sequential_pos=98, all 5 studied
    // wrappedCards (pos < 98) = [0,1,2] → max=2 → nextPos=3
    const cards = [98, 99, 0, 1, 2].map(p => makeCard(`c${p}`, p))
    setupSequentialSession({
      cards,
      sequentialPos: 98,
      cardsStudied: 5,
      maxCardPosition: 99,
    })
    const updateCalls = setupMockAndGetUpdateCalls()

    await useStudyStore.getState().endSession()

    expect(updateCalls).toEqual([{ sequential_pos: 3 }])
  })

  it('should handle wrapped queue with early exit — only pre-wrap cards studied', async () => {
    // Cards [98,99,0,1,2], sequential_pos=98, only 2 studied (98,99)
    // Bug: wrappedCards=[0,1,2] (unstudied) → nextPos=3 (skips 0,1,2)
    // Fix: studiedCards=[98,99], no wrappedCards → maxPos=99 → nextPos=100 → wraps to 0
    const cards = [98, 99, 0, 1, 2].map(p => makeCard(`c${p}`, p))
    setupSequentialSession({
      cards,
      sequentialPos: 98,
      cardsStudied: 2,
      maxCardPosition: 99,
    })
    const updateCalls = setupMockAndGetUpdateCalls()

    await useStudyStore.getState().endSession()

    expect(updateCalls).toEqual([{ sequential_pos: 0 }])
  })

  it('should set sequential_pos correctly when only 1 card studied', async () => {
    // Cards [5,6,7,8,9], sequential_pos=5, only 1 studied (5)
    // Fix: studiedCards=[5] → maxPos=5 → nextPos=6
    const cards = [5, 6, 7, 8, 9].map(p => makeCard(`c${p}`, p))
    setupSequentialSession({
      cards,
      sequentialPos: 5,
      cardsStudied: 1,
      maxCardPosition: 19,
    })
    const updateCalls = setupMockAndGetUpdateCalls()

    await useStudyStore.getState().endSession()

    expect(updateCalls).toEqual([{ sequential_pos: 6 }])
  })
})
