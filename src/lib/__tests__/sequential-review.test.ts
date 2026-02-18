import { describe, it, expect } from 'vitest'
import {
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

      // Should get cards from pos >= 2
      expect(result.reviewCards.map(c => c.id)).toEqual(['c3', 'c4'])
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
