import { describe, it, expect, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => opts?.count !== undefined ? `${key}:${opts.count}` : key },
}))

import { SrsQueueManager } from '@reeeeecall/shared/lib/study-queue'
import type { SrsCardData } from '@reeeeecall/shared/lib/srs'

// ─── Helpers ────────────────────────────────────────────────

function makeCard(id: string, overrides?: Partial<SrsCardData & { id: string }>): SrsCardData & { id: string } {
  return {
    id,
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    ...overrides,
  }
}

// ─── SrsQueueManager ───────────────────────────────────────

describe('SrsQueueManager', () => {
  describe('initialization', () => {
    it('should initialize with given cards', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const mgr = new SrsQueueManager(cards)

      expect(mgr.remaining()).toBe(3)
      expect(mgr.isComplete()).toBe(false)
    })

    it('should be complete immediately when initialized with empty array', () => {
      const mgr = new SrsQueueManager([])

      expect(mgr.remaining()).toBe(0)
      expect(mgr.isComplete()).toBe(true)
    })

    it('should order learning cards first, then review, then new', () => {
      const cards = [
        makeCard('new1', { srs_status: 'new' }),
        makeCard('review1', { srs_status: 'review' }),
        makeCard('learning1', { srs_status: 'learning' }),
        makeCard('new2', { srs_status: 'new' }),
      ]
      const mgr = new SrsQueueManager(cards)

      // learning first, then review, then new
      expect(mgr.currentCard()!.id).toBe('learning1')
    })
  })

  describe('nextCard / currentCard', () => {
    it('should return current card without advancing', () => {
      const cards = [makeCard('c1'), makeCard('c2')]
      const mgr = new SrsQueueManager(cards)

      const card1 = mgr.currentCard()
      const card1Again = mgr.currentCard()
      expect(card1!.id).toBe(card1Again!.id)
    })

    it('should return null when complete', () => {
      const mgr = new SrsQueueManager([])
      expect(mgr.currentCard()).toBeNull()
    })
  })

  describe('rateCard — explicit scheduling', () => {
    it('does not infer a requeue from the rating string alone', () => {
      const mgr = new SrsQueueManager([makeCard('c1'), makeCard('c2')])

      mgr.rateCard('again')
      mgr.rateCard('good')

      expect(mgr.isComplete()).toBe(true)
      expect(mgr.studiedCount()).toBe(2)
    })
  })

  describe('rateCard — good/hard/easy advance', () => {
    it('should advance to next card when rated good', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const mgr = new SrsQueueManager(cards)

      mgr.rateCard('good')
      expect(mgr.currentCard()!.id).not.toBe('c1')
      expect(mgr.remaining()).toBe(2)
    })

    it('should advance to next card when rated hard', () => {
      const cards = [makeCard('c1'), makeCard('c2')]
      const mgr = new SrsQueueManager(cards)

      mgr.rateCard('hard')
      expect(mgr.remaining()).toBe(1)
    })

    it('should advance to next card when rated easy', () => {
      const cards = [makeCard('c1'), makeCard('c2')]
      const mgr = new SrsQueueManager(cards)

      mgr.rateCard('easy')
      expect(mgr.remaining()).toBe(1)
    })

    it('should complete after rating all cards', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const mgr = new SrsQueueManager(cards)

      mgr.rateCard('good')
      mgr.rateCard('good')
      mgr.rateCard('good')

      expect(mgr.isComplete()).toBe(true)
      expect(mgr.remaining()).toBe(0)
    })
  })

  describe('studiedCount', () => {
    it('should count every rating action', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const mgr = new SrsQueueManager(cards)

      expect(mgr.studiedCount()).toBe(0)
      mgr.rateCard('good')
      expect(mgr.studiedCount()).toBe(1)
      mgr.rateCard('hard')
      expect(mgr.studiedCount()).toBe(2)
      mgr.rateCard('easy')
      expect(mgr.studiedCount()).toBe(3)
    })
  })

  describe('totalCards', () => {
    it('should return the original card count', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const mgr = new SrsQueueManager(cards)

      expect(mgr.totalCards()).toBe(3)
      mgr.rateCard('again')
      expect(mgr.totalCards()).toBe(3)
    })
  })

  describe('getSrsResult', () => {
    it('should return the SRS calculation result for a card rating (with learning steps)', () => {
      const cards = [makeCard('c1', { srs_status: 'new', ease_factor: 2.5, repetitions: 0 })]
      const mgr = new SrsQueueManager(cards)

      const result = mgr.getSrsResult('good')
      expect(result).toBeDefined()
      // With default learning_steps [1, 10], good on new card → step 1 (learning)
      expect(result!.srs_status).toBe('learning')
      expect(result!.interval_days).toBe(0)
      expect(result!.repetitions).toBe(1)
    })

    it('should return review status when no learning steps', () => {
      const cards = [makeCard('c1', { srs_status: 'new', ease_factor: 2.5, repetitions: 0 })]
      const settings = { again_days: 0, hard_days: 1, good_days: 1, easy_days: 4, learning_steps: [] as number[] }
      const mgr = new SrsQueueManager(cards, settings)

      const result = mgr.getSrsResult('good')
      expect(result).toBeDefined()
      expect(result!.srs_status).toBe('review')
      expect(result!.interval_days).toBe(1)
    })

    it('should return null when no current card', () => {
      const mgr = new SrsQueueManager([])
      expect(mgr.getSrsResult('good')).toBeNull()
    })

    it('should use custom SRS settings when provided', () => {
      const cards = [makeCard('c1', { srs_status: 'new', repetitions: 0 })]
      const settings = { again_days: 1, hard_days: 2, good_days: 3, easy_days: 7, learning_steps: [] as number[] }
      const mgr = new SrsQueueManager(cards, settings)

      const result = mgr.getSrsResult('good')
      expect(result!.interval_days).toBe(3)
    })
  })
})
