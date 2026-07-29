import { describe, expect, it } from 'vitest'

import {
  buildSequentialQueue,
  buildSequentialReviewQueue,
  computeSequentialPosition,
  computeSequentialReviewPositions,
} from '../study-session-utils'

interface MockCard {
  id: string
  sort_position: number
  srs_status: 'new' | 'learning' | 'review' | 'suspended'
}

function card(
  id: string,
  sortPosition: number,
  status: MockCard['srs_status'] = 'new',
): MockCard {
  return { id, sort_position: sortPosition, srs_status: status }
}

describe('sequential cursor safety', () => {
  describe('buildSequentialQueue', () => {
    it('includes the complete sort-position tie group at the batch boundary', () => {
      const cards = [
        card('p0', 0),
        card('tie-c', 1),
        card('tie-a', 1),
        card('tie-b', 1),
        card('p2', 2),
      ]

      const result = buildSequentialQueue(cards, 0, 2)

      expect(result.map(item => item.id)).toEqual(['p0', 'tie-a', 'tie-b', 'tie-c'])
    })

    it('sorts identical positions by card ID', () => {
      const cards = [card('z', 5), card('a', 5), card('m', 5)]

      expect(buildSequentialQueue(cards, 0, 1).map(item => item.id)).toEqual(['a', 'm', 'z'])
    })

    it('wraps once to recover eligible cards moved before the cursor', () => {
      const cards = [card('moved', 1), card('before', 2), card('after', 12)]

      expect(buildSequentialQueue(cards, 10, 3).map(item => item.id)).toEqual([
        'after',
        'moved',
        'before',
      ])
    })

    it('deduplicates IDs across primary and wrapped segments', () => {
      const cards = [
        card('same', 12),
        card('same', 1),
        card('other', 2),
      ]

      const result = buildSequentialQueue(cards, 10, 3)

      expect(result.map(item => item.id)).toEqual(['same', 'other'])
      expect(new Set(result.map(item => item.id)).size).toBe(result.length)
    })

    it('excludes suspended cards and handles empty or zero-sized requests', () => {
      expect(buildSequentialQueue([card('blocked', 0, 'suspended')], 0, 10)).toEqual([])
      expect(buildSequentialQueue([], 0, 10)).toEqual([])
      expect(buildSequentialQueue([card('card', 0)], 0, 0)).toEqual([])
    })

    it('wraps from a cursor beyond the maximum position without splitting a tie', () => {
      const cards = [card('a', 0), card('b', 1), card('c', 1), card('d', 2)]

      expect(buildSequentialQueue(cards, Number.MAX_SAFE_INTEGER, 2).map(item => item.id)).toEqual([
        'a',
        'b',
        'c',
      ])
    })
  })

  describe('buildSequentialReviewQueue', () => {
    it('wraps new cards before new_start_pos when the primary segment is short', () => {
      const cards = [
        card('moved-new', 1, 'new'),
        card('after-new', 12, 'new'),
        card('review', 2, 'review'),
      ]

      const result = buildSequentialReviewQueue(
        cards,
        { new_start_pos: 10, review_start_pos: 0 },
        2,
        0,
      )

      expect(result.newCards.map(item => item.id)).toEqual(['after-new', 'moved-new'])
    })

    it('keeps the complete review tie group at the batch boundary', () => {
      const cards = [
        card('r0', 0, 'review'),
        card('r1-c', 1, 'review'),
        card('r1-a', 1, 'learning'),
        card('r1-b', 1, 'review'),
        card('r2', 2, 'review'),
      ]

      const result = buildSequentialReviewQueue(
        cards,
        { new_start_pos: 100, review_start_pos: 0 },
        10,
        2,
      )

      expect(result.reviewCards.map(item => item.id)).toEqual(['r0', 'r1-a', 'r1-b', 'r1-c'])
    })

    it('does not duplicate review IDs when wrapping', () => {
      const cards = [
        card('same', 12, 'review'),
        card('same', 1, 'review'),
        card('other', 2, 'learning'),
      ]

      const result = buildSequentialReviewQueue(
        cards,
        { new_start_pos: 100, review_start_pos: 10 },
        10,
        3,
      )

      expect(result.reviewCards.map(item => item.id)).toEqual(['same', 'other'])
    })
  })
})

describe('tie-safe cursor persistence on early exit', () => {
  it('keeps the plain sequential cursor at the next unstudied tie position', () => {
    const queue = [card('p0', 0), card('tie-a', 1), card('tie-b', 1), card('p2', 2)]

    expect(computeSequentialPosition(queue, 2, 0, 2)).toBe(1)
  })

  it('keeps review_start_pos at the next unstudied review tie position', () => {
    const queue = [
      card('r0', 0, 'review'),
      card('tie-a', 1, 'review'),
      card('tie-b', 1, 'learning'),
      card('r2', 2, 'review'),
    ]

    expect(computeSequentialReviewPositions(
      queue,
      { new_start_pos: 100, review_start_pos: 0 },
      2,
      2,
    )).toEqual({ new_start_pos: 100, review_start_pos: 1 })
  })

  it('keeps new_start_pos at the next unstudied new tie position', () => {
    const queue = [card('n0', 0), card('tie-a', 1), card('tie-b', 1), card('n2', 2)]

    expect(computeSequentialReviewPositions(
      queue,
      { new_start_pos: 0, review_start_pos: 0 },
      2,
      2,
    )).toEqual({ new_start_pos: 1, review_start_pos: 0 })
  })
})
