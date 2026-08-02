/**
 * The daily cost of a goal, checked against the scheduler it claims to model.
 *
 * This number is shown to a learner before they commit months to a plan, so "roughly right" is
 * not a standard — it has to track `packages/shared/lib/srs.ts`. The reference figures below come
 * from a card-level simulation of that scheduler (5 seeds averaged, 7-day smoothed), and they are
 * pinned here because two earlier versions of this model were confidently, silently wrong:
 *
 *   v1  all-correct ladder x `1 + 4*lapseRate`     26-38% LOW, peak a month early
 *   v2  flow over rungs, one answer per intake     30% LOW
 *   v3  flow + learning-phase re-entry cost        within 3%
 *
 * v1 and v2 both looked reasonable and produced plausible minutes. Only the comparison caught
 * them, so the comparison is the test.
 */
import { describe, expect, it } from 'vitest'
import {
  projectWorkload, daysForDailyBudget, learningAnswers, INTERVALS_DAYS, reviewsAddedTomorrow,
} from '@reeeeecall/shared/learning'
import { calculateSRS, type SrsCardData } from '@reeeeecall/shared/lib/srs'

const BASE = { secondsPerCard: 8, lapseRate: 0.10, consolidationDays: 14, seenCards: 0 }

/** Card-level simulation of lib/srs.ts: 5 seeds averaged, peak over a 7-day window. */
const REFERENCE = [
  { unseenCards: 5000, daysAvailable: 200, avg: 35.5, peak: 43.4 },
  { unseenCards: 10000, daysAvailable: 180, avg: 77.5, peak: 95.5 },
  { unseenCards: 2000, daysAvailable: 90, avg: 27.2, peak: 35.2 },
]

describe('the interval ladder IS the scheduler\'s', () => {
  it('matches what calculateSRS actually grants on the all-correct path', () => {
    // The ladder is the model's only link to the real algorithm, and a comment saying "taken
    // from the scheduler" does not keep it there — a mutation swapping it for a clean geometric
    // series [1,3,9,27,81,243,365] passed every other test in this file. So walk the scheduler.
    //
    // `calculateSRS` is imported here and NOT by workload.ts on purpose: lib/learning-candidates
    // already imports the learning kernel, and adding the reverse edge at runtime would make the
    // two packages mutually dependent to buy what this assertion buys for free.
    let card: SrsCardData = { srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0 }
    const granted: number[] = []
    for (let i = 0; i < 12 && granted.length < INTERVALS_DAYS.length; i += 1) {
      const next = calculateSRS(card, 'good')
      // Learning steps are minutes apart and grant no days; only graduated intervals are rungs.
      if (next.interval_days > 0) granted.push(next.interval_days)
      card = {
        srs_status: next.srs_status as SrsCardData['srs_status'],
        ease_factor: next.ease_factor,
        interval_days: next.interval_days,
        repetitions: next.repetitions,
      }
    }
    expect(granted).toEqual([...INTERVALS_DAYS])
  })
})

describe('projected load tracks the real scheduler', () => {
  it.each(REFERENCE)('$unseenCards cards over $daysAvailable days', (ref) => {
    const p = projectWorkload({ ...BASE, unseenCards: ref.unseenCards, daysAvailable: ref.daysAvailable })
    // 8% on the mean, 12% on the peak. Wider on the peak because it is a maximum over a noisy
    // process; tighter than this would be pinning simulation noise rather than the model.
    expect(Math.abs(p.averageMinutesPerDay - ref.avg) / ref.avg).toBeLessThan(0.08)
    expect(Math.abs(p.peakMinutesPerDay - ref.peak) / ref.peak).toBeLessThan(0.12)
  })

  it('the peak is meaningfully above the average — which is why both are reported', () => {
    // A learner told "hour a day" who meets a two-hour day was misled. If these ever converge,
    // the model has stopped capturing the pile-up behind intake and the UI should stop promising.
    const p = projectWorkload({ ...BASE, unseenCards: 10000, daysAvailable: 180 })
    expect(p.peakMinutesPerDay).toBeGreaterThan(p.averageMinutesPerDay * 1.15)
  })
})

describe('learning-phase re-entry cost', () => {
  it('two steps cost more than two answers once anything can go wrong', () => {
    // The bug that made v2 30% low. A wrong answer returns the card to the FIRST step, so the
    // cost is a recurrence, not a count.
    expect(learningAnswers(2, 0)).toBeCloseTo(2, 6)
    expect(learningAnswers(2, 0.2)).toBeGreaterThan(2.7)
    expect(learningAnswers(2, 0.2)).toBeLessThan(2.9)
  })

  it('rises with the error rate and stays finite at the cap', () => {
    expect(learningAnswers(2, 0.3)).toBeGreaterThan(learningAnswers(2, 0.1))
    expect(Number.isFinite(learningAnswers(2, 0.95))).toBe(true)
    expect(learningAnswers(0, 0.2)).toBe(0)
  })
})

describe('intake', () => {
  it('stops before the target date so the tail can consolidate', () => {
    // A card first seen the day before an exam has had no chance to settle.
    const p = projectWorkload({ ...BASE, unseenCards: 1000, daysAvailable: 100, consolidationDays: 14 })
    expect(p.newCardsPerDay).toBe(Math.ceil(1000 / 86))
  })

  it('still introduces cards when the date is too close for a full consolidation window', () => {
    // Telling a learner with five days left that the plan is impossible is worse than telling
    // them it is hard — they may be a full-time exam candidate.
    const p = projectWorkload({ ...BASE, unseenCards: 500, daysAvailable: 5, consolidationDays: 14 })
    expect(p.newCardsPerDay).toBe(500)
    expect(p.peakMinutesPerDay).toBeGreaterThan(60)
  })

  it('a goal over an already-studied deck still reports work', () => {
    // No unseen cards does not mean no reviews — the schedule keeps asking.
    const p = projectWorkload({ ...BASE, unseenCards: 0, seenCards: 3000, daysAvailable: 90 })
    expect(p.newCardsPerDay).toBe(0)
    expect(p.averageMinutesPerDay).toBeGreaterThan(0)
  })
})

describe('the inverse question', () => {
  it('a daily budget yields the date it can finish by', () => {
    const days = daysForDailyBudget({ ...BASE, unseenCards: 2000, minutesPerDay: 60 })
    expect(days).not.toBeNull()
    const check = projectWorkload({ ...BASE, unseenCards: 2000, daysAvailable: days! })
    expect(check.peakMinutesPerDay).toBeLessThanOrEqual(60)
  })

  it('a longer deadline needs fewer minutes, and a bigger deck needs more days', () => {
    const short = projectWorkload({ ...BASE, unseenCards: 5000, daysAvailable: 60 })
    const long = projectWorkload({ ...BASE, unseenCards: 5000, daysAvailable: 365 })
    expect(long.peakMinutesPerDay).toBeLessThan(short.peakMinutesPerDay)

    const small = daysForDailyBudget({ ...BASE, unseenCards: 1000, minutesPerDay: 30 })
    const big = daysForDailyBudget({ ...BASE, unseenCards: 8000, minutesPerDay: 30 })
    expect(big!).toBeGreaterThan(small!)
  })

  it('returns null rather than a number when no schedule fits the budget', () => {
    // Existing reviews alone can exceed a small budget. Saying so beats inventing a date.
    expect(daysForDailyBudget({ ...BASE, unseenCards: 0, seenCards: 50000, minutesPerDay: 1 })).toBeNull()
  })
})

describe('refuses to estimate from nonsense', () => {
  it.each([
    ['zero days', { daysAvailable: 0 }],
    ['negative seconds', { secondsPerCard: -1 }],
    ['lapse rate of 1', { lapseRate: 1 }],
    ['NaN days', { daysAvailable: Number.NaN }],
  ])('%s', (_label, override) => {
    expect(() => projectWorkload({ ...BASE, unseenCards: 100, daysAvailable: 30, ...override })).toThrow()
  })
})

describe('reviewsAddedTomorrow', () => {
  it('says every new card comes back tomorrow', () => {
    // What a learner pressing "더 하기" is actually deciding. Not "about seven reviews over a
    // year" — true, but not a number anyone can act on tonight.
    expect(reviewsAddedTomorrow(12)).toBe(12)
    expect(reviewsAddedTomorrow(1)).toBe(1)
  })

  it('is zero when nothing new was started', () => {
    // An extra block made entirely of reviews costs tomorrow nothing: those cards were coming
    // back on their own schedule regardless.
    expect(reviewsAddedTomorrow(0)).toBe(0)
    expect(reviewsAddedTomorrow(-3)).toBe(0)
    expect(reviewsAddedTomorrow(Number.NaN)).toBe(0)
  })

  it('is tied to the scheduler\'s first interval, not to the number 1', () => {
    // The claim is only true because the first rung is one day. Pinned as a dependency so a
    // scheduler change that moves the first review out makes this test the thing that fails,
    // rather than the sentence on screen quietly becoming false.
    expect(INTERVALS_DAYS[0]).toBe(1)
  })
})
