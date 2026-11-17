import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateSRS, getSrsDayStart, nextDayBoundary, type SrsCardData } from '@reklue/shared/lib/srs'
import { DEFAULT_SRS_SETTINGS } from '@reklue/shared/types/database'

afterEach(() => vi.useRealTimers())
const review = (interval: number, reps = 1): SrsCardData => ({
  srs_status: 'review', ease_factor: 4, interval_days: interval, repetitions: reps,
})

describe('review interval invariants', () => {
  it('keeps Good beyond Hard after an Easy graduation', () => {
    const graduated = calculateSRS({ ...review(0, 0), srs_status: 'new' }, 'easy')
    const hard = calculateSRS(graduated, 'hard')
    const good = calculateSRS(graduated, 'good')
    expect(good.interval_days).toBeGreaterThan(hard.interval_days)
    expect(good.interval_days).toBeGreaterThan(graduated.interval_days)
  })

  it('returns whole-day intervals even when the Easy growth cap is fractional', () => {
    for (const interval of [1, 3, 5, 7, 9]) {
      const result = calculateSRS(review(interval, 3), 'easy')
      expect(Number.isInteger(result.interval_days), JSON.stringify(result)).toBe(true)
    }
  })

  it('keeps rating order and grows on successful reviews across persisted card states', () => {
    for (let interval = 1; interval < 365; interval++) {
      for (const repetitions of [1, 2, 10]) {
        const card = review(interval, repetitions)
        const hard = calculateSRS(card, 'hard')
        const good = calculateSRS(card, 'good')
        const easy = calculateSRS(card, 'easy')
        expect(good.interval_days, JSON.stringify(card)).toBeGreaterThanOrEqual(hard.interval_days)
        expect(easy.interval_days, JSON.stringify(card)).toBeGreaterThanOrEqual(good.interval_days)
        expect(good.interval_days).toBeGreaterThanOrEqual(interval)
        expect(easy.interval_days).toBeLessThanOrEqual(DEFAULT_SRS_SETTINGS.max_interval_days!)
      }
    }
  })
})

// Run this file in separate processes under Asia/Seoul, America/New_York and Europe/Berlin.
// Calendar constructors use each process's local zone, including its real DST transitions.
describe('local 04:00 study-day boundary', () => {
  for (const [month, day] of [[2, 8], [2, 29], [9, 25], [10, 1]]) {
    it(`starts at 04:00 on ${month + 1}/${day} across clock changes`, () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, month, day, 4, 30))
      expect(getSrsDayStart()).toEqual(new Date(2026, month, day, 4))
      vi.setSystemTime(new Date(2026, month, day, 3, 30))
      expect(getSrsDayStart()).toEqual(new Date(2026, month, day - 1, 4))
    })
    it(`schedules exactly 04:00 on ${month + 1}/${day}`, () => {
      expect(nextDayBoundary(new Date(2026, month, day - 1, 22), 1)).toEqual(new Date(2026, month, day, 4))
      expect(nextDayBoundary(new Date(2026, month, day, 4, 30), 1)).toEqual(new Date(2026, month, day + 1, 4))
    })
  }
})
