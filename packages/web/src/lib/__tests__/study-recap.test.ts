/**
 * studyRecap — "how did I do?", which the screen it replaced never answered.
 *
 * The old section listed one row per attempt: card prompt, rating word, timestamp. Reported as
 * "그냥 단어 나열이 별로 아니가" — a column of vocabulary in the one place a learner has just
 * finished something. These pin the three numbers that replaced it, and the day boundary that
 * decides which attempts are even in them.
 */
import { describe, it, expect } from 'vitest'
import { studyRecap, scoreBand } from '@reeeeecall/shared/lib/study-recap'

const at = (iso: string, score: number | null, ms = 1000) =>
  ({ created_at: iso, normalized_score: score, duration_ms: ms })

describe('scoreBand', () => {
  it('uses the thresholds the row labels already used', () => {
    expect(scoreBand(1)).toBe('known')
    expect(scoreBand(0.75)).toBe('known')
    expect(scoreBand(0.5)).toBe('partial')
    expect(scoreBand(0.25)).toBe('partial')
    expect(scoreBand(0.24)).toBe('missed')
    expect(scoreBand(0)).toBe('missed')
  })

  it('says nothing for an attempt that was never scored', () => {
    // `null` is "recorded but not judged" — filing it under "missed" would invent a failure,
    // and it is also why remediation is refused on these rows.
    expect(scoreBand(null)).toBeNull()
    expect(scoreBand(Number.NaN)).toBeNull()
  })
})

describe('studyRecap', () => {
  it('counts, times and bands a session', () => {
    const recap = studyRecap([
      at('2026-08-06T01:00:00.000Z', 1, 4000),
      at('2026-08-06T01:01:00.000Z', 0.5, 6000),
      at('2026-08-06T01:02:00.000Z', 0, 2000),
    ])

    expect(recap).toMatchObject({
      count: 3, totalMs: 12000, avgMs: 4000, known: 1, partial: 1, missed: 1, unscored: 0,
    })
  })

  it('keeps unscored attempts out of the bands but inside the count', () => {
    // They happened — they are part of "how much did I do" — but they are not evidence of
    // either success or failure.
    const recap = studyRecap([at('2026-08-06T01:00:00.000Z', null)])

    expect(recap).toMatchObject({ count: 1, unscored: 1, known: 0, partial: 0, missed: 0 })
  })

  it('ignores a nonsense duration rather than reporting it', () => {
    // `duration_ms` is client-reported. One absurd row would otherwise put "카드당 평균 3시간"
    // under an ordinary session.
    const recap = studyRecap([
      at('2026-08-06T01:00:00.000Z', 1, 5000),
      at('2026-08-06T01:01:00.000Z', 1, -900000),
      at('2026-08-06T01:02:00.000Z', 1, Number.NaN),
    ])

    expect(recap.totalMs).toBe(5000)
    // Still divided by every attempt: three cards WERE studied, and only the clock is suspect.
    expect(recap.count).toBe(3)
  })

  it('narrows to one local day when asked', () => {
    // The screen shows one day. Without this the recap summed "the last 50 rows", so a learner
    // returning after a week read last week's work under a heading about today.
    const local = (day: string, hour: string) => new Date(`${day}T${hour}:00:00`).toISOString()
    const recap = studyRecap([
      at(local('2026-08-06', '09'), 1),
      at(local('2026-08-06', '21'), 0),
      at(local('2026-08-05', '23'), 1),
    ], '2026-08-06')

    expect(recap).toMatchObject({ count: 2, known: 1, missed: 1 })
  })

  it('compares LOCAL dates, so a late-night session lands on the right day', () => {
    // 01:00 in Seoul is the previous day in UTC. Filtering on the UTC date would file a learner's
    // session under yesterday and show them an empty recap for the plan they just finished.
    const oneAm = new Date('2026-08-06T01:00:00').toISOString()

    expect(studyRecap([at(oneAm, 1)], '2026-08-06').count).toBe(1)
  })

  it('has nothing to report for a day with no attempts', () => {
    expect(studyRecap([], '2026-08-06')).toMatchObject({ count: 0, avgMs: 0, totalMs: 0 })
    expect(studyRecap([at('2026-08-06T01:00:00.000Z', 1)], '2026-08-07').count).toBe(0)
  })
})
