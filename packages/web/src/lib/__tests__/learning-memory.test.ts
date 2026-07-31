// ─── Memory model (FSRS retrievability → review value) ──────────────────────
//
// What these tests pin, and why each one exists:
//   * the FSRS identity R(S) = 0.9 — the curve constants are DERIVED from the definition of
//     stability, so if someone "tunes" FACTOR or DECAY this must go red;
//   * "unknown" stays null and never becomes 0 or 0.5 (design §9.2);
//   * the value curve peaks below certainty and is asymmetric — that IS the behaviour change
//     this workstream is about, so it is asserted, not assumed.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TARGET_RETENTION,
  FSRS_DECAY,
  FSRS_FACTOR,
  REVIEW_VALUE_AT_ZERO_RECALL,
  elapsedDaysBetween,
  estimateMemory,
  retrievability,
  reviewValue,
  stabilityFromInterval,
} from '@reeeeecall/shared/learning'

const NOW = '2026-07-31T00:00:00.000Z'

describe('retrievability', () => {
  it('is exactly 0.9 after one stability period — the definition the constants come from', () => {
    for (const stability of [1, 3, 10, 365]) {
      expect(retrievability(stability, stability)).toBeCloseTo(0.9, 12)
    }
    // Stated as the algebra too, so a change to either constant cannot pass by luck.
    expect(FSRS_FACTOR).toBeCloseTo(19 / 81, 12)
    expect(FSRS_DECAY).toBe(-0.5)
    expect(Math.pow(1 + FSRS_FACTOR, FSRS_DECAY)).toBeCloseTo(DEFAULT_TARGET_RETENTION, 12)
  })

  it('decays monotonically with elapsed time and stays in 0..1', () => {
    const points = [0.5, 1, 2, 5, 20, 100, 10_000].map((days) => retrievability(days, 10))
    for (const value of points) {
      expect(value).not.toBeNull()
      expect(value as number).toBeGreaterThanOrEqual(0)
      expect(value as number).toBeLessThanOrEqual(1)
    }
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i] as number).toBeLessThan(points[i - 1] as number)
    }
  })

  it('treats a card reviewed at or after now as fully retained, not out of range', () => {
    expect(retrievability(0, 10)).toBe(1)
    expect(retrievability(-3, 10)).toBe(1) // clock skew, bounded rather than extrapolated
  })

  it('returns null — never 0 — when stability is unknown or unusable', () => {
    expect(retrievability(5, 0)).toBeNull()
    expect(retrievability(5, -1)).toBeNull()
    expect(retrievability(Number.NaN, 10)).toBeNull()
    expect(retrievability(5, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('is stability-relative: the same lateness means different things', () => {
    // Five days late on a 3-day memory is a different situation from five days late on a
    // 300-day memory. v1's dueUrgency could not tell these apart; this is why it lost weight.
    const fragile = retrievability(5, 3) as number
    const durable = retrievability(5, 300) as number
    expect(fragile).toBeLessThan(durable)
    expect(durable).toBeGreaterThan(0.95)
  })
})

describe('stabilityFromInterval', () => {
  it('bridges a legacy SM-2 interval as-is', () => {
    expect(stabilityFromInterval(7)).toBe(7)
    expect(stabilityFromInterval(0.5)).toBe(0.5)
  })

  it('has no stability to report for a card with no interval', () => {
    expect(stabilityFromInterval(0)).toBeNull()      // learning-step card
    expect(stabilityFromInterval(null)).toBeNull()
    expect(stabilityFromInterval(undefined)).toBeNull()
    expect(stabilityFromInterval(-3)).toBeNull()
  })
})

describe('elapsedDaysBetween', () => {
  it('measures fractional days', () => {
    expect(elapsedDaysBetween('2026-07-30T00:00:00.000Z', NOW)).toBeCloseTo(1, 9)
    expect(elapsedDaysBetween('2026-07-30T12:00:00.000Z', NOW)).toBeCloseTo(0.5, 9)
  })

  it('is null for a missing or unparseable timestamp', () => {
    expect(elapsedDaysBetween(null, NOW)).toBeNull()
    expect(elapsedDaysBetween(undefined, NOW)).toBeNull()
    expect(elapsedDaysBetween('not-a-date', NOW)).toBeNull()
    expect(elapsedDaysBetween(NOW, 'not-a-date')).toBeNull()
  })
})

describe('reviewValue', () => {
  it('peaks at the target retention, not at certainty', () => {
    expect(reviewValue(DEFAULT_TARGET_RETENTION)).toBeCloseTo(1, 12)
    expect(reviewValue(1)).toBeCloseTo(0, 12)
    expect(reviewValue(0.95)).toBeLessThan(1)
    expect(reviewValue(0.95) as number).toBeGreaterThan(0)
  })

  it('ranks an at-risk item above a certainly-known one at the same distance', () => {
    const above = reviewValue(DEFAULT_TARGET_RETENTION + 0.05) as number
    const below = reviewValue(DEFAULT_TARGET_RETENTION - 0.05) as number
    expect(below).toBeGreaterThan(above)
  })

  it('floors on the at-risk side instead of collapsing to zero', () => {
    // A forgotten card is worth less than one caught at the peak and much more than one the
    // learner is certain to know. Zero would mean "not worth relearning", which is never true.
    expect(reviewValue(0)).toBeCloseTo(REVIEW_VALUE_AT_ZERO_RECALL, 12)
    expect(REVIEW_VALUE_AT_ZERO_RECALL).toBeCloseTo(0.6, 12)
    expect(reviewValue(0) as number).toBeGreaterThan(reviewValue(0.99) as number)
  })

  it('honours a custom target and clamps a nonsensical one', () => {
    expect(reviewValue(0.7, 0.7)).toBeCloseTo(1, 12)
    expect(reviewValue(0.9, 0.7)).toBeLessThan(1)
    // A target of 0 or 1 would divide by zero; clamped instead of throwing at plan time.
    expect(Number.isFinite(reviewValue(0.5, 0) as number)).toBe(true)
    expect(Number.isFinite(reviewValue(0.5, 1) as number)).toBe(true)
    expect(Number.isFinite(reviewValue(0.5, Number.NaN) as number)).toBe(true)
  })

  it('propagates unknown recall as unknown value', () => {
    expect(reviewValue(null)).toBeNull()
  })
})

describe('estimateMemory', () => {
  it('estimates from a legacy SRS row', () => {
    const estimate = estimateMemory({
      intervalDays: 10,
      lastReviewedAt: '2026-07-21T00:00:00.000Z', // 10 days ago == one stability period
      now: NOW,
    })
    expect(estimate.stabilityDays).toBe(10)
    expect(estimate.elapsedDays).toBeCloseTo(10, 9)
    expect(estimate.retrievability).toBeCloseTo(0.9, 12)
    expect(estimate.reviewValue).toBeCloseTo(1, 12)
  })

  it('reports null for a brand-new card rather than 0% recall', () => {
    const neverReviewed = estimateMemory({ intervalDays: 0, lastReviewedAt: null, now: NOW })
    expect(neverReviewed.retrievability).toBeNull()
    expect(neverReviewed.reviewValue).toBeNull()

    const noInterval = estimateMemory({ intervalDays: null, lastReviewedAt: '2026-07-01T00:00:00.000Z', now: NOW })
    expect(noInterval.retrievability).toBeNull()
    expect(noInterval.reviewValue).toBeNull()
  })

  it('prefers a fitted stability over the interval bridge when one exists', () => {
    const estimate = estimateMemory({
      intervalDays: 10,
      stabilityDays: 40,
      lastReviewedAt: '2026-07-21T00:00:00.000Z',
      now: NOW,
    })
    expect(estimate.stabilityDays).toBe(40)
    expect(estimate.retrievability as number).toBeGreaterThan(0.9)
  })

  it('scores a long-overdue card below one caught at its peak', () => {
    const atPeak = estimateMemory({ intervalDays: 10, lastReviewedAt: '2026-07-21T00:00:00.000Z', now: NOW })
    const longGone = estimateMemory({ intervalDays: 10, lastReviewedAt: '2026-01-01T00:00:00.000Z', now: NOW })
    expect(longGone.retrievability as number).toBeLessThan(atPeak.retrievability as number)
    expect(longGone.reviewValue as number).toBeLessThan(atPeak.reviewValue as number)
    // ...and still above a card that needs nothing.
    const justDone = estimateMemory({ intervalDays: 10, lastReviewedAt: NOW, now: NOW })
    expect(longGone.reviewValue as number).toBeGreaterThan(justDone.reviewValue as number)
  })
})
