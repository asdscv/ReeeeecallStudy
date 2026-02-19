import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeUserGrowthSeries,
  computeActiveInactiveUsers,
  fillDailyActivityGaps,
  computeModeUsagePercentages,
  aggregateRatings,
  computeEngagementMetrics,
  formatTotalStudyTime,
  formatStatNumber,
  validateAdminDays,
  extractErrorMessage,
  computeTrendChange,
  computeModeEffectiveness,
  computeConversionRate,
  computeWeekOverWeekFromDaily,
  studyModeLabel,
  srsStatusLabel,
  shareModeLabel,
  ratingLabel,
  userRoleLabel,
  computeLocaleDistribution,
  computeTagCloudData,
  computePublishingTimeline,
  formatViewDuration,
  fillDailyViewGaps,
  computePopularContentTable,
  computeReferrerBreakdown,
  computeDeviceBreakdown,
  computeScrollDepthDistribution,
  computeConversionFunnel,
  mergeDailySummaryWithLive,
  computeBounceRate,
  computeTopPagesTable,
  computeUtmSourceBreakdown,
} from '../admin-stats'
import type {
  AdminUserSignup,
  AdminDailyStudyActivity,
  AdminModeBreakdown,
  AdminActiveUsers,
  AdminRecentActivity,
} from '../../types/database'

// ── 1. computeUserGrowthSeries ──

describe('computeUserGrowthSeries', () => {
  it('returns empty array for empty input', () => {
    expect(computeUserGrowthSeries([])).toEqual([])
  })

  it('computes cumulative user growth from daily signups', () => {
    const signups: AdminUserSignup[] = [
      { date: '2026-02-01', count: 5 },
      { date: '2026-02-02', count: 3 },
      { date: '2026-02-03', count: 7 },
    ]
    const result = computeUserGrowthSeries(signups)
    expect(result).toEqual([
      { date: '2026-02-01', cumulative: 5 },
      { date: '2026-02-02', cumulative: 8 },
      { date: '2026-02-03', cumulative: 15 },
    ])
  })

  it('handles single day', () => {
    const signups: AdminUserSignup[] = [{ date: '2026-01-01', count: 10 }]
    expect(computeUserGrowthSeries(signups)).toEqual([
      { date: '2026-01-01', cumulative: 10 },
    ])
  })
})

// ── 2. computeActiveInactiveUsers ──

describe('computeActiveInactiveUsers', () => {
  it('computes active vs inactive counts from MAU data', () => {
    const data: AdminActiveUsers = { dau: 5, wau: 20, mau: 50, total_users: 100 }
    const result = computeActiveInactiveUsers(data)
    expect(result).toEqual([
      { name: 'active', value: 50 },
      { name: 'inactive', value: 50 },
    ])
  })

  it('handles all users active', () => {
    const data: AdminActiveUsers = { dau: 10, wau: 10, mau: 10, total_users: 10 }
    const result = computeActiveInactiveUsers(data)
    expect(result).toEqual([
      { name: 'active', value: 10 },
      { name: 'inactive', value: 0 },
    ])
  })

  it('handles zero total users', () => {
    const data: AdminActiveUsers = { dau: 0, wau: 0, mau: 0, total_users: 0 }
    const result = computeActiveInactiveUsers(data)
    expect(result).toEqual([
      { name: 'active', value: 0 },
      { name: 'inactive', value: 0 },
    ])
  })

  it('caps active at total_users when mau > total_users (data anomaly)', () => {
    const data: AdminActiveUsers = { dau: 5, wau: 20, mau: 200, total_users: 100 }
    const result = computeActiveInactiveUsers(data)
    expect(result).toEqual([
      { name: 'active', value: 100 },
      { name: 'inactive', value: 0 },
    ])
  })
})

// ── 3. fillDailyActivityGaps ──

describe('fillDailyActivityGaps', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-17T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns filled array of zeroes for empty input (anchored to today)', () => {
    const result = fillDailyActivityGaps([], 7)
    expect(result).toHaveLength(7)
    expect(result[6].date).toBe('2026-02-17')
    expect(result[0].date).toBe('2026-02-11')
    expect(result.every(d => d.sessions === 0 && d.cards === 0 && d.total_duration_ms === 0)).toBe(true)
  })

  it('fills missing dates with zeroes', () => {
    const data: AdminDailyStudyActivity[] = [
      { date: '2026-02-15', sessions: 3, cards: 30, total_duration_ms: 60000 },
      { date: '2026-02-17', sessions: 5, cards: 50, total_duration_ms: 120000 },
    ]
    const result = fillDailyActivityGaps(data, 3)
    expect(result).toHaveLength(3)
    expect(result[0].date).toBe('2026-02-15')
    expect(result[0].sessions).toBe(3)
    expect(result[0].total_duration_ms).toBe(60000)
    expect(result[1].date).toBe('2026-02-16')
    expect(result[1].sessions).toBe(0)
    expect(result[1].cards).toBe(0)
    expect(result[1].total_duration_ms).toBe(0)
    expect(result[2].date).toBe('2026-02-17')
    expect(result[2].sessions).toBe(5)
  })

  it('handles days larger than data range', () => {
    const data: AdminDailyStudyActivity[] = [
      { date: '2026-02-17', sessions: 1, cards: 10, total_duration_ms: 5000 },
    ]
    const result = fillDailyActivityGaps(data, 5)
    expect(result).toHaveLength(5)
    expect(result[0].date).toBe('2026-02-13')
    expect(result[0].sessions).toBe(0)
    expect(result[4].date).toBe('2026-02-17')
    expect(result[4].sessions).toBe(1)
  })

  it('handles out-of-order input data', () => {
    const data: AdminDailyStudyActivity[] = [
      { date: '2026-02-17', sessions: 5, cards: 50, total_duration_ms: 0 },
      { date: '2026-02-15', sessions: 3, cards: 30, total_duration_ms: 0 },
    ]
    const result = fillDailyActivityGaps(data, 3)
    expect(result).toHaveLength(3)
    expect(result[0].sessions).toBe(3)
    expect(result[2].sessions).toBe(5)
  })

  it('anchors to today when data is stale (latest date < today)', () => {
    // Today is 2026-02-17, data only has Jan 22
    const data: AdminDailyStudyActivity[] = [
      { date: '2026-01-22', sessions: 5, cards: 50, total_duration_ms: 10000 },
    ]
    const result = fillDailyActivityGaps(data, 7)
    expect(result).toHaveLength(7)
    // Should end at today (2026-02-17), not at the stale date
    expect(result[6].date).toBe('2026-02-17')
    expect(result[0].date).toBe('2026-02-11')
    // All entries should be zero (stale data out of range)
    expect(result.every(d => d.sessions === 0)).toBe(true)
  })
})

// ── 4. computeModeUsagePercentages ──

describe('computeModeUsagePercentages', () => {
  it('returns empty array for empty input', () => {
    expect(computeModeUsagePercentages([])).toEqual([])
  })

  it('computes percentages by session count', () => {
    const modes: AdminModeBreakdown[] = [
      { mode: 'srs', session_count: 60, total_cards: 600, total_duration_ms: 0 },
      { mode: 'random', session_count: 40, total_cards: 400, total_duration_ms: 0 },
    ]
    const result = computeModeUsagePercentages(modes)
    expect(result).toEqual([
      { mode: 'srs', session_count: 60, percentage: 60 },
      { mode: 'random', session_count: 40, percentage: 40 },
    ])
  })

  it('handles single mode', () => {
    const modes: AdminModeBreakdown[] = [
      { mode: 'sequential', session_count: 10, total_cards: 100, total_duration_ms: 0 },
    ]
    const result = computeModeUsagePercentages(modes)
    expect(result).toEqual([
      { mode: 'sequential', session_count: 10, percentage: 100 },
    ])
  })

  it('returns empty for all-zero session counts', () => {
    const modes: AdminModeBreakdown[] = [
      { mode: 'srs', session_count: 0, total_cards: 0, total_duration_ms: 0 },
    ]
    expect(computeModeUsagePercentages(modes)).toEqual([])
  })
})

// ── 5. aggregateRatings ──

describe('aggregateRatings', () => {
  it('returns empty array for empty input', () => {
    expect(aggregateRatings([])).toEqual([])
  })

  it('aggregates ratings from multiple sessions', () => {
    const sessions: { ratings: Record<string, number> }[] = [
      { ratings: { good: 5, easy: 3 } },
      { ratings: { good: 2, hard: 1 } },
    ]
    const result = aggregateRatings(sessions)
    expect(result).toEqual([
      { rating: 'hard', count: 1, percentage: 9 },
      { rating: 'good', count: 7, percentage: 64 },
      { rating: 'easy', count: 3, percentage: 27 },
    ])
  })

  it('handles sessions with zero ratings', () => {
    const sessions = [{ ratings: {} }]
    expect(aggregateRatings(sessions)).toEqual([])
  })

  it('handles unknown rating names and sorts them last', () => {
    const sessions = [
      { ratings: { good: 5, custom_rating: 2 } },
    ]
    const result = aggregateRatings(sessions)
    expect(result[0].rating).toBe('good')
    expect(result[1].rating).toBe('custom_rating')
  })

  it('handles all four canonical ratings', () => {
    const sessions = [
      { ratings: { again: 2, hard: 3, good: 10, easy: 5 } },
    ]
    const result = aggregateRatings(sessions)
    expect(result.map(r => r.rating)).toEqual(['again', 'hard', 'good', 'easy'])
    expect(result.reduce((s, r) => s + r.percentage, 0)).toBeGreaterThanOrEqual(98) // rounding
  })
})

// ── 6. computeEngagementMetrics ──

describe('computeEngagementMetrics', () => {
  it('computes DAU/MAU ratio and stickiness', () => {
    const data: AdminActiveUsers = { dau: 10, wau: 30, mau: 100, total_users: 200 }
    const result = computeEngagementMetrics(data)
    expect(result.dauMauRatio).toBe(10)
    expect(result.wauMauRatio).toBe(30)
    expect(result.adoptionRate).toBe(50)
  })

  it('handles zero MAU', () => {
    const data: AdminActiveUsers = { dau: 0, wau: 0, mau: 0, total_users: 100 }
    const result = computeEngagementMetrics(data)
    expect(result.dauMauRatio).toBe(0)
    expect(result.wauMauRatio).toBe(0)
    expect(result.adoptionRate).toBe(0)
  })

  it('handles zero total users', () => {
    const data: AdminActiveUsers = { dau: 0, wau: 0, mau: 0, total_users: 0 }
    const result = computeEngagementMetrics(data)
    expect(result.adoptionRate).toBe(0)
  })

  it('caps adoption rate at 100% when mau exceeds total_users', () => {
    const data: AdminActiveUsers = { dau: 50, wau: 80, mau: 150, total_users: 100 }
    const result = computeEngagementMetrics(data)
    expect(result.adoptionRate).toBe(100)
    expect(result.dauMauRatio).toBeLessThanOrEqual(100)
    expect(result.wauMauRatio).toBeLessThanOrEqual(100)
  })

  it('caps DAU/MAU and WAU/MAU at 100%', () => {
    const data: AdminActiveUsers = { dau: 200, wau: 200, mau: 100, total_users: 300 }
    const result = computeEngagementMetrics(data)
    expect(result.dauMauRatio).toBe(100)
    expect(result.wauMauRatio).toBe(100)
  })
})

// ── 7. formatTotalStudyTime ──

describe('formatTotalStudyTime', () => {
  it('formats zero ms', () => {
    expect(formatTotalStudyTime(0)).toBe('0m')
  })

  it('formats minutes only', () => {
    expect(formatTotalStudyTime(150_000)).toBe('2m')
  })

  it('formats hours and minutes', () => {
    expect(formatTotalStudyTime(3_900_000)).toBe('1h 5m')
  })

  it('formats large values with days', () => {
    const ms = 90 * 3_600_000 + 30 * 60_000
    expect(formatTotalStudyTime(ms)).toBe('3d 18h 30m')
  })

  it('formats exactly one hour', () => {
    expect(formatTotalStudyTime(3_600_000)).toBe('1h 0m')
  })
})

// ── 8. formatStatNumber ──

describe('formatStatNumber', () => {
  it('formats zero', () => {
    expect(formatStatNumber(0)).toBe('0')
  })

  it('formats small numbers without separator', () => {
    expect(formatStatNumber(999)).toBe('999')
  })

  it('formats thousands with comma separator', () => {
    expect(formatStatNumber(1234)).toBe('1,234')
  })

  it('formats millions', () => {
    expect(formatStatNumber(1234567)).toBe('1,234,567')
  })

  it('passes through string values unchanged', () => {
    expect(formatStatNumber('3d 18h 30m')).toBe('3d 18h 30m')
  })

  it('formats percentage strings unchanged', () => {
    expect(formatStatNumber('50%')).toBe('50%')
  })
})

// ── 9. extractErrorMessage ──

describe('extractErrorMessage', () => {
  it('extracts message from standard Error', () => {
    expect(extractErrorMessage(new Error('test error'))).toBe('test error')
  })

  it('extracts message from plain object with message property (PostgrestError-like)', () => {
    const pgError = { message: 'relation "api_keys" does not exist', details: '', hint: '', code: '42P01' }
    expect(extractErrorMessage(pgError)).toBe('relation "api_keys" does not exist')
  })

  it('handles string error', () => {
    expect(extractErrorMessage('something failed')).toBe('something failed')
  })

  it('handles null', () => {
    expect(extractErrorMessage(null)).toBe('Unknown error')
  })

  it('handles undefined', () => {
    expect(extractErrorMessage(undefined)).toBe('Unknown error')
  })

  it('handles number', () => {
    expect(extractErrorMessage(404)).toBe('404')
  })

  it('handles object without message — returns generic error, not internal JSON', () => {
    const obj = { code: '42P01', details: 'some internal schema info' }
    const result = extractErrorMessage(obj)
    expect(result).not.toBe('[object Object]')
    // Should NOT expose internal details as raw JSON
    expect(result).not.toContain('some internal schema info')
    expect(result).toContain('42P01')
  })

  it('handles nested Error subclass', () => {
    class CustomError extends Error {
      code = 'CUSTOM'
      constructor(msg: string) { super(msg); this.name = 'CustomError' }
    }
    expect(extractErrorMessage(new CustomError('custom msg'))).toBe('custom msg')
  })
})

// ── 10. validateAdminDays ──

describe('validateAdminDays', () => {
  it('returns default for undefined input', () => {
    expect(validateAdminDays(undefined)).toBe(30)
  })

  it('clamps negative numbers to 1', () => {
    expect(validateAdminDays(-5)).toBe(1)
  })

  it('clamps zero to 1', () => {
    expect(validateAdminDays(0)).toBe(1)
  })

  it('clamps numbers above 365 to 365', () => {
    expect(validateAdminDays(9999)).toBe(365)
  })

  it('returns valid numbers unchanged', () => {
    expect(validateAdminDays(30)).toBe(30)
    expect(validateAdminDays(1)).toBe(1)
    expect(validateAdminDays(365)).toBe(365)
  })

  it('floors decimal values', () => {
    expect(validateAdminDays(7.8)).toBe(7)
  })

  it('handles NaN by returning default', () => {
    expect(validateAdminDays(NaN)).toBe(30)
  })
})

// ── 10. fillDailyActivityGaps edge cases ──

describe('fillDailyActivityGaps edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('handles single date entry', () => {
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    const data: AdminDailyStudyActivity[] = [
      { date: '2026-01-01', sessions: 5, cards: 50, total_duration_ms: 10000 },
    ]
    const result = fillDailyActivityGaps(data, 1)
    expect(result).toHaveLength(1)
    expect(result[0].sessions).toBe(5)
  })

  it('handles days=1 with multiple data points (uses today as anchor)', () => {
    vi.setSystemTime(new Date('2026-02-15T12:00:00Z'))
    const data: AdminDailyStudyActivity[] = [
      { date: '2026-02-10', sessions: 1, cards: 10, total_duration_ms: 0 },
      { date: '2026-02-15', sessions: 5, cards: 50, total_duration_ms: 0 },
    ]
    const result = fillDailyActivityGaps(data, 1)
    expect(result).toHaveLength(1)
    expect(result[0].date).toBe('2026-02-15')
    expect(result[0].sessions).toBe(5)
  })

  it('produces consistent UTC dates regardless of local timezone', () => {
    vi.setSystemTime(new Date('2026-03-31T12:00:00Z'))
    const data: AdminDailyStudyActivity[] = [
      { date: '2026-03-31', sessions: 3, cards: 30, total_duration_ms: 0 },
    ]
    const result = fillDailyActivityGaps(data, 3)
    expect(result).toHaveLength(3)
    expect(result[0].date).toBe('2026-03-29')
    expect(result[1].date).toBe('2026-03-30')
    expect(result[2].date).toBe('2026-03-31')
  })

  it('handles month boundary correctly in UTC', () => {
    vi.setSystemTime(new Date('2026-03-02T12:00:00Z'))
    const data: AdminDailyStudyActivity[] = [
      { date: '2026-03-02', sessions: 1, cards: 10, total_duration_ms: 0 },
    ]
    const result = fillDailyActivityGaps(data, 4)
    expect(result).toHaveLength(4)
    expect(result[0].date).toBe('2026-02-27')
    expect(result[1].date).toBe('2026-02-28')
    expect(result[2].date).toBe('2026-03-01')
    expect(result[3].date).toBe('2026-03-02')
  })
})

// ── 11. formatTotalStudyTime edge cases ──

describe('formatTotalStudyTime edge cases', () => {
  it('handles negative values gracefully (returns 0m)', () => {
    expect(formatTotalStudyTime(-1000)).toBe('0m')
  })

  it('handles sub-minute values (less than 60000ms)', () => {
    expect(formatTotalStudyTime(30000)).toBe('0m')
  })

  it('handles exactly 24 hours', () => {
    expect(formatTotalStudyTime(24 * 3_600_000)).toBe('1d 0h 0m')
  })
})

// ── 12. computeUserGrowthSeries edge cases ──

describe('computeUserGrowthSeries edge cases', () => {
  it('handles zero-count days in between', () => {
    const signups: AdminUserSignup[] = [
      { date: '2026-01-01', count: 10 },
      { date: '2026-01-02', count: 0 },
      { date: '2026-01-03', count: 5 },
    ]
    const result = computeUserGrowthSeries(signups)
    expect(result[1].cumulative).toBe(10) // stays same
    expect(result[2].cumulative).toBe(15) // adds 5
  })
})

// ── 13. computeTrendChange ──

describe('computeTrendChange', () => {
  it('computes positive growth', () => {
    const result = computeTrendChange(120, 100)
    expect(result.change).toBe(20)
    expect(result.direction).toBe('up')
  })

  it('computes negative growth', () => {
    const result = computeTrendChange(80, 100)
    expect(result.change).toBe(-20)
    expect(result.direction).toBe('down')
  })

  it('returns flat for no change', () => {
    const result = computeTrendChange(100, 100)
    expect(result.change).toBe(0)
    expect(result.direction).toBe('flat')
  })

  it('returns flat when previous is 0', () => {
    const result = computeTrendChange(50, 0)
    expect(result.direction).toBe('flat')
    expect(result.change).toBe(0)
  })

  it('handles both 0', () => {
    const result = computeTrendChange(0, 0)
    expect(result.direction).toBe('flat')
    expect(result.change).toBe(0)
  })

  it('handles 100% drop', () => {
    const result = computeTrendChange(0, 100)
    expect(result.change).toBe(-100)
    expect(result.direction).toBe('down')
  })
})

// ── 14. computeModeEffectiveness ──

describe('computeModeEffectiveness', () => {
  it('returns empty for empty input', () => {
    expect(computeModeEffectiveness([])).toEqual([])
  })

  it('computes avg cards/session and avg duration per mode', () => {
    const modes: AdminModeBreakdown[] = [
      { mode: 'srs', session_count: 10, total_cards: 200, total_duration_ms: 600_000 },
      { mode: 'random', session_count: 5, total_cards: 50, total_duration_ms: 150_000 },
    ]
    const result = computeModeEffectiveness(modes)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ mode: 'srs', session_count: 10, avgCardsPerSession: 20, avgDurationMin: 1 })
    expect(result[1]).toEqual({ mode: 'random', session_count: 5, avgCardsPerSession: 10, avgDurationMin: 0.5 })
  })

  it('handles zero sessions gracefully', () => {
    const modes: AdminModeBreakdown[] = [
      { mode: 'srs', session_count: 0, total_cards: 0, total_duration_ms: 0 },
    ]
    const result = computeModeEffectiveness(modes)
    expect(result[0].avgCardsPerSession).toBe(0)
    expect(result[0].avgDurationMin).toBe(0)
  })
})

// ── 15. computeConversionRate ──

describe('computeConversionRate', () => {
  it('computes percentage', () => {
    expect(computeConversionRate(25, 100)).toBe(25)
  })

  it('returns 0 when denominator is 0', () => {
    expect(computeConversionRate(10, 0)).toBe(0)
  })

  it('caps at 100', () => {
    expect(computeConversionRate(200, 100)).toBe(100)
  })

  it('handles both 0', () => {
    expect(computeConversionRate(0, 0)).toBe(0)
  })

  it('returns integer percentage (consistent with other metric functions)', () => {
    // All percentage functions should return integers for consistency
    expect(computeConversionRate(1, 3)).toBe(33)
  })
})

// ── 16. computeWeekOverWeekFromDaily ──

describe('computeWeekOverWeekFromDaily', () => {
  it('returns flat trends when less than 14 days of data (not null)', () => {
    const data: AdminRecentActivity[] = [
      { date: '2026-02-01', sessions: 5, active_users: 3, cards: 50 },
    ]
    const result = computeWeekOverWeekFromDaily(data)
    expect(result).not.toBeNull()
    expect(result!.sessions.direction).toBe('flat')
    expect(result!.activeUsers.direction).toBe('flat')
    expect(result!.cards.direction).toBe('flat')
  })

  it('computes WoW change from 14 days of data', () => {
    const data: AdminRecentActivity[] = []
    // Week 1 (older): 7 days, 10 sessions each = 70 total
    for (let i = 13; i >= 7; i--) {
      data.push({ date: `2026-02-${String(18 - i).padStart(2, '0')}`, sessions: 10, active_users: 5, cards: 100 })
    }
    // Week 2 (recent): 7 days, 15 sessions each = 105 total
    for (let i = 6; i >= 0; i--) {
      data.push({ date: `2026-02-${String(18 - i).padStart(2, '0')}`, sessions: 15, active_users: 8, cards: 150 })
    }
    const result = computeWeekOverWeekFromDaily(data)
    expect(result).not.toBeNull()
    expect(result!.sessions.direction).toBe('up')
    expect(result!.sessions.change).toBe(50) // (105-70)/70 * 100 = 50%
    expect(result!.activeUsers.direction).toBe('up')
    expect(result!.cards.direction).toBe('up')
  })

  it('handles flat weeks', () => {
    const data: AdminRecentActivity[] = []
    for (let i = 13; i >= 0; i--) {
      data.push({ date: `2026-02-${String(18 - i).padStart(2, '0')}`, sessions: 10, active_users: 5, cards: 100 })
    }
    const result = computeWeekOverWeekFromDaily(data)
    expect(result!.sessions.direction).toBe('flat')
    expect(result!.sessions.change).toBe(0)
  })
})

// ── 17. Label helper functions ──

describe('studyModeLabel', () => {
  it('maps known study modes to i18n keys', () => {
    expect(studyModeLabel('srs')).toBe('study.modes.srs')
    expect(studyModeLabel('sequential_review')).toBe('study.modes.sequential_review')
    expect(studyModeLabel('random')).toBe('study.modes.random')
    expect(studyModeLabel('sequential')).toBe('study.modes.sequential')
    expect(studyModeLabel('by_date')).toBe('study.modes.by_date')
  })

  it('returns raw value for unknown modes', () => {
    expect(studyModeLabel('custom_mode')).toBe('custom_mode')
  })
})

describe('srsStatusLabel', () => {
  it('maps known SRS statuses to i18n keys', () => {
    expect(srsStatusLabel('new')).toBe('study.srsStatuses.new')
    expect(srsStatusLabel('learning')).toBe('study.srsStatuses.learning')
    expect(srsStatusLabel('review')).toBe('study.srsStatuses.review')
    expect(srsStatusLabel('suspended')).toBe('study.srsStatuses.suspended')
  })

  it('returns raw value for unknown statuses', () => {
    expect(srsStatusLabel('archived')).toBe('archived')
  })
})

describe('shareModeLabel', () => {
  it('maps known share modes to i18n keys', () => {
    expect(shareModeLabel('copy')).toBe('market.shareModes.copy')
    expect(shareModeLabel('subscribe')).toBe('market.shareModes.subscribe')
    expect(shareModeLabel('snapshot')).toBe('market.shareModes.snapshot')
  })

  it('returns raw value for unknown modes', () => {
    expect(shareModeLabel('unknown')).toBe('unknown')
  })
})

// ── 13. ratingLabel ──

describe('ratingLabel', () => {
  it('maps known ratings to i18n keys', () => {
    expect(ratingLabel('again')).toBe('study.ratings.again')
    expect(ratingLabel('hard')).toBe('study.ratings.hard')
    expect(ratingLabel('good')).toBe('study.ratings.good')
    expect(ratingLabel('easy')).toBe('study.ratings.easy')
  })

  it('returns raw value for unknown ratings', () => {
    expect(ratingLabel('unknown')).toBe('unknown')
  })
})

// ── 14. userRoleLabel ──

describe('userRoleLabel', () => {
  it('maps known roles to i18n keys', () => {
    expect(userRoleLabel('admin')).toBe('users.roles.admin')
    expect(userRoleLabel('user')).toBe('users.roles.user')
  })

  it('returns raw value for unknown roles', () => {
    expect(userRoleLabel('superadmin')).toBe('superadmin')
  })
})

// ── 18. computeLocaleDistribution ──

describe('computeLocaleDistribution', () => {
  it('returns empty array for empty input', () => {
    expect(computeLocaleDistribution([])).toEqual([])
  })

  it('computes percentage for single locale', () => {
    const result = computeLocaleDistribution([{ locale: 'ko', count: 10, published: 8 }])
    expect(result).toEqual([{ locale: 'ko', count: 10, published: 8, percentage: 100 }])
  })

  it('computes percentages for multiple locales', () => {
    const result = computeLocaleDistribution([
      { locale: 'ko', count: 60, published: 50 },
      { locale: 'en', count: 40, published: 30 },
    ])
    expect(result[0].percentage).toBe(60)
    expect(result[1].percentage).toBe(40)
  })

  it('handles all-zero counts', () => {
    const result = computeLocaleDistribution([
      { locale: 'ko', count: 0, published: 0 },
    ])
    expect(result[0].percentage).toBe(0)
  })
})

// ── 19. computeTagCloudData ──

describe('computeTagCloudData', () => {
  it('returns empty array for empty input', () => {
    expect(computeTagCloudData([])).toEqual([])
  })

  it('assigns md weight when all counts are equal', () => {
    const result = computeTagCloudData([
      { tag: 'react', count: 5 },
      { tag: 'vue', count: 5 },
    ])
    expect(result.every((t) => t.weight === 'md')).toBe(true)
  })

  it('assigns weight buckets by quartile', () => {
    const result = computeTagCloudData([
      { tag: 'a', count: 1 },
      { tag: 'b', count: 4 },
      { tag: 'c', count: 7 },
      { tag: 'd', count: 10 },
    ])
    expect(result[0].weight).toBe('sm') // 1 → ratio 0
    expect(result[1].weight).toBe('md') // 4 → ratio 0.33
    expect(result[2].weight).toBe('lg') // 7 → ratio 0.67
    expect(result[3].weight).toBe('xl') // 10 → ratio 1
  })

  it('limits to max items', () => {
    const tags = Array.from({ length: 20 }, (_, i) => ({ tag: `t${i}`, count: i + 1 }))
    const result = computeTagCloudData(tags, 5)
    expect(result).toHaveLength(5)
  })

  it('defaults max to 15', () => {
    const tags = Array.from({ length: 20 }, (_, i) => ({ tag: `t${i}`, count: i + 1 }))
    const result = computeTagCloudData(tags)
    expect(result).toHaveLength(15)
  })
})

// ── 20. computePublishingTimeline ──

describe('computePublishingTimeline', () => {
  it('returns empty array for empty input', () => {
    expect(computePublishingTimeline([])).toEqual([])
  })

  it('computes cumulative for sequential months', () => {
    const result = computePublishingTimeline([
      { month: '2026-01', count: 3 },
      { month: '2026-02', count: 5 },
      { month: '2026-03', count: 2 },
    ])
    expect(result).toEqual([
      { month: '2026-01', count: 3, cumulative: 3 },
      { month: '2026-02', count: 5, cumulative: 8 },
      { month: '2026-03', count: 2, cumulative: 10 },
    ])
  })

  it('fills missing months with zero', () => {
    const result = computePublishingTimeline([
      { month: '2026-01', count: 3 },
      { month: '2026-04', count: 2 },
    ])
    expect(result).toHaveLength(4)
    expect(result[1]).toEqual({ month: '2026-02', count: 0, cumulative: 3 })
    expect(result[2]).toEqual({ month: '2026-03', count: 0, cumulative: 3 })
    expect(result[3]).toEqual({ month: '2026-04', count: 2, cumulative: 5 })
  })

  it('handles out-of-order input', () => {
    const result = computePublishingTimeline([
      { month: '2026-03', count: 1 },
      { month: '2026-01', count: 2 },
    ])
    expect(result[0].month).toBe('2026-01')
    expect(result[2].month).toBe('2026-03')
    expect(result[2].cumulative).toBe(3)
  })

  it('handles year boundary', () => {
    const result = computePublishingTimeline([
      { month: '2025-11', count: 1 },
      { month: '2026-02', count: 2 },
    ])
    expect(result).toHaveLength(4)
    expect(result.map((r) => r.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
})

// ── 21. formatViewDuration ──

describe('formatViewDuration', () => {
  it('formats zero', () => {
    expect(formatViewDuration(0)).toBe('0s')
  })

  it('formats negative as 0s', () => {
    expect(formatViewDuration(-500)).toBe('0s')
  })

  it('formats seconds only', () => {
    expect(formatViewDuration(45_000)).toBe('45s')
  })

  it('formats minutes and seconds', () => {
    expect(formatViewDuration(150_000)).toBe('2m 30s')
  })

  it('formats hours and minutes', () => {
    expect(formatViewDuration(3_900_000)).toBe('1h 5m')
  })

  it('formats exact minute', () => {
    expect(formatViewDuration(60_000)).toBe('1m 0s')
  })
})

// ── 22. fillDailyViewGaps ──

describe('fillDailyViewGaps', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-17T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns filled array of zeroes for empty input (anchored to today)', () => {
    const result = fillDailyViewGaps([], 7)
    expect(result).toHaveLength(7)
    expect(result[6].date).toBe('2026-02-17')
    expect(result[0].date).toBe('2026-02-11')
    expect(result.every(d => d.views === 0 && d.unique_viewers === 0)).toBe(true)
  })

  it('fills missing dates with zeroes', () => {
    const data = [
      { date: '2026-02-15', views: 10, unique_viewers: 5 },
      { date: '2026-02-17', views: 20, unique_viewers: 8 },
    ]
    const result = fillDailyViewGaps(data, 3)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ date: '2026-02-15', views: 10, unique_viewers: 5 })
    expect(result[1]).toEqual({ date: '2026-02-16', views: 0, unique_viewers: 0 })
    expect(result[2]).toEqual({ date: '2026-02-17', views: 20, unique_viewers: 8 })
  })

  it('handles days larger than data range', () => {
    const data = [{ date: '2026-02-17', views: 5, unique_viewers: 3 }]
    const result = fillDailyViewGaps(data, 5)
    expect(result).toHaveLength(5)
    expect(result[0].date).toBe('2026-02-13')
    expect(result[0].views).toBe(0)
    expect(result[4].date).toBe('2026-02-17')
    expect(result[4].views).toBe(5)
  })

  it('handles out-of-order input', () => {
    const data = [
      { date: '2026-02-17', views: 20, unique_viewers: 8 },
      { date: '2026-02-15', views: 10, unique_viewers: 5 },
    ]
    const result = fillDailyViewGaps(data, 3)
    expect(result).toHaveLength(3)
    expect(result[0].views).toBe(10)
    expect(result[2].views).toBe(20)
  })

  it('anchors to today when data is stale (latest date < today)', () => {
    // Today is 2026-02-17, data only has Jan 22
    const data = [
      { date: '2026-01-22', views: 100, unique_viewers: 50 },
    ]
    const result = fillDailyViewGaps(data, 7)
    expect(result).toHaveLength(7)
    expect(result[6].date).toBe('2026-02-17')
    expect(result[0].date).toBe('2026-02-11')
    // Stale data is out of the 7-day window
    expect(result.every(d => d.views === 0)).toBe(true)
  })
})

// ── 23. computePopularContentTable ──

describe('computePopularContentTable', () => {
  it('returns empty for empty input', () => {
    expect(computePopularContentTable([])).toEqual([])
  })

  it('transforms data with formatted duration', () => {
    const result = computePopularContentTable([
      { id: '1', title: 'Test', slug: 'test', locale: 'ko', view_count: 100, unique_viewers: 50, avg_duration_ms: 150_000 },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].avg_duration).toBe('2m 30s')
    expect(result[0].view_count).toBe(100)
    expect(result[0].unique_viewers).toBe(50)
  })

  it('handles zero duration', () => {
    const result = computePopularContentTable([
      { id: '1', title: 'Test', slug: 'test', locale: 'en', view_count: 5, unique_viewers: 3, avg_duration_ms: 0 },
    ])
    expect(result[0].avg_duration).toBe('0s')
  })
})

// ── 24. computeReferrerBreakdown ──

describe('computeReferrerBreakdown', () => {
  it('returns empty for empty input', () => {
    expect(computeReferrerBreakdown([])).toEqual([])
  })

  it('computes percentages by category', () => {
    const result = computeReferrerBreakdown([
      { category: 'search', count: 60 },
      { category: 'social', count: 30 },
      { category: 'direct', count: 10 },
    ])
    expect(result).toEqual([
      { category: 'search', count: 60, percentage: 60 },
      { category: 'social', count: 30, percentage: 30 },
      { category: 'direct', count: 10, percentage: 10 },
    ])
  })

  it('handles all-zero counts', () => {
    expect(computeReferrerBreakdown([{ category: 'direct', count: 0 }])).toEqual([])
  })

  it('handles single category at 100%', () => {
    const result = computeReferrerBreakdown([{ category: 'search', count: 50 }])
    expect(result[0].percentage).toBe(100)
  })
})

// ── 25. computeDeviceBreakdown ──

describe('computeDeviceBreakdown', () => {
  it('returns empty for empty input', () => {
    expect(computeDeviceBreakdown([])).toEqual([])
  })

  it('computes percentages by device type', () => {
    const result = computeDeviceBreakdown([
      { device_type: 'mobile', count: 50 },
      { device_type: 'desktop', count: 40 },
      { device_type: 'tablet', count: 10 },
    ])
    expect(result).toEqual([
      { device: 'mobile', count: 50, percentage: 50 },
      { device: 'desktop', count: 40, percentage: 40 },
      { device: 'tablet', count: 10, percentage: 10 },
    ])
  })

  it('handles all-zero counts', () => {
    expect(computeDeviceBreakdown([{ device_type: 'desktop', count: 0 }])).toEqual([])
  })
})

// ── 26. computeScrollDepthDistribution ──

describe('computeScrollDepthDistribution', () => {
  it('returns empty for empty input', () => {
    expect(computeScrollDepthDistribution([])).toEqual([])
  })

  it('sorts by milestone and adds labels', () => {
    const result = computeScrollDepthDistribution([
      { milestone: 75, count: 20 },
      { milestone: 25, count: 50 },
      { milestone: 100, count: 10 },
      { milestone: 0, count: 80 },
      { milestone: 50, count: 35 },
    ])
    expect(result.map((r) => r.milestone)).toEqual([0, 25, 50, 75, 100])
    expect(result[0].label).toBe('0%')
    expect(result[4].label).toBe('100%')
  })
})

// ── 27. computeConversionFunnel ──

describe('computeConversionFunnel', () => {
  it('computes funnel steps with percentages', () => {
    const result = computeConversionFunnel({
      content_viewers: 1000,
      signed_up: 200,
      created_deck: 100,
      studied_cards: 50,
    })
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ label: 'Content Viewers', key: 'content_viewers', count: 1000, percentage: 100 })
    expect(result[1]).toEqual({ label: 'Signed Up', key: 'signed_up', count: 200, percentage: 20 })
    expect(result[2]).toEqual({ label: 'Created Deck', key: 'created_deck', count: 100, percentage: 10 })
    expect(result[3]).toEqual({ label: 'Studied Cards', key: 'studied_cards', count: 50, percentage: 5 })
  })

  it('handles zero content viewers', () => {
    const result = computeConversionFunnel({
      content_viewers: 0,
      signed_up: 0,
      created_deck: 0,
      studied_cards: 0,
    })
    expect(result[0].percentage).toBe(0)
  })
})

// ── 28. mergeDailySummaryWithLive ──

describe('mergeDailySummaryWithLive', () => {
  it('merges summaries and live data', () => {
    const summaries = [
      { date: '2026-02-10', view_count: 100, unique_sessions: 50, unique_viewers: 40, avg_duration_ms: 5000 },
      { date: '2026-02-11', view_count: 120, unique_sessions: 60, unique_viewers: 45, avg_duration_ms: 6000 },
    ]
    const live = [
      { date: '2026-02-12', views: 80, unique_viewers: 30 },
    ]
    const result = mergeDailySummaryWithLive(summaries, live)
    expect(result).toHaveLength(3)
    expect(result[0].date).toBe('2026-02-10')
    expect(result[0].views).toBe(100)
    expect(result[2].date).toBe('2026-02-12')
    expect(result[2].views).toBe(80)
  })

  it('live data overrides summary for same date', () => {
    const summaries = [
      { date: '2026-02-12', view_count: 100, unique_sessions: 50, unique_viewers: 40, avg_duration_ms: 5000 },
    ]
    const live = [
      { date: '2026-02-12', views: 120, unique_viewers: 55 },
    ]
    const result = mergeDailySummaryWithLive(summaries, live)
    expect(result).toHaveLength(1)
    expect(result[0].views).toBe(120)
  })

  it('returns empty for both empty', () => {
    expect(mergeDailySummaryWithLive([], [])).toEqual([])
  })
})

// ── 29. computeBounceRate ──

describe('computeBounceRate', () => {
  it('computes bounce and engaged rates', () => {
    const result = computeBounceRate({
      total_content_views: 1000,
      bounced_views: 400,
      engaged_views: 600,
    })
    expect(result.bounceRate).toBe(40)
    expect(result.engagedRate).toBe(60)
    expect(result.total).toBe(1000)
    expect(result.bounced).toBe(400)
    expect(result.engaged).toBe(600)
  })

  it('handles zero total views', () => {
    const result = computeBounceRate({
      total_content_views: 0,
      bounced_views: 0,
      engaged_views: 0,
    })
    expect(result.bounceRate).toBe(0)
    expect(result.engagedRate).toBe(0)
  })

  it('handles all bounced', () => {
    const result = computeBounceRate({
      total_content_views: 100,
      bounced_views: 100,
      engaged_views: 0,
    })
    expect(result.bounceRate).toBe(100)
    expect(result.engagedRate).toBe(0)
  })

  it('handles all engaged', () => {
    const result = computeBounceRate({
      total_content_views: 100,
      bounced_views: 0,
      engaged_views: 100,
    })
    expect(result.bounceRate).toBe(0)
    expect(result.engagedRate).toBe(100)
  })
})

// ── 30. computeTopPagesTable ──

describe('computeTopPagesTable', () => {
  it('returns empty for empty input', () => {
    expect(computeTopPagesTable([])).toEqual([])
  })

  it('maps page data correctly', () => {
    const result = computeTopPagesTable([
      { page_path: '/landing', view_count: 500, unique_visitors: 300 },
      { page_path: '/content', view_count: 200, unique_visitors: 150 },
    ])
    expect(result).toHaveLength(2)
    expect(result[0].page_path).toBe('/landing')
    expect(result[0].view_count).toBe(500)
    expect(result[1].unique_visitors).toBe(150)
  })
})

// ── computeUtmSourceBreakdown ──

describe('computeUtmSourceBreakdown', () => {
  it('returns empty array for empty input', () => {
    expect(computeUtmSourceBreakdown([])).toEqual([])
  })

  it('computes percentages correctly', () => {
    const result = computeUtmSourceBreakdown([
      { source: 'blog', count: 60 },
      { source: 'google', count: 30 },
      { source: 'organic', count: 10 },
    ])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ source: 'blog', count: 60, percentage: 60 })
    expect(result[1]).toEqual({ source: 'google', count: 30, percentage: 30 })
    expect(result[2]).toEqual({ source: 'organic', count: 10, percentage: 10 })
  })

  it('handles single source (100%)', () => {
    const result = computeUtmSourceBreakdown([{ source: 'blog', count: 42 }])
    expect(result).toHaveLength(1)
    expect(result[0].percentage).toBe(100)
  })

  it('returns empty for all-zero counts', () => {
    const result = computeUtmSourceBreakdown([
      { source: 'blog', count: 0 },
      { source: 'organic', count: 0 },
    ])
    expect(result).toEqual([])
  })
})
