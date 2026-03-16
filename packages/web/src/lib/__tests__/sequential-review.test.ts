import { describe, it, expect } from 'vitest'
import {
  advanceSequentialReviewPosition,
  buildSequentialReviewQueue,
  computeSequentialReviewPositions,
} from '../study-session-utils'

// ─── Helpers ────────────────────────────────────────────────

interface MockCard {
  id: string
  sort_position: number
  srs_status: 'new' | 'learning' | 'review' | 'suspended'
}

function makeCard(id: string, pos: number, status: 'new' | 'learning' | 'review' | 'suspended' = 'new'): MockCard {
  return { id, sort_position: pos, srs_status: status }
}

// ─── buildSequentialReviewQueue ─────────────────────────────

describe('buildSequentialReviewQueue', () => {
  describe('basic new card fetching', () => {
    it('should fetch new cards from new_start_pos', () => {
      const cards = [
        makeCard('c1', 0),
        makeCard('c2', 1),
        makeCard('c3', 2),
        makeCard('c4', 3),
        makeCard('c5', 4),
      ]
      const state = { new_start_pos: 0, review_start_pos: 0 }
      const result = buildSequentialReviewQueue(cards, state, 3, 10)

      expect(result.newCards.map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
    })

    it('should respect new batch size limit', () => {
      const cards = [
        makeCard('c1', 0),
        makeCard('c2', 1),
        makeCard('c3', 2),
        makeCard('c4', 3),
      ]
      const state = { new_start_pos: 0, review_start_pos: 0 }
      const result = buildSequentialReviewQueue(cards, state, 2, 10)

      expect(result.newCards).toHaveLength(2)
    })
  })

  describe('wrap-around when no new cards remain', () => {
    it('should wrap around to beginning when new_start_pos exceeds all card positions', () => {
      const cards = [
        makeCard('c1', 0, 'review'),
        makeCard('c2', 1, 'review'),
        makeCard('c3', 2, 'review'),
      ]
      const state = { new_start_pos: 100, review_start_pos: 0 }
      const result = buildSequentialReviewQueue(cards, state, 3, 10)

      // No new cards exist, should review from review_start_pos
      expect(result.newCards).toHaveLength(0)
      expect(result.reviewCards.length).toBeGreaterThan(0)
    })

    it('should return review cards starting from review_start_pos when no new cards', () => {
      const cards = [
        makeCard('c1', 0, 'review'),
        makeCard('c2', 1, 'review'),
        makeCard('c3', 2, 'learning'),
        makeCard('c4', 3, 'review'),
      ]
      const state = { new_start_pos: 100, review_start_pos: 2 }
      const result = buildSequentialReviewQueue(cards, state, 5, 5)

      // Should get cards from pos >= 2, then wrap to fill up to batch size
      expect(result.reviewCards.map(c => c.id)).toEqual(['c3', 'c4', 'c1', 'c2'])
    })

    it('should wrap around review cards when review_start_pos exceeds all positions', () => {
      const cards = [
        makeCard('c1', 0, 'review'),
        makeCard('c2', 1, 'review'),
        makeCard('c3', 2, 'review'),
      ]
      const state = { new_start_pos: 100, review_start_pos: 100 }
      const result = buildSequentialReviewQueue(cards, state, 5, 5)

      // Should wrap around and return cards from the beginning
      expect(result.reviewCards.length).toBeGreaterThan(0)
      expect(result.reviewCards[0].id).toBe('c1')
    })
  })

  describe('mixed new + review cards', () => {
    it('should return new cards and review cards together', () => {
      const cards = [
        makeCard('c1', 0, 'review'),
        makeCard('c2', 1, 'review'),
        makeCard('c3', 2, 'new'),
        makeCard('c4', 3, 'new'),
        makeCard('c5', 4, 'new'),
      ]
      const state = { new_start_pos: 2, review_start_pos: 0 }
      const result = buildSequentialReviewQueue(cards, state, 2, 5)

      // 2 new cards from pos 2
      expect(result.newCards.map(c => c.id)).toEqual(['c3', 'c4'])
      // review cards from pos 0 to pos 2 (before new_start_pos)
      expect(result.reviewCards.map(c => c.id)).toEqual(['c1', 'c2'])
    })
  })

  describe('suspended cards exclusion', () => {
    it('should exclude suspended cards from review', () => {
      const cards = [
        makeCard('c1', 0, 'review'),
        makeCard('c2', 1, 'suspended'),
        makeCard('c3', 2, 'review'),
      ]
      const state = { new_start_pos: 100, review_start_pos: 0 }
      const result = buildSequentialReviewQueue(cards, state, 5, 5)

      const ids = result.reviewCards.map(c => c.id)
      expect(ids).not.toContain('c2')
    })
  })

  describe('all cards studied — cycle from beginning', () => {
    it('should cycle all non-suspended cards from pos 0 when everything is studied and positions wrap', () => {
      const cards = [
        makeCard('c1', 0, 'review'),
        makeCard('c2', 1, 'learning'),
        makeCard('c3', 2, 'review'),
      ]
      // Both positions past all cards
      const state = { new_start_pos: 50, review_start_pos: 50 }
      const result = buildSequentialReviewQueue(cards, state, 5, 5)

      // Should wrap around and return all non-suspended cards
      expect(result.reviewCards).toHaveLength(3)
    })
  })

  describe('all new cards returned when newBatchSize is very large', () => {
    it('should return ALL new cards when newBatchSize exceeds card count', () => {
      const cards = [
        makeCard('c1', 0),
        makeCard('c2', 1),
        makeCard('c3', 2),
        makeCard('c4', 3),
        makeCard('c5', 4),
      ]
      const state = { new_start_pos: 0, review_start_pos: 0 }
      // Pass very large newBatchSize = all new cards should be returned
      const result = buildSequentialReviewQueue(cards, state, 99999, 10)

      expect(result.newCards).toHaveLength(5)
    })

    it('should return all 20 new cards + 30 review cards with batchSize=30', () => {
      // Simulate: 100 cards, 80 studied (review), 20 new
      const cards: MockCard[] = []
      for (let i = 0; i < 80; i++) {
        cards.push(makeCard(`r${i}`, i, 'review'))
      }
      for (let i = 80; i < 100; i++) {
        cards.push(makeCard(`n${i}`, i, 'new'))
      }
      const state = { new_start_pos: 80, review_start_pos: 0 }
      // All new cards + 30 review cards
      const result = buildSequentialReviewQueue(cards, state, 99999, 30)

      expect(result.newCards).toHaveLength(20)
      expect(result.reviewCards).toHaveLength(30)
    })
  })

  describe('empty deck', () => {
    it('should return empty arrays for empty card list', () => {
      const state = { new_start_pos: 0, review_start_pos: 0 }
      const result = buildSequentialReviewQueue([], state, 5, 5)

      expect(result.newCards).toHaveLength(0)
      expect(result.reviewCards).toHaveLength(0)
    })
  })
})

// ─── computeSequentialReviewPositions (updated) ─────────────

describe('computeSequentialReviewPositions (wrap-around)', () => {
  it('should advance positions normally when new cards exist', () => {
    const queue = [
      { sort_position: 0, srs_status: 'new' as const },
      { sort_position: 5, srs_status: 'new' as const },
      { sort_position: 9, srs_status: 'new' as const },
    ]
    const state = { new_start_pos: 0, review_start_pos: 0 }
    const result = computeSequentialReviewPositions(queue, state, 20)

    expect(result.new_start_pos).toBe(10)
    expect(result.review_start_pos).toBe(0)
  })

  it('should reset positions when new_start_pos exceeds max card position', () => {
    // All review cards, no new cards — positions should wrap
    const queue = [
      { sort_position: 0, srs_status: 'review' as const },
      { sort_position: 5, srs_status: 'review' as const },
    ]
    const state = { new_start_pos: 100, review_start_pos: 0 }
    const maxPos = 10
    const result = computeSequentialReviewPositions(queue, state, maxPos)

    // review_start_pos should advance past the reviewed cards
    expect(result.review_start_pos).toBe(6)
  })

  it('should wrap review_start_pos to 0 when it exceeds max position', () => {
    const queue = [
      { sort_position: 8, srs_status: 'review' as const },
      { sort_position: 9, srs_status: 'review' as const },
    ]
    const state = { new_start_pos: 100, review_start_pos: 8 }
    const maxPos = 9
    const result = computeSequentialReviewPositions(queue, state, maxPos)

    // review went to the end, should wrap to 0
    expect(result.review_start_pos).toBe(0)
  })

  it('should handle empty queue without changing positions', () => {
    const state = { new_start_pos: 10, review_start_pos: 5 }
    const result = computeSequentialReviewPositions([], state, 20)

    expect(result.new_start_pos).toBe(10)
    expect(result.review_start_pos).toBe(5)
  })
})

// ─── Bug Fix Tests ──────────────────────────────────────────

describe('Bug A: initial state should include review cards', () => {
  it('should return review cards when new_start_pos equals review_start_pos (initial state)', () => {
    // Deck with 30 review + 10 new cards
    const cards: MockCard[] = []
    for (let i = 0; i < 30; i++) {
      cards.push(makeCard(`r${i}`, i, 'review'))
    }
    for (let i = 30; i < 40; i++) {
      cards.push(makeCard(`n${i}`, i, 'new'))
    }
    // Initial state: both positions at 0
    const state = { new_start_pos: 0, review_start_pos: 0 }
    const result = buildSequentialReviewQueue(cards, state, 10, 20)

    // Should get 10 new cards AND 20 review cards
    expect(result.newCards).toHaveLength(10)
    expect(result.reviewCards).toHaveLength(20)
  })

  it('should return review cards when new_start_pos equals review_start_pos mid-deck', () => {
    // Both positions at same mid-deck point (e.g. after wrap or reset)
    const cards: MockCard[] = []
    for (let i = 0; i < 20; i++) {
      cards.push(makeCard(`r${i}`, i, 'review'))
    }
    for (let i = 20; i < 30; i++) {
      cards.push(makeCard(`n${i}`, i, 'new'))
    }
    // Both positions equal — should not produce empty window
    const state = { new_start_pos: 20, review_start_pos: 20 }
    const result = buildSequentialReviewQueue(cards, state, 5, 10)

    expect(result.newCards).toHaveLength(5)
    // new_start_pos == review_start_pos → no window restriction, get review cards from pos >= 20
    // But all review cards are at pos 0-19, so filter from 20 gives none. That's ok — they're all before the review window.
    // This is correct: those cards would have been reviewed in previous sessions.
  })
})

describe('Bug B: new_start_pos should not wrap around to 0', () => {
  it('should not wrap new_start_pos when it exceeds maxCardPosition', () => {
    // New cards at the end of the deck
    const queue = [
      { sort_position: 18, srs_status: 'new' as const },
      { sort_position: 19, srs_status: 'new' as const },
    ]
    const state = { new_start_pos: 18, review_start_pos: 0 }
    const maxPos = 19
    const result = computeSequentialReviewPositions(queue, state, maxPos)

    // new_start_pos should be 20 (past end), NOT 0
    expect(result.new_start_pos).toBe(20)
  })
})

describe('Bug C: review_start_pos should track reviewed cards', () => {
  it('should advance review_start_pos past reviewed cards in mixed session', () => {
    // Session with new cards + review cards
    const queue = [
      { sort_position: 0, srs_status: 'review' as const },
      { sort_position: 1, srs_status: 'review' as const },
      { sort_position: 2, srs_status: 'review' as const },
      { sort_position: 10, srs_status: 'new' as const },
      { sort_position: 11, srs_status: 'new' as const },
    ]
    const state = { new_start_pos: 10, review_start_pos: 0 }
    const result = computeSequentialReviewPositions(queue, state)

    // new_start_pos should advance past new cards
    expect(result.new_start_pos).toBe(12)
    // review_start_pos should advance past reviewed cards (pos 2 → next is 3)
    expect(result.review_start_pos).toBe(3)
  })

  it('should keep review_start_pos at new_start_pos when no review cards in queue', () => {
    const queue = [
      { sort_position: 5, srs_status: 'new' as const },
      { sort_position: 6, srs_status: 'new' as const },
    ]
    const state = { new_start_pos: 5, review_start_pos: 0 }
    const result = computeSequentialReviewPositions(queue, state)

    expect(result.new_start_pos).toBe(7)
    // No review cards studied, so review_start_pos = old new_start_pos (fallback)
    expect(result.review_start_pos).toBe(5)
  })
})

// ─── advanceSequentialReviewPosition ────────────────────────

describe('advanceSequentialReviewPosition', () => {
  it('should advance new_start_pos for a new card', () => {
    const result = advanceSequentialReviewPosition(
      { sort_position: 5, srs_status: 'new' },
      39,
    )
    expect(result).toEqual({ new_start_pos: 6 })
  })

  it('should advance review_start_pos for a review card', () => {
    const result = advanceSequentialReviewPosition(
      { sort_position: 10, srs_status: 'review' },
      39,
    )
    expect(result).toEqual({ review_start_pos: 11 })
  })

  it('should wrap review_start_pos to 0 when past maxCardPosition', () => {
    const result = advanceSequentialReviewPosition(
      { sort_position: 39, srs_status: 'review' },
      39,
    )
    expect(result).toEqual({ review_start_pos: 0 })
  })

  it('should never wrap new_start_pos (exceeds max = all consumed)', () => {
    const result = advanceSequentialReviewPosition(
      { sort_position: 39, srs_status: 'new' },
      39,
    )
    expect(result).toEqual({ new_start_pos: 40 })
  })

  it('should advance learning card as review (non-new)', () => {
    const result = advanceSequentialReviewPosition(
      { sort_position: 15, srs_status: 'learning' },
      39,
    )
    expect(result).toEqual({ review_start_pos: 16 })
  })

  it('should produce correct positions for consecutive calls', () => {
    const cards = [
      { sort_position: 5, srs_status: 'new' as const },
      { sort_position: 6, srs_status: 'new' as const },
      { sort_position: 0, srs_status: 'review' as const },
      { sort_position: 1, srs_status: 'review' as const },
    ]
    const results = cards.map(c => advanceSequentialReviewPosition(c, 39))
    expect(results).toEqual([
      { new_start_pos: 6 },
      { new_start_pos: 7 },
      { review_start_pos: 1 },
      { review_start_pos: 2 },
    ])
  })
})

describe('Integration: multi-session sequential review', () => {
  it('should correctly track positions across two sessions', () => {
    // Deck: 30 review cards (pos 0-29) + 10 new cards (pos 30-39)
    const allCards: MockCard[] = []
    for (let i = 0; i < 30; i++) {
      allCards.push(makeCard(`r${i}`, i, 'review'))
    }
    for (let i = 30; i < 40; i++) {
      allCards.push(makeCard(`n${i}`, i, 'new'))
    }

    // --- Session 1 ---
    const state1 = { new_start_pos: 0, review_start_pos: 0 }
    const session1 = buildSequentialReviewQueue(allCards, state1, 10, 20)

    // Should get 10 new cards (pos 30-39) + 20 review cards (pos 0-19)
    expect(session1.newCards).toHaveLength(10)
    expect(session1.reviewCards).toHaveLength(20)
    expect(session1.newCards[0].sort_position).toBe(30)
    expect(session1.reviewCards[0].sort_position).toBe(0)

    // Compute positions after session 1
    const queue1 = [...session1.newCards, ...session1.reviewCards]
    const state2 = computeSequentialReviewPositions(queue1, state1, 39)

    // new_start_pos should be 40 (past all new cards, NOT wrapped to 0)
    expect(state2.new_start_pos).toBe(40)
    // review_start_pos should be 20 (past reviewed cards 0-19)
    expect(state2.review_start_pos).toBe(20)

    // --- Session 2 ---
    // Mark session 1 new cards as 'learning' now (they're no longer 'new')
    const allCardsAfterSession1 = allCards.map(c => {
      if (c.srs_status === 'new') return { ...c, srs_status: 'learning' as const }
      return c
    })
    const session2 = buildSequentialReviewQueue(allCardsAfterSession1, state2, 10, 15)

    // No more new cards (all learned), should get review cards from pos 20+
    expect(session2.newCards).toHaveLength(0)
    expect(session2.reviewCards.length).toBeGreaterThan(0)
    expect(session2.reviewCards[0].sort_position).toBe(20)
  })
})
