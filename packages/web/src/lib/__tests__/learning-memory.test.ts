// ─── Memory model (FSRS retrievability → review value) ──────────────────────
//
// What these tests pin, and why each one exists:
//   * the FSRS identity R(S) = 0.9 — the curve constants are DERIVED from the definition of
//     stability, so if someone "tunes" FACTOR or DECAY this must go red;
//   * "unknown" stays null and never becomes 0 or 0.5 (design §9.2);
//   * the value curve is MONOTONE non-increasing in recall probability. It used to peak at the
//     target and fall away on both sides, which ranked the cards the learner had most nearly
//     lost below cards they were about to review on time — while the reason code it produces is
//     named `memory_risk`. The reversal is asserted here, not left to a comment;
//   * elapsed time is measured from `next_review_at`, not `last_reviewed_at`, because the 04:00
//     review-day snap makes those two disagree by the hour the learner studied.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TARGET_RETENTION,
  FSRS_DECAY,
  FSRS_FACTOR,
  REVIEW_VALUE_AT_TARGET,
  REVIEW_VALUE_AT_ZERO_RECALL,
  elapsedDaysBetween,
  estimateMemory,
  retrievability,
  reviewValue,
  scheduleAnchoredElapsedDays,
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
  // ── monotone, not peaked ───────────────────────────────────────────────────
  //
  // This reverses an earlier decision, so the reasons are pinned as tests rather than left in
  // a comment. The peaked curve scored a card at exactly the target 1.0 and a card the learner
  // had almost certainly lost 0.6 — while the reason code it justifies is named `memory_risk`.

  it('is highest for the card the learner has most likely lost', () => {
    expect(reviewValue(0)).toBeCloseTo(REVIEW_VALUE_AT_ZERO_RECALL, 12)
    expect(REVIEW_VALUE_AT_ZERO_RECALL).toBe(1)
    expect(reviewValue(1)).toBeCloseTo(0, 12)
  })

  it('never scores a riskier card below a safer one', () => {
    // The single property the old curve broke. Checked across the whole range, including
    // straddling the knee, because a piecewise function is exactly where this breaks.
    const samples = [0, 0.05, 0.2, 0.45, 0.7, 0.85, 0.89, 0.9, 0.91, 0.95, 0.99, 1]
    const values = samples.map((r) => reviewValue(r) as number)
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i], `r=${samples[i]} must not outrank r=${samples[i - 1]}`)
        .toBeLessThanOrEqual(values[i - 1])
    }
    // ...and it must actually vary, or "monotone" would be satisfied by a constant.
    expect(new Set(values).size).toBe(values.length)
  })

  it('puts the knee at the target retention, with the steep side above it', () => {
    // Being due is the scheduler's own statement that today is the right day, so it scores
    // high — but not the maximum, which belongs to a card already lost.
    expect(reviewValue(DEFAULT_TARGET_RETENTION)).toBeCloseTo(REVIEW_VALUE_AT_TARGET, 12)
    expect(REVIEW_VALUE_AT_TARGET).toBe(0.75)
    // Over-learned cards are punished across 1 - target; at-risk cards separated across target.
    const aboveDrop = REVIEW_VALUE_AT_TARGET - (reviewValue(DEFAULT_TARGET_RETENTION + 0.05) as number)
    const belowRise = (reviewValue(DEFAULT_TARGET_RETENTION - 0.05) as number) - REVIEW_VALUE_AT_TARGET
    expect(aboveDrop).toBeGreaterThan(belowRise * 10)
  })

  it('honours a custom target and clamps a nonsensical one', () => {
    expect(reviewValue(0.7, 0.7)).toBeCloseTo(REVIEW_VALUE_AT_TARGET, 12)
    expect(reviewValue(0.9, 0.7) as number).toBeLessThan(REVIEW_VALUE_AT_TARGET)
    expect(reviewValue(0.5, 0.7) as number).toBeGreaterThan(REVIEW_VALUE_AT_TARGET)
    // A target of 0 or 1 would divide by zero; clamped instead of throwing at plan time.
    expect(Number.isFinite(reviewValue(0.5, 0) as number)).toBe(true)
    expect(Number.isFinite(reviewValue(0.5, 1) as number)).toBe(true)
    expect(Number.isFinite(reviewValue(0.5, Number.NaN) as number)).toBe(true)
  })

  it('stays inside 0..1 for out-of-range recall', () => {
    for (const r of [-5, -0.01, 1.01, 42]) {
      const value = reviewValue(r) as number
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
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
    expect(estimate.reviewValue).toBeCloseTo(REVIEW_VALUE_AT_TARGET, 12)
    expect(estimate.elapsedSource).toBe('last_review')
  })

  it('reports null for a brand-new card rather than 0% recall', () => {
    const neverReviewed = estimateMemory({ intervalDays: 0, lastReviewedAt: null, now: NOW })
    expect(neverReviewed.retrievability).toBeNull()
    expect(neverReviewed.reviewValue).toBeNull()
    expect(neverReviewed.elapsedSource).toBe('unknown')

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

  it('scores a long-overdue card above one caught exactly on schedule', () => {
    const onSchedule = estimateMemory({ intervalDays: 10, lastReviewedAt: '2026-07-21T00:00:00.000Z', now: NOW })
    const longGone = estimateMemory({ intervalDays: 10, lastReviewedAt: '2026-01-01T00:00:00.000Z', now: NOW })
    expect(longGone.retrievability as number).toBeLessThan(onSchedule.retrievability as number)
    // Reversed from the peaked curve: the card nearly lost is the one to review first.
    expect(longGone.reviewValue as number).toBeGreaterThan(onSchedule.reviewValue as number)
    // ...and a card that needs nothing stays at the bottom.
    const justDone = estimateMemory({ intervalDays: 10, lastReviewedAt: NOW, now: NOW })
    expect(justDone.reviewValue).toBeCloseTo(0, 12)
    expect(onSchedule.reviewValue as number).toBeGreaterThan(justDone.reviewValue as number)
  })
})

// ── the schedule anchor ──────────────────────────────────────────────────────
//
// `nextDayBoundary` (lib/srs.ts) snaps every review to 04:00 local, so `last_reviewed_at +
// interval_days` is NOT when the card becomes due. Measuring elapsed time from the last review
// therefore leaked the hour the learner happened to study into the priority, divided by the
// interval — worst for the shortest intervals, i.e. the cards being actively learned.

describe('scheduleAnchoredElapsedDays', () => {
  it('measures from the due stamp, so a card due now is exactly one stability old', () => {
    // 21:00 study, 3-day interval, due 04:00 three days later, planned at 09:00 that morning.
    const elapsed = scheduleAnchoredElapsedDays({
      intervalDays: 3,
      lastReviewedAt: '2026-07-31T12:00:00.000Z', // 21:00 KST — the value is not read, only
                                                 // its presence, which proves a review happened
      nextReviewAt: '2026-08-02T19:00:00.000Z',   // 04:00 KST on 2026-08-03
      now: '2026-08-03T00:00:00.000Z',            // 09:00 KST, five hours after due
    })
    expect(elapsed).toBeCloseTo(3 + 5 / 24, 9)
  })

  it('refuses rather than guessing when there is no interval or no due stamp', () => {
    const base = { lastReviewedAt: '2026-07-20T00:00:00.000Z', nextReviewAt: '2026-07-31T00:00:00.000Z', now: NOW }
    expect(scheduleAnchoredElapsedDays({ ...base, intervalDays: null })).toBeNull()
    expect(scheduleAnchoredElapsedDays({ ...base, intervalDays: 0 })).toBeNull()
    expect(scheduleAnchoredElapsedDays({ ...base, intervalDays: Number.NaN })).toBeNull()
    expect(scheduleAnchoredElapsedDays({ intervalDays: 3, lastReviewedAt: '2026-07-20T00:00:00.000Z', nextReviewAt: null, now: NOW })).toBeNull()
    expect(scheduleAnchoredElapsedDays({ intervalDays: 3, lastReviewedAt: '2026-07-20T00:00:00.000Z', nextReviewAt: 'nope', now: NOW })).toBeNull()
  })
})

describe('the anchor refuses a card with no review to anchor from', () => {
  it('gives a never-reviewed card no memory estimate, due stamp notwithstanding', () => {
    // A new card is given a `next_review_at` so it surfaces in a queue. Anchoring on it would
    // read a scheduling artifact as a forgetting curve and hand the planner a memory estimate
    // for a card nobody has ever seen — the "implicit evidence" the design forbids (§9.2).
    // This regressed when the anchor first landed and was caught by a candidate-level test.
    const neverReviewed = estimateMemory({
      intervalDays: 10, lastReviewedAt: null, nextReviewAt: '2026-07-28T00:00:00.000Z', now: NOW,
    })
    expect(neverReviewed.retrievability).toBeNull()
    expect(neverReviewed.reviewValue).toBeNull()
    expect(neverReviewed.elapsedSource).toBe('unknown')
  })
})

describe('estimateMemory with the schedule anchor', () => {
  /** A card studied at `studyHour` KST, `interval` days ago, planned at 09:00 KST on its due day. */
  function dueToday(interval: number, studyHour: number) {
    const iso = (day: number, hourKst: number) =>
      new Date(Date.UTC(2026, 6, day, hourKst - 9, 0, 0)).toISOString()
    return {
      intervalDays: interval,
      lastReviewedAt: iso(20, studyHour),
      nextReviewAt: iso(20 + interval, 4), // nextDayBoundary: 04:00 KST, `interval` days later
      now: iso(20 + interval, 9),
    }
  }

  it('gives the same score whether the learner studies at 09:00 or at 21:00', () => {
    // The defect this anchor exists for. Without it the 21:00 learner's 1-day card scored
    // 0.5394 and their 30-day card 0.9857 — the hour of study, and nothing about the learner's
    // memory, reordered the queue.
    for (const interval of [1, 3, 7, 30]) {
      const morning = estimateMemory(dueToday(interval, 9))
      const evening = estimateMemory(dueToday(interval, 21))
      expect(morning.reviewValue as number, `interval=${interval}`)
        .toBeCloseTo(evening.reviewValue as number, 12)
      expect(evening.elapsedSource).toBe('schedule')
    }
  })

  it('no longer ranks a mature card above one the learner just started', () => {
    // Same defect from the learner's side. Before the anchor, an evening learner's cards due on
    // the same morning scored 0.5394 (1-day) up to 0.9857 (30-day) — a 0.446 spread, ordered
    // backwards, decided entirely by interval length.
    const evening = [1, 3, 7, 30].map((interval) => estimateMemory(dueToday(interval, 21)).reviewValue as number)
    const spread = Math.max(...evening) - Math.min(...evening)
    expect(spread).toBeLessThan(0.01)
    // What separation remains is the five hours between 04:00 due and 09:00 planning, which is
    // a larger fraction of a 1-day interval than of a 30-day one — so the short card is now
    // (very slightly) ahead rather than far behind.
    for (let i = 1; i < evening.length; i += 1) {
      expect(evening[i]).toBeLessThanOrEqual(evening[i - 1])
    }
  })

  it('falls back to the last review when the card has no due stamp', () => {
    const estimate = estimateMemory({
      intervalDays: 10, lastReviewedAt: '2026-07-21T00:00:00.000Z', nextReviewAt: null, now: NOW,
    })
    expect(estimate.elapsedSource).toBe('last_review')
    expect(estimate.elapsedDays).toBeCloseTo(10, 9)
  })

  it('separates cards by how overdue they are relative to their own interval', () => {
    // What the feature measures once anchored: relative overdueness. A 1-day card three days
    // late is in more trouble than a 30-day card three days late, and now outranks it.
    const shortLate = estimateMemory({
      intervalDays: 1, lastReviewedAt: '2026-07-27T00:00:00.000Z', nextReviewAt: '2026-07-28T00:00:00.000Z', now: NOW,
    })
    const longLate = estimateMemory({
      intervalDays: 30, lastReviewedAt: '2026-06-28T00:00:00.000Z', nextReviewAt: '2026-07-28T00:00:00.000Z', now: NOW,
    })
    expect(shortLate.retrievability as number).toBeLessThan(longLate.retrievability as number)
    expect(shortLate.reviewValue as number).toBeGreaterThan(longLate.reviewValue as number)
  })

  it('scores a card reviewed early below one that is due', () => {
    const early = estimateMemory({
      intervalDays: 10, lastReviewedAt: '2026-07-26T00:00:00.000Z', nextReviewAt: '2026-08-05T00:00:00.000Z', now: NOW, // 5 days early
    })
    const due = estimateMemory({
      intervalDays: 10, lastReviewedAt: '2026-07-21T00:00:00.000Z', nextReviewAt: NOW, now: NOW,
    })
    expect(early.reviewValue as number).toBeLessThan(due.reviewValue as number)
    expect(due.reviewValue).toBeCloseTo(REVIEW_VALUE_AT_TARGET, 12)
  })
})
