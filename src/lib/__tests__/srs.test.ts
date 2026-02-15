import { describe, it, expect } from 'vitest'
import { calculateSRS, previewIntervals } from '../srs'
import type { Card } from '../../types/database'

function makeCard(overrides?: Partial<Card>): Card {
  return {
    id: 'card-1',
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'tmpl-1',
    field_values: { front: 'hello', back: '안녕' },
    tags: [],
    sort_position: 0,
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    next_review_at: null,
    last_reviewed_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('calculateSRS', () => {
  describe('again rating', () => {
    it('should decrease ease by 0.20, set interval=0, learning, +10min', () => {
      const card = makeCard({ ease_factor: 2.5, repetitions: 2, interval_days: 6 })
      const result = calculateSRS(card, 'again')

      expect(result.ease_factor).toBe(2.3)
      expect(result.interval_days).toBe(0)
      expect(result.repetitions).toBe(0)
      expect(result.srs_status).toBe('learning')

      // next_review_at should be ~10 minutes in the future
      const nextReview = new Date(result.next_review_at).getTime()
      const now = Date.now()
      expect(nextReview - now).toBeGreaterThan(9 * 60 * 1000)
      expect(nextReview - now).toBeLessThan(11 * 60 * 1000)
    })
  })

  describe('hard rating', () => {
    it('should decrease ease by 0.15, interval=1 when rep=0', () => {
      const card = makeCard({ ease_factor: 2.5, repetitions: 0 })
      const result = calculateSRS(card, 'hard')

      expect(result.ease_factor).toBe(2.35)
      expect(result.interval_days).toBe(1)
      expect(result.repetitions).toBe(1)
    })

    it('should multiply interval by 1.2 when rep>0', () => {
      const card = makeCard({ ease_factor: 2.5, repetitions: 2, interval_days: 10 })
      const result = calculateSRS(card, 'hard')

      expect(result.ease_factor).toBe(2.35)
      expect(result.interval_days).toBe(12) // 10 * 1.2 = 12
      expect(result.repetitions).toBe(3)
    })

    it('should preserve learning status if card is learning', () => {
      const card = makeCard({ srs_status: 'learning', repetitions: 1, interval_days: 1 })
      const result = calculateSRS(card, 'hard')
      expect(result.srs_status).toBe('learning')
    })

    it('should set status to learning when card is new (not skip to review)', () => {
      const card = makeCard({ srs_status: 'new', repetitions: 0 })
      const result = calculateSRS(card, 'hard')
      expect(result.srs_status).toBe('learning')
    })
  })

  describe('good rating', () => {
    it('should keep ease, interval=1 when rep=0', () => {
      const card = makeCard({ ease_factor: 2.5, repetitions: 0 })
      const result = calculateSRS(card, 'good')

      expect(result.ease_factor).toBe(2.5)
      expect(result.interval_days).toBe(1)
      expect(result.repetitions).toBe(1)
      expect(result.srs_status).toBe('review')
    })

    it('should set interval=3 when rep=1', () => {
      const card = makeCard({ ease_factor: 2.5, repetitions: 1, interval_days: 1 })
      const result = calculateSRS(card, 'good')

      expect(result.interval_days).toBe(3)
      expect(result.repetitions).toBe(2)
    })

    it('should multiply interval by ease when rep>=2', () => {
      const card = makeCard({ ease_factor: 2.5, repetitions: 2, interval_days: 3 })
      const result = calculateSRS(card, 'good')

      expect(result.interval_days).toBe(8) // Math.round(3 * 2.5) = 8
      expect(result.repetitions).toBe(3)
    })
  })

  describe('easy rating', () => {
    it('should increase ease by 0.15, interval=4 when rep=0', () => {
      const card = makeCard({ ease_factor: 2.5, repetitions: 0 })
      const result = calculateSRS(card, 'easy')

      expect(result.ease_factor).toBe(2.65)
      expect(result.interval_days).toBe(4)
      expect(result.repetitions).toBe(1)
      expect(result.srs_status).toBe('review')
    })

    it('should multiply interval by ease*1.3 when rep>0', () => {
      const card = makeCard({ ease_factor: 2.5, repetitions: 2, interval_days: 3 })
      const result = calculateSRS(card, 'easy')

      // ease becomes 2.65, interval = round(3 * 2.65 * 1.3) = round(10.335) = 10
      expect(result.ease_factor).toBe(2.65)
      expect(result.interval_days).toBe(10)
    })
  })

  describe('interval progression (anti-stagnation)', () => {
    it('hard on review card with interval=1 must progress to 2 (not stay at 1)', () => {
      const card = makeCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 2, interval_days: 1 })
      const result = calculateSRS(card, 'hard')
      expect(result.interval_days).toBe(2) // max(1+1, round(1*1.2)=1) = 2
    })

    it('hard on review card with interval=2 must progress to 3 (not stay at 2)', () => {
      const card = makeCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 3, interval_days: 2 })
      const result = calculateSRS(card, 'hard')
      expect(result.interval_days).toBe(3) // max(2+1, round(2*1.2)=2) = 3
    })

    it('good on review card with low ease and interval=1 must progress beyond hard', () => {
      // hard = max(1+1, round(1*1.2)=1) = 2
      // good = max(2+1=3, round(1*1.3)=1) = 3
      const card = makeCard({ srs_status: 'review', ease_factor: 1.3, repetitions: 2, interval_days: 1 })
      const result = calculateSRS(card, 'good')
      expect(result.interval_days).toBe(3)
    })

    it('good on review card with low ease and interval=2 must progress beyond hard', () => {
      // hard = max(2+1, round(2*1.2)=2) = 3
      // good = max(3+1=4, round(2*1.3)=3) = 4
      const card = makeCard({ srs_status: 'review', ease_factor: 1.3, repetitions: 3, interval_days: 2 })
      const result = calculateSRS(card, 'good')
      expect(result.interval_days).toBe(4)
    })

    it('easy interval must always be greater than good interval for same card', () => {
      const card = makeCard({ srs_status: 'review', ease_factor: 1.3, repetitions: 2, interval_days: 1 })
      const good = calculateSRS(card, 'good')
      const easy = calculateSRS(card, 'easy')
      expect(easy.interval_days).toBeGreaterThan(good.interval_days)
    })

    it('good interval must always be greater than hard interval for same card', () => {
      const card = makeCard({ srs_status: 'review', ease_factor: 1.3, repetitions: 2, interval_days: 1 })
      const hard = calculateSRS(card, 'hard')
      const good = calculateSRS(card, 'good')
      expect(good.interval_days).toBeGreaterThan(hard.interval_days)
    })

    it('interval ordering: hard < good < easy for review card with large interval', () => {
      const card = makeCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 5, interval_days: 30 })
      const hard = calculateSRS(card, 'hard')
      const good = calculateSRS(card, 'good')
      const easy = calculateSRS(card, 'easy')
      expect(hard.interval_days).toBeLessThan(good.interval_days)
      expect(good.interval_days).toBeLessThan(easy.interval_days)
    })
  })

  describe('ease factor bounds', () => {
    it('should not go below 1.3', () => {
      // Start with low ease, hit again multiple times
      const card = makeCard({ ease_factor: 1.4 })
      const result = calculateSRS(card, 'again')
      expect(result.ease_factor).toBe(1.3) // 1.4 - 0.2 = 1.2 → clamped to 1.3
    })

    it('should not go above 4.0', () => {
      const card = makeCard({ ease_factor: 3.9, repetitions: 1, interval_days: 1 })
      const result = calculateSRS(card, 'easy')
      expect(result.ease_factor).toBe(4.0) // 3.9 + 0.15 = 4.05 → clamped to 4.0
    })
  })
})

describe('previewIntervals', () => {
  it('should return 4 interval preview strings', () => {
    const card = makeCard()
    const preview = previewIntervals(card)

    expect(preview.again).toBe('10분')
    expect(preview.hard).toBe('1일')
    expect(preview.good).toBe('1일')
    expect(preview.easy).toBe('4일')
  })

  it('should show larger intervals for reviewed cards', () => {
    const card = makeCard({ ease_factor: 2.5, repetitions: 3, interval_days: 10 })
    const preview = previewIntervals(card)

    expect(preview.again).toBe('10분')
    expect(preview.hard).toBe('12일')
    expect(preview.good).toBe('25일')  // round(10 * 2.5) = 25
  })
})
