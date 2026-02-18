import { describe, it, expect, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => opts?.count !== undefined ? `${key}:${opts.count}` : key },
}))

import { SrsQueueManager } from '../study-queue'
import type { SrsCardData } from '../srs'

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

  describe('rateCard — again requeue', () => {
    it('should requeue card when rated again', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3'), makeCard('c4')]
      const mgr = new SrsQueueManager(cards)

      // Rate first card as "again"
      const firstCard = mgr.currentCard()!
      mgr.rateCard('again')

      // The card should be re-inserted later in the queue
      // So we should NOT see c1 as the current card anymore
      expect(mgr.currentCard()!.id).not.toBe(firstCard.id)

      // But remaining should still include the requeued card
      // Original: 4 cards. After rating 1 as 'again': 3 remaining + 1 requeued = still need to go through 3+1
      expect(mgr.remaining()).toBeGreaterThanOrEqual(3)
    })

    it('should show requeued card after REQUEUE_GAP cards', () => {
      const cards = [
        makeCard('c1'),
        makeCard('c2'),
        makeCard('c3'),
        makeCard('c4'),
        makeCard('c5'),
      ]
      const mgr = new SrsQueueManager(cards)

      // Rate c1 as "again" — it should reappear after a gap
      mgr.rateCard('again')

      // Go through remaining cards, collecting IDs
      const seen: string[] = []
      while (!mgr.isComplete()) {
        const card = mgr.currentCard()!
        seen.push(card.id)
        mgr.rateCard('good')
      }

      // c1 must appear again in the sequence
      const c1Occurrences = seen.filter(id => id === 'c1').length
      expect(c1Occurrences).toBeGreaterThanOrEqual(1)
    })

    it('should handle multiple again ratings on same card', () => {
      const cards = [
        makeCard('c1'),
        makeCard('c2'),
        makeCard('c3'),
        makeCard('c4'),
        makeCard('c5'),
        makeCard('c6'),
        makeCard('c7'),
        makeCard('c8'),
      ]
      const mgr = new SrsQueueManager(cards)

      // Rate c1 as "again"
      mgr.rateCard('again')

      // Go through until c1 appears again, rate it "again" once more
      let sawC1Again = false
      const maxIterations = 20
      let iterations = 0
      while (!mgr.isComplete() && iterations < maxIterations) {
        const card = mgr.currentCard()!
        if (card.id === 'c1' && !sawC1Again) {
          sawC1Again = true
          mgr.rateCard('again') // again for the second time
        } else {
          mgr.rateCard('good')
        }
        iterations++
      }

      expect(sawC1Again).toBe(true)
    })

    it('should have max requeue limit to prevent infinite loops', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const mgr = new SrsQueueManager(cards)

      // Rate everything as "again" repeatedly — should eventually end
      let iterations = 0
      const MAX_SAFE = 100
      while (!mgr.isComplete() && iterations < MAX_SAFE) {
        mgr.rateCard('again')
        iterations++
      }

      // Should have completed before hitting safety limit
      expect(iterations).toBeLessThan(MAX_SAFE)
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
    it('should track number of unique cards studied', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const mgr = new SrsQueueManager(cards)

      expect(mgr.studiedCount()).toBe(0)
      mgr.rateCard('good')
      expect(mgr.studiedCount()).toBe(1)
      mgr.rateCard('good')
      expect(mgr.studiedCount()).toBe(2)
    })

    it('should count requeued card as additional study when re-rated', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const mgr = new SrsQueueManager(cards)

      mgr.rateCard('again') // study #1 for c1
      mgr.rateCard('good')  // c2
      mgr.rateCard('good')  // c3 or c1 requeued

      // Should count every rating action
      expect(mgr.studiedCount()).toBe(3)
    })
  })

  describe('totalCards', () => {
    it('should return original card count (not including requeues)', () => {
      const cards = [makeCard('c1'), makeCard('c2'), makeCard('c3')]
      const mgr = new SrsQueueManager(cards)

      expect(mgr.totalCards()).toBe(3)
      mgr.rateCard('again')
      // totalCards shouldn't change with requeues
      expect(mgr.totalCards()).toBe(3)
    })
  })

  describe('getSrsResult', () => {
    it('should return the SRS calculation result for a card rating', () => {
      const cards = [makeCard('c1', { srs_status: 'new', ease_factor: 2.5, repetitions: 0 })]
      const mgr = new SrsQueueManager(cards)

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
      const settings = { again_days: 1, hard_days: 2, good_days: 3, easy_days: 7 }
      const mgr = new SrsQueueManager(cards, settings)

      const result = mgr.getSrsResult('good')
      expect(result!.interval_days).toBe(3)
    })
  })
})
