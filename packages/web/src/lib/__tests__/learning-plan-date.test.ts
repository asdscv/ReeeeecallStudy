/**
 * learning-plan-date — which day's plan the user is looking at.
 *
 * Getting this wrong is not cosmetic: the plan is keyed by (user, goal, plan_date), so a
 * date computed in UTC rolls the day over at the wrong moment and the learner either sees
 * an empty "today" just after midnight or gets a second plan for the same day.
 *
 * The zone LABEL is a separate concern from the date, and it has to survive a Hermes build
 * with no ICU — that is the whole reason this lives in shared now.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  localPlanDate, utcOffsetLabel, resolveTimezoneLabel, currentPlanContext,
} from '@reeeeecall/shared/lib/learning-plan-date'

afterEach(() => { vi.unstubAllGlobals() })

/** A Date whose LOCAL getters and offset are fixed, whatever the test machine's zone is. */
function fixedLocalDate(parts: {
  y: number; m: number; d: number; offsetMinutes: number; iso?: string
}): Date {
  return {
    getFullYear: () => parts.y,
    getMonth: () => parts.m - 1,
    getDate: () => parts.d,
    getTimezoneOffset: () => parts.offsetMinutes,
    toISOString: () => parts.iso ?? '2026-07-31T00:00:00.000Z',
  } as unknown as Date
}

describe('localPlanDate', () => {
  it('uses the device calendar, not UTC', () => {
    // 2026-08-01 00:30 in Seoul is still 2026-07-31 in UTC. The plan belongs to August 1st,
    // because that is the date the learner sees on their phone.
    const seoulJustAfterMidnight = fixedLocalDate({
      y: 2026, m: 8, d: 1, offsetMinutes: -540, iso: '2026-07-31T15:30:00.000Z',
    })
    expect(localPlanDate(seoulJustAfterMidnight)).toBe('2026-08-01')
    expect(seoulJustAfterMidnight.toISOString().slice(0, 10)).toBe('2026-07-31') // the wrong answer
  })

  it('zero-pads month and day', () => {
    expect(localPlanDate(fixedLocalDate({ y: 2026, m: 1, d: 5, offsetMinutes: 0 })))
      .toBe('2026-01-05')
  })
})

describe('utcOffsetLabel', () => {
  it('writes the offset with the sign a human expects, not getTimezoneOffset\'s', () => {
    // getTimezoneOffset returns minutes to ADD to local to reach UTC, so Seoul is -540 and
    // must be written +09:00. Getting this backwards would record every zone mirrored.
    expect(utcOffsetLabel(fixedLocalDate({ y: 2026, m: 7, d: 31, offsetMinutes: -540 })))
      .toBe('UTC+09:00')
    expect(utcOffsetLabel(fixedLocalDate({ y: 2026, m: 7, d: 31, offsetMinutes: 300 })))
      .toBe('UTC-05:00')
  })

  it('handles UTC and half-hour zones', () => {
    expect(utcOffsetLabel(fixedLocalDate({ y: 2026, m: 7, d: 31, offsetMinutes: 0 })))
      .toBe('UTC+00:00')
    expect(utcOffsetLabel(fixedLocalDate({ y: 2026, m: 7, d: 31, offsetMinutes: -330 })))
      .toBe('UTC+05:30')
  })
})

describe('resolveTimezoneLabel', () => {
  it('prefers the IANA zone when the runtime knows it', () => {
    vi.stubGlobal('Intl', {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Asia/Seoul' }) }),
    })
    expect(resolveTimezoneLabel(fixedLocalDate({ y: 2026, m: 7, d: 31, offsetMinutes: -540 })))
      .toBe('Asia/Seoul')
  })

  it('falls back to the real offset on an ICU-less runtime, not to "UTC"', () => {
    // A Hermes build without full ICU is the reason this function exists. Defaulting to
    // 'UTC' would record a zone the user is not in; the offset says what was actually used.
    vi.stubGlobal('Intl', {
      DateTimeFormat: () => { throw new Error('no ICU') },
    })
    expect(resolveTimezoneLabel(fixedLocalDate({ y: 2026, m: 7, d: 31, offsetMinutes: -540 })))
      .toBe('UTC+09:00')
  })

  it('falls back when Intl reports an empty zone', () => {
    vi.stubGlobal('Intl', {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: '' }) }),
    })
    expect(resolveTimezoneLabel(fixedLocalDate({ y: 2026, m: 7, d: 31, offsetMinutes: 0 })))
      .toBe('UTC+00:00')
  })

  it('never returns an empty string, because save_daily_plan rejects one', () => {
    vi.stubGlobal('Intl', undefined)
    const label = resolveTimezoneLabel(fixedLocalDate({ y: 2026, m: 7, d: 31, offsetMinutes: -540 }))
    expect(label.length).toBeGreaterThan(0)
  })
})

describe('currentPlanContext', () => {
  it('returns a date, a non-empty zone label and the instant together', () => {
    vi.stubGlobal('Intl', {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Asia/Seoul' }) }),
    })
    const ctx = currentPlanContext(fixedLocalDate({
      y: 2026, m: 8, d: 1, offsetMinutes: -540, iso: '2026-07-31T15:30:00.000Z',
    }))
    expect(ctx).toEqual({
      timezone: 'Asia/Seoul',
      planDate: '2026-08-01',
      now: '2026-07-31T15:30:00.000Z',
    })
  })
})
