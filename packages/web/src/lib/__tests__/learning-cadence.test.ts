/**
 * Study cadence — the divisor every schedule number rests on.
 *
 * The whole adaptive schedule is "remaining work ÷ remaining study days". These tests pin the
 * second term, because getting it wrong is silent: a learner who studies three days a week and
 * is given a seven-day-a-week daily amount simply falls behind, and nothing in the product would
 * say why.
 */
import { describe, it, expect } from 'vitest'
import {
  EVERY_DAY, parseCadence, studyDaysBetween, perStudyDayMultiplier,
  type StudyCadence,
} from '@reeeeecall/shared/learning/application/cadence'

describe('parseCadence', () => {
  it('reads a stored rhythm', () => {
    expect(parseCadence({ cadence: { cycleDays: 7, studyDays: 3 } }))
      .toEqual({ cycleDays: 7, studyDays: 3 })
  })

  it('reads the shapes a week cannot express', () => {
    // The reason this is a cycle and not an integer 1..7. Both of these are things people do,
    // and neither survives a `daysPerWeek` column.
    expect(parseCadence({ cadence: { cycleDays: 10, studyDays: 7 } }))
      .toEqual({ cycleDays: 10, studyDays: 7 })
    expect(parseCadence({ cadence: { cycleDays: 30, studyDays: 15 } }))
      .toEqual({ cycleDays: 30, studyDays: 15 })
  })

  it('treats a goal with no cadence as every day', () => {
    // Not merely a default: every goal already in the database was planned as if every day were
    // a study day, so this is what those rows actually mean.
    expect(parseCadence({})).toEqual(EVERY_DAY)
    expect(parseCadence(null)).toEqual(EVERY_DAY)
    expect(parseCadence(undefined)).toEqual(EVERY_DAY)
    expect(parseCadence({ cadence: null })).toEqual(EVERY_DAY)
  })

  it('never throws on a malformed settings blob', () => {
    // settings is untyped jsonb. A bad value must not make the goal unplannable — the cost of
    // falling back is a daily amount that is too small; the cost of throwing is a learner who
    // cannot open their plan at all.
    for (const bad of [
      { cadence: 'weekly' },
      { cadence: { cycleDays: 7 } },
      { cadence: { cycleDays: 7.5, studyDays: 3 } },
      { cadence: { cycleDays: 7, studyDays: 0 } },
      { cadence: { cycleDays: 0, studyDays: 0 } },
      { cadence: { cycleDays: -7, studyDays: -3 } },
      { cadence: { cycleDays: 365, studyDays: 100 } },
      'nonsense',
      42,
    ]) {
      expect(parseCadence(bad)).toEqual(EVERY_DAY)
    }
  })

  it('refuses more study days than the cycle holds', () => {
    // "8 days out of 7" is not a rhythm, and honouring it would inflate the divisor and hand out
    // a daily amount smaller than the learner could ever finish on.
    expect(parseCadence({ cadence: { cycleDays: 7, studyDays: 8 } })).toEqual(EVERY_DAY)
  })
})

describe('studyDaysBetween', () => {
  const weekly = (n: number): StudyCadence => ({ cycleDays: 7, studyDays: n })

  it('counts every calendar day for a daily learner', () => {
    expect(studyDaysBetween(EVERY_DAY, 30)).toBe(30)
  })

  it('counts only the sessions that will happen', () => {
    // 30 calendar days, three sessions a week ≈ 12.86 sessions. This is the number the daily
    // amount is divided by, and it is less than half of 30 — which is the entire point.
    expect(studyDaysBetween(weekly(3), 30)).toBeCloseTo(30 * 3 / 7, 9)
    expect(studyDaysBetween({ cycleDays: 10, studyDays: 7 }, 30)).toBeCloseTo(21, 9)
    expect(studyDaysBetween({ cycleDays: 30, studyDays: 15 }, 30)).toBeCloseTo(15, 9)
  })

  it('stays fractional rather than rounding', () => {
    // Rounding compounds: this is recomputed every morning, and a half-day error repeated for a
    // month is a week. Callers round once, for display.
    expect(studyDaysBetween(weekly(3), 1)).toBeCloseTo(3 / 7, 9)
    expect(Number.isInteger(studyDaysBetween(weekly(3), 1))).toBe(false)
  })

  it('returns zero for a span that has already passed', () => {
    // The honest answer to "how many study days remain before a date in the past". Callers must
    // treat this as "no time remains", not divide by it.
    expect(studyDaysBetween(weekly(3), 0)).toBe(0)
    expect(studyDaysBetween(weekly(3), -5)).toBe(0)
    expect(studyDaysBetween(weekly(3), Number.NaN)).toBe(0)
    expect(studyDaysBetween(weekly(3), Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('perStudyDayMultiplier', () => {
  it('makes each session bigger when there are fewer of them', () => {
    // The direction people get backwards. Studying less often does not reduce the work — reviews
    // still come due on calendar days — it concentrates the same work into fewer sessions.
    expect(perStudyDayMultiplier(EVERY_DAY)).toBe(1)
    expect(perStudyDayMultiplier({ cycleDays: 7, studyDays: 3 })).toBeCloseTo(7 / 3, 9)
    expect(perStudyDayMultiplier({ cycleDays: 7, studyDays: 1 })).toBe(7)
  })

  it('is the exact inverse of the study ratio', () => {
    // Pinned as an identity so a future refactor cannot quietly swap the direction: multiplying
    // by the ratio instead would SHRINK the sessions of someone who studies less often.
    for (const cadence of [
      EVERY_DAY,
      { cycleDays: 7, studyDays: 3 },
      { cycleDays: 10, studyDays: 7 },
      { cycleDays: 30, studyDays: 15 },
    ]) {
      const days = 100
      expect(studyDaysBetween(cadence, days) * perStudyDayMultiplier(cadence)).toBeCloseTo(days, 9)
    }
  })
})
