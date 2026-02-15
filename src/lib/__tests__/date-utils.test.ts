import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseUTC,
  utcToLocalDateKey,
  localDateToUTCRange,
  dateToLocalKey,
  todayDateKey,
  formatLocalDate,
  formatLocalTime,
  formatLocalDateTime,
  formatRelativeTime,
  localDateKeyToDate,
  isPast,
  daysAgoUTC,
  formatDateKeyShort,
} from '../date-utils'

// ═══════════════════════════════════════════════════════
// parseUTC — Supabase TIMESTAMPTZ 안전 파싱
// ═══════════════════════════════════════════════════════

describe('parseUTC', () => {
  it('should parse ISO string with Z suffix', () => {
    const d = parseUTC('2026-02-15T06:00:00Z')
    expect(d.toISOString()).toBe('2026-02-15T06:00:00.000Z')
  })

  it('should parse ISO string with +00:00 offset', () => {
    const d = parseUTC('2026-02-15T06:00:00+00:00')
    expect(d.toISOString()).toBe('2026-02-15T06:00:00.000Z')
  })

  it('should treat bare ISO string (no timezone) as UTC', () => {
    const withZ = parseUTC('2026-02-14T23:00:00Z')
    const bare = parseUTC('2026-02-14T23:00:00')
    expect(bare.getTime()).toBe(withZ.getTime())
  })

  it('should handle Supabase microsecond precision', () => {
    const d = parseUTC('2026-02-15T06:30:45.123456+00:00')
    expect(d.getUTCHours()).toBe(6)
    expect(d.getUTCMinutes()).toBe(30)
  })

  it('should handle date-only string as UTC', () => {
    const d = parseUTC('2026-02-15')
    // Date-only ISO string is already treated as UTC by spec
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(1) // 0-indexed
    expect(d.getUTCDate()).toBe(15)
  })
})

// ═══════════════════════════════════════════════════════
// dateToLocalKey — Date → YYYY-MM-DD
// ═══════════════════════════════════════════════════════

describe('dateToLocalKey', () => {
  it('should format Date as YYYY-MM-DD using local timezone', () => {
    const d = new Date(2026, 0, 5) // local Jan 5
    expect(dateToLocalKey(d)).toBe('2026-01-05')
  })

  it('should zero-pad month and day', () => {
    const d = new Date(2026, 2, 3) // local Mar 3
    expect(dateToLocalKey(d)).toBe('2026-03-03')
  })
})

// ═══════════════════════════════════════════════════════
// utcToLocalDateKey — UTC timestamp → local YYYY-MM-DD
// ═══════════════════════════════════════════════════════

describe('utcToLocalDateKey', () => {
  it('should convert UTC timestamp to local date key', () => {
    const result = utcToLocalDateKey('2026-02-15T00:00:00Z')
    const expected = dateToLocalKey(new Date('2026-02-15T00:00:00Z'))
    expect(result).toBe(expected)
  })

  it('should treat bare ISO as UTC (same result as Z suffix)', () => {
    const withZ = utcToLocalDateKey('2026-02-14T23:00:00Z')
    const bare = utcToLocalDateKey('2026-02-14T23:00:00')
    expect(bare).toBe(withZ)
  })

  it('should handle +00:00 offset', () => {
    const withZ = utcToLocalDateKey('2026-02-14T23:00:00Z')
    const withOffset = utcToLocalDateKey('2026-02-14T23:00:00+00:00')
    expect(withOffset).toBe(withZ)
  })

  it('should always return YYYY-MM-DD format', () => {
    expect(utcToLocalDateKey('2026-01-05T12:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ═══════════════════════════════════════════════════════
// todayDateKey
// ═══════════════════════════════════════════════════════

describe('todayDateKey', () => {
  it('should return today as YYYY-MM-DD', () => {
    const result = todayDateKey()
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(result).toBe(expected)
  })
})

// ═══════════════════════════════════════════════════════
// localDateToUTCRange — local YYYY-MM-DD → UTC ISO range
// ═══════════════════════════════════════════════════════

describe('localDateToUTCRange', () => {
  it('should convert local date to UTC start/end ISO strings', () => {
    const { start, end } = localDateToUTCRange('2026-02-15')
    const expectedStart = new Date(2026, 1, 15, 0, 0, 0, 0).toISOString()
    const expectedEnd = new Date(2026, 1, 15, 23, 59, 59, 999).toISOString()
    expect(start).toBe(expectedStart)
    expect(end).toBe(expectedEnd)
  })

  it('should produce start before end', () => {
    const { start, end } = localDateToUTCRange('2026-02-15')
    expect(new Date(start).getTime()).toBeLessThan(new Date(end).getTime())
  })

  it('should cover approximately 24 hours', () => {
    const { start, end } = localDateToUTCRange('2026-02-15')
    const diffMs = new Date(end).getTime() - new Date(start).getTime()
    expect(diffMs).toBe(24 * 60 * 60 * 1000 - 1)
  })

  it('round-trip: card created in local day should be within UTC range', () => {
    const localCard = new Date(2026, 1, 15, 9, 0, 0) // local Feb 15 09:00
    const cardUTC = localCard.toISOString()
    const { start, end } = localDateToUTCRange('2026-02-15')
    expect(cardUTC >= start).toBe(true)
    expect(cardUTC <= end).toBe(true)
  })

  it('round-trip: utcToLocalDateKey → localDateToUTCRange should contain original', () => {
    const localCard = new Date(2026, 1, 15, 1, 0, 0) // local early morning
    const cardUTC = localCard.toISOString()
    const dateKey = utcToLocalDateKey(cardUTC)
    expect(dateKey).toBe('2026-02-15')
    const { start, end } = localDateToUTCRange(dateKey)
    expect(cardUTC >= start).toBe(true)
    expect(cardUTC <= end).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════
// formatLocalDate — UTC timestamp → "2026. 2. 15."
// ═══════════════════════════════════════════════════════

describe('formatLocalDate', () => {
  it('should format UTC timestamp as localized date string', () => {
    const result = formatLocalDate('2026-02-15T06:00:00Z')
    // Should include "2026" and month/day in some format
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })

  it('should treat bare ISO as UTC (consistent with parseUTC)', () => {
    const withZ = formatLocalDate('2026-02-14T23:00:00Z')
    const bare = formatLocalDate('2026-02-14T23:00:00')
    expect(bare).toBe(withZ)
  })
})

// ═══════════════════════════════════════════════════════
// formatLocalTime — UTC timestamp → "오전 3:00" etc.
// ═══════════════════════════════════════════════════════

describe('formatLocalTime', () => {
  it('should format UTC timestamp as localized time string', () => {
    const result = formatLocalTime('2026-02-15T06:00:00Z')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })

  it('should accept Intl.DateTimeFormatOptions', () => {
    const result = formatLocalTime('2026-02-15T06:00:00Z', 'ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    })
    expect(result).toBeTruthy()
  })

  it('should treat bare ISO as UTC', () => {
    const withZ = formatLocalTime('2026-02-14T23:00:00Z')
    const bare = formatLocalTime('2026-02-14T23:00:00')
    expect(bare).toBe(withZ)
  })
})

// ═══════════════════════════════════════════════════════
// formatLocalDateTime — UTC timestamp → full local date+time
// ═══════════════════════════════════════════════════════

describe('formatLocalDateTime', () => {
  it('should format UTC timestamp as localized date+time string', () => {
    const result = formatLocalDateTime('2026-02-15T06:00:00Z')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })

  it('should treat bare ISO as UTC', () => {
    const withZ = formatLocalDateTime('2026-02-14T23:00:00Z')
    const bare = formatLocalDateTime('2026-02-14T23:00:00')
    expect(bare).toBe(withZ)
  })
})

// ═══════════════════════════════════════════════════════
// formatRelativeTime — "방금 전", "5분 전", "3일 전"
// ═══════════════════════════════════════════════════════

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return "방금 전" for less than 1 minute ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:30Z'))
    expect(formatRelativeTime('2026-02-15T12:00:00Z')).toBe('방금 전')
    vi.useRealTimers()
  })

  it('should return "N분 전" for minutes ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:05:00Z'))
    expect(formatRelativeTime('2026-02-15T12:00:00Z')).toBe('5분 전')
    vi.useRealTimers()
  })

  it('should return "N시간 전" for hours ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T15:00:00Z'))
    expect(formatRelativeTime('2026-02-15T12:00:00Z')).toBe('3시간 전')
    vi.useRealTimers()
  })

  it('should return "N일 전" for days ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-18T12:00:00Z'))
    expect(formatRelativeTime('2026-02-15T12:00:00Z')).toBe('3일 전')
    vi.useRealTimers()
  })

  it('should fall back to formatted date for 30+ days ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'))
    const result = formatRelativeTime('2026-02-15T12:00:00Z')
    // Should be a localized date string, not "N일 전"
    expect(result).not.toContain('일 전')
    expect(result).toBeTruthy()
    vi.useRealTimers()
  })

  it('should treat bare ISO as UTC', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:05:00Z'))
    const withZ = formatRelativeTime('2026-02-15T12:00:00Z')
    const bare = formatRelativeTime('2026-02-15T12:00:00')
    expect(bare).toBe(withZ)
    vi.useRealTimers()
  })
})

// ═══════════════════════════════════════════════════════
// localDateKeyToDate — YYYY-MM-DD → local Date
// ═══════════════════════════════════════════════════════

describe('localDateKeyToDate', () => {
  it('should convert YYYY-MM-DD to local midnight Date', () => {
    const d = localDateKeyToDate('2026-02-15')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(1) // 0-indexed
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(0)
  })

  it('should return local timezone Date (not UTC)', () => {
    const d = localDateKeyToDate('2026-02-15')
    // Local midnight should differ from UTC midnight by timezone offset
    const localMidnight = new Date(2026, 1, 15, 0, 0, 0, 0)
    expect(d.getTime()).toBe(localMidnight.getTime())
  })
})

// ═══════════════════════════════════════════════════════
// isPast — DB timestamp vs now
// ═══════════════════════════════════════════════════════

describe('isPast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return true for past UTC timestamps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00Z'))
    expect(isPast('2026-02-15T11:00:00Z')).toBe(true)
    vi.useRealTimers()
  })

  it('should return false for future UTC timestamps', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00Z'))
    expect(isPast('2026-02-15T13:00:00Z')).toBe(false)
    vi.useRealTimers()
  })

  it('should treat bare ISO as UTC', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00Z'))
    expect(isPast('2026-02-15T11:00:00')).toBe(true)
    expect(isPast('2026-02-15T13:00:00')).toBe(false)
    vi.useRealTimers()
  })
})

// ═══════════════════════════════════════════════════════
// daysAgoUTC — N days ago as UTC ISO string
// ═══════════════════════════════════════════════════════

describe('daysAgoUTC', () => {
  it('should return an ISO UTC string', () => {
    const result = daysAgoUTC(7)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result).toContain('Z')
  })

  it('should return a date approximately N days ago', () => {
    const now = Date.now()
    const result = new Date(daysAgoUTC(7)).getTime()
    const diff = now - result
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    expect(Math.abs(diff - sevenDaysMs)).toBeLessThan(60 * 1000) // within 1 minute
  })

  it('daysAgoUTC(0) should be approximately now', () => {
    const now = Date.now()
    const result = new Date(daysAgoUTC(0)).getTime()
    expect(Math.abs(now - result)).toBeLessThan(1000) // within 1 second
  })
})

// ═══════════════════════════════════════════════════════
// formatDateKeyShort — YYYY-MM-DD → "2/15"
// ═══════════════════════════════════════════════════════

describe('formatDateKeyShort', () => {
  it('should format as M/D', () => {
    expect(formatDateKeyShort('2026-02-15')).toBe('2/15')
  })

  it('should not zero-pad', () => {
    expect(formatDateKeyShort('2026-01-05')).toBe('1/5')
  })

  it('should handle December', () => {
    expect(formatDateKeyShort('2026-12-31')).toBe('12/31')
  })
})
