import { describe, it, expect, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => opts?.count !== undefined ? `${key}:${opts.count}` : key },
}))

import { calculateSRS, previewIntervals, nextDayBoundary, formatMinutes } from '../srs'
import type { SrsCardData } from '../srs'
import type { Card, SrsSettings } from '../../types/database'
import { DEFAULT_SRS_SETTINGS } from '../../types/database'

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

function makeSrsCard(overrides?: Partial<SrsCardData>): SrsCardData {
  return {
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    ...overrides,
  }
}

// ── nextDayBoundary ─────────────────────────────────────

describe('nextDayBoundary', () => {
  it('should schedule to next morning (4AM) for 1-day interval at night', () => {
    // Study at 10 PM → should be next day 4 AM
    const now = new Date('2025-06-15T22:00:00')
    const result = nextDayBoundary(now, 1)
    expect(result.getHours()).toBe(4)
    expect(result.getMinutes()).toBe(0)
    expect(result.getDate()).toBe(16) // next day
  })

  it('should schedule to tomorrow 4AM for 1-day interval at morning', () => {
    // Study at 8 AM → should be next day 4 AM
    const now = new Date('2025-06-15T08:00:00')
    const result = nextDayBoundary(now, 1)
    expect(result.getHours()).toBe(4)
    expect(result.getDate()).toBe(16)
  })

  it('should schedule to same day 4AM boundary when studying at 2 AM (before dayStart)', () => {
    // Study at 2 AM → still in "previous SRS day", +1 day = today 4 AM
    const now = new Date('2025-06-15T02:00:00')
    const result = nextDayBoundary(now, 1)
    expect(result.getHours()).toBe(4)
    expect(result.getDate()).toBe(15) // same calendar day, but next SRS day
  })

  it('should handle multi-day intervals', () => {
    const now = new Date('2025-06-15T20:00:00')
    const result = nextDayBoundary(now, 3)
    expect(result.getHours()).toBe(4)
    expect(result.getDate()).toBe(18) // 3 days later
  })

  it('should handle custom dayStartHour', () => {
    const now = new Date('2025-06-15T22:00:00')
    const result = nextDayBoundary(now, 1, 6) // 6 AM boundary
    expect(result.getHours()).toBe(6)
    expect(result.getDate()).toBe(16)
  })
})

// ── Learning Phase (new/learning cards with steps) ──────

describe('calculateSRS — Learning Phase', () => {
  const defaultSteps = DEFAULT_SRS_SETTINGS // learning_steps: [1, 10]

  describe('new card', () => {
    it('again → reset to step 0, +1 min', () => {
      const card = makeSrsCard({ srs_status: 'new' })
      const result = calculateSRS(card, 'again', defaultSteps)

      expect(result.srs_status).toBe('learning')
      expect(result.interval_days).toBe(0)
      expect(result.repetitions).toBe(0) // step 0
      expect(result.ease_factor).toBe(2.3) // -0.20

      const nextReview = new Date(result.next_review_at).getTime()
      const now = Date.now()
      expect(nextReview - now).toBeGreaterThan(0.5 * 60 * 1000) // ~1 min
      expect(nextReview - now).toBeLessThan(2 * 60 * 1000)
    })

    it('hard → stay at step 0, +1 min', () => {
      const card = makeSrsCard({ srs_status: 'new' })
      const result = calculateSRS(card, 'hard', defaultSteps)

      expect(result.srs_status).toBe('learning')
      expect(result.interval_days).toBe(0)
      expect(result.repetitions).toBe(0) // stays at step 0
      expect(result.ease_factor).toBe(2.35) // -0.15

      const nextReview = new Date(result.next_review_at).getTime()
      const now = Date.now()
      expect(nextReview - now).toBeGreaterThan(0.5 * 60 * 1000)
      expect(nextReview - now).toBeLessThan(2 * 60 * 1000)
    })

    it('good → move to step 1, +10 min', () => {
      const card = makeSrsCard({ srs_status: 'new' })
      const result = calculateSRS(card, 'good', defaultSteps)

      expect(result.srs_status).toBe('learning')
      expect(result.interval_days).toBe(0)
      expect(result.repetitions).toBe(1) // step 1
      expect(result.ease_factor).toBe(2.5) // unchanged

      const nextReview = new Date(result.next_review_at).getTime()
      const now = Date.now()
      expect(nextReview - now).toBeGreaterThan(9 * 60 * 1000)
      expect(nextReview - now).toBeLessThan(11 * 60 * 1000)
    })

    it('easy → skip all steps, graduate to review', () => {
      const card = makeSrsCard({ srs_status: 'new' })
      const result = calculateSRS(card, 'easy', defaultSteps)

      expect(result.srs_status).toBe('review')
      expect(result.interval_days).toBe(4) // easy_days
      expect(result.repetitions).toBe(1) // graduated
      expect(result.ease_factor).toBe(2.65) // +0.15
    })
  })

  describe('learning card at step 1 (last step)', () => {
    it('good → graduate to review', () => {
      const card = makeSrsCard({ srs_status: 'learning', repetitions: 1 })
      const result = calculateSRS(card, 'good', defaultSteps)

      expect(result.srs_status).toBe('review')
      expect(result.interval_days).toBe(1) // good_days
      expect(result.repetitions).toBe(1)
    })

    it('again → reset to step 0', () => {
      const card = makeSrsCard({ srs_status: 'learning', repetitions: 1 })
      const result = calculateSRS(card, 'again', defaultSteps)

      expect(result.srs_status).toBe('learning')
      expect(result.repetitions).toBe(0)
      expect(result.interval_days).toBe(0)
    })

    it('hard → repeat step 1, +10 min', () => {
      const card = makeSrsCard({ srs_status: 'learning', repetitions: 1 })
      const result = calculateSRS(card, 'hard', defaultSteps)

      expect(result.srs_status).toBe('learning')
      expect(result.repetitions).toBe(1) // stays at step 1

      const nextReview = new Date(result.next_review_at).getTime()
      const now = Date.now()
      expect(nextReview - now).toBeGreaterThan(9 * 60 * 1000)
      expect(nextReview - now).toBeLessThan(11 * 60 * 1000)
    })
  })

  describe('single step [10]', () => {
    const singleStep: SrsSettings = { ...DEFAULT_SRS_SETTINGS, learning_steps: [10] }

    it('good on new card → graduate immediately (only 1 step)', () => {
      const card = makeSrsCard({ srs_status: 'new' })
      const result = calculateSRS(card, 'good', singleStep)

      expect(result.srs_status).toBe('review')
      expect(result.interval_days).toBe(1) // good_days
    })
  })

  describe('no steps (empty array) — legacy behavior', () => {
    const noSteps: SrsSettings = { ...DEFAULT_SRS_SETTINGS, learning_steps: [] }

    it('good on new card → directly to review (calculateReview path)', () => {
      const card = makeSrsCard({ srs_status: 'new' })
      const result = calculateSRS(card, 'good', noSteps)

      expect(result.srs_status).toBe('review')
      expect(result.interval_days).toBe(1)
    })
  })

  describe('no learning_steps property — backward compat', () => {
    const legacySettings: SrsSettings = { again_days: 0, hard_days: 1, good_days: 1, easy_days: 4 }

    it('good on new card → directly to review (no steps)', () => {
      const card = makeSrsCard({ srs_status: 'new' })
      const result = calculateSRS(card, 'good', legacySettings)

      expect(result.srs_status).toBe('review')
    })
  })
})

// ── Review Phase ────────────────────────────────────────

describe('calculateSRS — Review Phase', () => {
  // Use no-steps settings to test review path directly
  const reviewSettings: SrsSettings = { again_days: 0, hard_days: 1, good_days: 1, easy_days: 4, learning_steps: [] }

  describe('again rating', () => {
    it('should decrease ease by 0.20, set interval=0, learning, +10min', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 2, interval_days: 6 })
      const result = calculateSRS(card, 'again', reviewSettings)

      expect(result.ease_factor).toBe(2.3)
      expect(result.interval_days).toBe(0)
      expect(result.repetitions).toBe(0)
      expect(result.srs_status).toBe('learning')

      const nextReview = new Date(result.next_review_at).getTime()
      const now = Date.now()
      expect(nextReview - now).toBeGreaterThan(9 * 60 * 1000)
      expect(nextReview - now).toBeLessThan(11 * 60 * 1000)
    })
  })

  describe('hard rating', () => {
    it('should decrease ease by 0.15, interval=1 when rep=0', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 0 })
      const result = calculateSRS(card, 'hard', reviewSettings)

      expect(result.ease_factor).toBe(2.35)
      expect(result.interval_days).toBe(1)
      expect(result.repetitions).toBe(1)
    })

    it('should multiply interval by 1.2 when rep>0', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 2, interval_days: 10 })
      const result = calculateSRS(card, 'hard', reviewSettings)

      expect(result.ease_factor).toBe(2.35)
      expect(result.interval_days).toBe(12) // 10 * 1.2 = 12
      expect(result.repetitions).toBe(3)
    })

    it('should preserve review status for review card', () => {
      const card = makeSrsCard({ srs_status: 'review', repetitions: 1, interval_days: 1 })
      const result = calculateSRS(card, 'hard', reviewSettings)
      expect(result.srs_status).toBe('review')
    })
  })

  describe('good rating', () => {
    it('should keep ease, interval=good_days when rep=0', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 0 })
      const result = calculateSRS(card, 'good', reviewSettings)

      expect(result.ease_factor).toBe(2.5)
      expect(result.interval_days).toBe(1) // good_days
      expect(result.repetitions).toBe(1)
      expect(result.srs_status).toBe('review')
    })

    it('should set interval=3 when rep=1', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 1, interval_days: 1 })
      const result = calculateSRS(card, 'good', reviewSettings)

      expect(result.interval_days).toBe(3)
      expect(result.repetitions).toBe(2)
    })

    it('should multiply interval by ease when rep>=2', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 2, interval_days: 3 })
      const result = calculateSRS(card, 'good', reviewSettings)

      expect(result.interval_days).toBe(8) // Math.round(3 * 2.5) = 8
      expect(result.repetitions).toBe(3)
    })
  })

  describe('easy rating', () => {
    it('should increase ease by 0.15, interval=easy_days when rep=0', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 0 })
      const result = calculateSRS(card, 'easy', reviewSettings)

      expect(result.ease_factor).toBe(2.65)
      expect(result.interval_days).toBe(4) // easy_days
      expect(result.repetitions).toBe(1)
      expect(result.srs_status).toBe('review')
    })

    it('should multiply interval by ease*1.3 when rep>0', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 2, interval_days: 3 })
      const result = calculateSRS(card, 'easy', reviewSettings)

      expect(result.ease_factor).toBe(2.65)
      expect(result.interval_days).toBe(10) // round(3 * 2.65 * 1.3) = 10
    })
  })

  describe('interval progression (anti-stagnation)', () => {
    it('hard on review card with interval=1 must progress to 2', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 2, interval_days: 1 })
      const result = calculateSRS(card, 'hard', reviewSettings)
      expect(result.interval_days).toBe(2)
    })

    it('hard on review card with interval=2 must progress to 3', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 3, interval_days: 2 })
      const result = calculateSRS(card, 'hard', reviewSettings)
      expect(result.interval_days).toBe(3)
    })

    it('good on review card with low ease and interval=1 must progress beyond hard', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 1.3, repetitions: 2, interval_days: 1 })
      const result = calculateSRS(card, 'good', reviewSettings)
      expect(result.interval_days).toBe(3)
    })

    it('good on review card with low ease and interval=2 must progress beyond hard', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 1.3, repetitions: 3, interval_days: 2 })
      const result = calculateSRS(card, 'good', reviewSettings)
      expect(result.interval_days).toBe(4)
    })

    it('easy interval must always be greater than good interval for same card', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 1.3, repetitions: 2, interval_days: 1 })
      const good = calculateSRS(card, 'good', reviewSettings)
      const easy = calculateSRS(card, 'easy', reviewSettings)
      expect(easy.interval_days).toBeGreaterThan(good.interval_days)
    })

    it('good interval must always be greater than hard interval for same card', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 1.3, repetitions: 2, interval_days: 1 })
      const hard = calculateSRS(card, 'hard', reviewSettings)
      const good = calculateSRS(card, 'good', reviewSettings)
      expect(good.interval_days).toBeGreaterThan(hard.interval_days)
    })

    it('interval ordering: hard < good < easy for review card with large interval', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 5, interval_days: 30 })
      const hard = calculateSRS(card, 'hard', reviewSettings)
      const good = calculateSRS(card, 'good', reviewSettings)
      const easy = calculateSRS(card, 'easy', reviewSettings)
      expect(hard.interval_days).toBeLessThan(good.interval_days)
      expect(good.interval_days).toBeLessThan(easy.interval_days)
    })
  })

  describe('ease factor bounds', () => {
    it('should not go below 1.3', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 1.4 })
      const result = calculateSRS(card, 'again', reviewSettings)
      expect(result.ease_factor).toBe(1.3)
    })

    it('should not go above 4.0', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 3.9, repetitions: 1, interval_days: 1 })
      const result = calculateSRS(card, 'easy', reviewSettings)
      expect(result.ease_factor).toBe(4.0)
    })
  })

  describe('nextDayBoundary is used for review scheduling', () => {
    it('review card good → next_review_at has hour=4 (day boundary)', () => {
      const card = makeSrsCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 2, interval_days: 3 })
      const result = calculateSRS(card, 'good', reviewSettings)
      const reviewDate = new Date(result.next_review_at)
      expect(reviewDate.getHours()).toBe(4)
      expect(reviewDate.getMinutes()).toBe(0)
    })
  })
})

// ── Preview ─────────────────────────────────────────────

describe('previewIntervals', () => {
  it('should show minute-based previews for new card with learning steps', () => {
    const card = makeCard()
    const preview = previewIntervals(card)

    // again → step[0] = 1 min
    expect(preview.again).toBe('study:interval.minutes:1')
    // hard → step[0] = 1 min
    expect(preview.hard).toBe('study:interval.minutes:1')
    // good → step[1] = 10 min
    expect(preview.good).toBe('study:interval.minutes:10')
    // easy → graduate, 4 days
    expect(preview.easy).toBe('study:interval.days:4')
  })

  it('should show day-based previews for review cards', () => {
    const card = makeCard({ srs_status: 'review', ease_factor: 2.5, repetitions: 3, interval_days: 10 })
    // Review cards go through calculateReview which uses no learning steps
    const settings: SrsSettings = { ...DEFAULT_SRS_SETTINGS, learning_steps: [] }
    const preview = previewIntervals(card, settings)

    expect(preview.again).toBe('study:interval.lessThanTenMin')
    expect(preview.hard).toBe('study:interval.days:12')
    expect(preview.good).toBe('study:interval.days:25')
  })

  it('should handle learning card at last step', () => {
    const card = makeCard({ srs_status: 'learning', repetitions: 1 })
    const preview = previewIntervals(card)

    // again → step[0] = 1 min
    expect(preview.again).toBe('study:interval.minutes:1')
    // hard → step[1] = 10 min
    expect(preview.hard).toBe('study:interval.minutes:10')
    // good → graduate → 1 day
    expect(preview.good).toBe('study:interval.oneDay')
    // easy → graduate → 4 days
    expect(preview.easy).toBe('study:interval.days:4')
  })
})

// ── formatMinutes ───────────────────────────────────────

describe('formatMinutes', () => {
  it('should format minutes < 60', () => {
    expect(formatMinutes(1)).toBe('study:interval.minutes:1')
    expect(formatMinutes(10)).toBe('study:interval.minutes:10')
    expect(formatMinutes(30)).toBe('study:interval.minutes:30')
  })

  it('should format minutes >= 60 as hours', () => {
    expect(formatMinutes(60)).toBe('study:interval.hours:1')
    expect(formatMinutes(120)).toBe('study:interval.hours:2')
    expect(formatMinutes(90)).toBe('study:interval.hours:2') // rounds
  })
})
