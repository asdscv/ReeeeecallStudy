import { describe, it, expect } from 'vitest'
import {
  getForecastReviews,
  getHeatmapData,
  getDailyStudyCounts,
  getStreakDays,
  getMasteryRate,
  groupCardsByDate,
  calculateDeckStats,
  filterLogsByPeriod,
} from '../stats'

// Helper: create ISO date string for N days from now
function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

// Helper: create ISO date string for N days ago
function daysAgo(n: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

describe('getForecastReviews', () => {
  it('counts reviews per day for next 7 days by default', () => {
    const cards = [
      { next_review_at: daysFromNow(0) },
      { next_review_at: daysFromNow(0) },
      { next_review_at: daysFromNow(1) },
      { next_review_at: daysFromNow(3) },
      { next_review_at: daysFromNow(10) }, // beyond 7 days
      { next_review_at: null },
    ]
    const result = getForecastReviews(cards)
    expect(result).toHaveLength(7)
    expect(result[0].count).toBe(2) // today
    expect(result[1].count).toBe(1) // tomorrow
    expect(result[2].count).toBe(0) // day 2
    expect(result[3].count).toBe(1) // day 3
  })

  it('supports custom day range', () => {
    const cards = [
      { next_review_at: daysFromNow(0) },
      { next_review_at: daysFromNow(2) },
    ]
    const result = getForecastReviews(cards, 3)
    expect(result).toHaveLength(3)
  })

  it('returns all zeros when no cards have reviews', () => {
    const result = getForecastReviews([])
    expect(result).toHaveLength(7)
    result.forEach((d) => expect(d.count).toBe(0))
  })

  it('counts overdue cards (next_review_at in the past) in today bucket', () => {
    const cards = [
      { next_review_at: daysFromNow(-3) }, // 3 days overdue
      { next_review_at: daysFromNow(-1) }, // 1 day overdue
      { next_review_at: daysFromNow(0) },  // due today
      { next_review_at: daysFromNow(2) },  // future
    ]
    const result = getForecastReviews(cards)
    expect(result[0].count).toBe(3) // 2 overdue + 1 today = 3
    expect(result[2].count).toBe(1) // day 2
  })
})

describe('getHeatmapData', () => {
  it('groups study logs by date', () => {
    const logs = [
      { studied_at: daysAgo(0) },
      { studied_at: daysAgo(0) },
      { studied_at: daysAgo(0) },
      { studied_at: daysAgo(1) },
    ]
    const result = getHeatmapData(logs)
    // Should have entries for dates with activity
    const todayEntry = result.find((r) => {
      const today = new Date()
      return r.date === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    })
    expect(todayEntry).toBeDefined()
    expect(todayEntry!.count).toBe(3)
  })

  it('returns empty array for no logs', () => {
    const result = getHeatmapData([])
    expect(result).toEqual([])
  })
})

describe('getDailyStudyCounts', () => {
  it('returns counts for last 30 days by default', () => {
    const logs = [
      { studied_at: daysAgo(0) },
      { studied_at: daysAgo(0) },
      { studied_at: daysAgo(5) },
    ]
    const result = getDailyStudyCounts(logs)
    expect(result).toHaveLength(30)
    expect(result[result.length - 1].count).toBe(2) // today (last entry)
    expect(result[result.length - 6].count).toBe(1) // 5 days ago
  })

  it('supports custom day range', () => {
    const logs = [{ studied_at: daysAgo(0) }]
    const result = getDailyStudyCounts(logs, 7)
    expect(result).toHaveLength(7)
  })

  it('fills missing days with zero', () => {
    const result = getDailyStudyCounts([], 7)
    expect(result).toHaveLength(7)
    result.forEach((d) => expect(d.count).toBe(0))
  })
})

describe('getStreakDays', () => {
  it('counts consecutive study days up to today', () => {
    const logs = [
      { studied_at: daysAgo(0) },
      { studied_at: daysAgo(1) },
      { studied_at: daysAgo(1) },
      { studied_at: daysAgo(2) },
      // gap at day 3
    ]
    expect(getStreakDays(logs)).toBe(3)
  })

  it('returns 0 if no study today', () => {
    const logs = [
      { studied_at: daysAgo(2) },
      { studied_at: daysAgo(3) },
    ]
    expect(getStreakDays(logs)).toBe(0)
  })

  it('returns 0 for empty logs', () => {
    expect(getStreakDays([])).toBe(0)
  })

  it('returns 1 if only studied today', () => {
    const logs = [{ studied_at: daysAgo(0) }]
    expect(getStreakDays(logs)).toBe(1)
  })
})

describe('getMasteryRate', () => {
  it('calculates percentage of mature cards (review + interval >= 21)', () => {
    const cards = [
      { srs_status: 'review' as const, interval_days: 30 },
      { srs_status: 'review' as const, interval_days: 21 },
      { srs_status: 'review' as const, interval_days: 10 },
      { srs_status: 'learning' as const, interval_days: 0 },
      { srs_status: 'new' as const, interval_days: 0 },
    ]
    // 2 mature out of 5 = 40%
    expect(getMasteryRate(cards)).toBe(40)
  })

  it('returns 0 for empty cards', () => {
    expect(getMasteryRate([])).toBe(0)
  })

  it('returns 100 when all cards are mature', () => {
    const cards = [
      { srs_status: 'review' as const, interval_days: 30 },
      { srs_status: 'review' as const, interval_days: 60 },
    ]
    expect(getMasteryRate(cards)).toBe(100)
  })
})

describe('groupCardsByDate', () => {
  it('groups cards by creation date', () => {
    const today = new Date()
    today.setHours(10, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const cards = [
      { created_at: today.toISOString() },
      { created_at: today.toISOString() },
      { created_at: yesterday.toISOString() },
    ]
    const result = groupCardsByDate(cards)
    expect(result).toHaveLength(2)
    // Sorted descending (newest first)
    expect(result[0].count).toBe(2)
    expect(result[1].count).toBe(1)
  })

  it('returns empty array for no cards', () => {
    expect(groupCardsByDate([])).toEqual([])
  })
})

describe('filterLogsByPeriod', () => {
  it('filters to last 7 days only', () => {
    const logs = [
      { studied_at: daysAgo(0) },
      { studied_at: daysAgo(3) },
      { studied_at: daysAgo(6) },
      { studied_at: daysAgo(10) },
      { studied_at: daysAgo(30) },
    ]
    const result = filterLogsByPeriod(logs, 7)
    expect(result).toHaveLength(3)
  })

  it('returns all logs for 365 days if all within range', () => {
    const logs = [
      { studied_at: daysAgo(0) },
      { studied_at: daysAgo(100) },
      { studied_at: daysAgo(364) },
    ]
    const result = filterLogsByPeriod(logs, 365)
    expect(result).toHaveLength(3)
  })

  it('returns empty array for empty input', () => {
    expect(filterLogsByPeriod([], 7)).toEqual([])
  })

  it('filters to today only with days=1', () => {
    const logs = [
      { studied_at: daysAgo(0) },
      { studied_at: daysAgo(1) },
      { studied_at: daysAgo(5) },
    ]
    const result = filterLogsByPeriod(logs, 1)
    expect(result).toHaveLength(1)
  })
})

describe('calculateDeckStats', () => {
  it('calculates comprehensive deck statistics', () => {
    const cards = [
      { srs_status: 'new' as const, ease_factor: 2.5, interval_days: 0, repetitions: 0 },
      { srs_status: 'learning' as const, ease_factor: 2.3, interval_days: 1, repetitions: 1 },
      { srs_status: 'review' as const, ease_factor: 2.7, interval_days: 30, repetitions: 5 },
      { srs_status: 'review' as const, ease_factor: 2.1, interval_days: 10, repetitions: 3 },
    ]
    const result = calculateDeckStats(cards)
    expect(result.totalCards).toBe(4)
    expect(result.newCount).toBe(1)
    expect(result.learningCount).toBe(1)
    expect(result.reviewCount).toBe(2)
    // averages exclude new cards (only learning + review)
    expect(result.avgEase).toBeCloseTo(2.37, 1) // (2.3 + 2.7 + 2.1) / 3
    expect(result.avgInterval).toBeCloseTo(13.67, 1) // (1 + 30 + 10) / 3
    expect(result.masteryRate).toBe(25) // 1 out of 4 is mature (interval >= 21)
  })

  it('handles empty cards', () => {
    const result = calculateDeckStats([])
    expect(result.totalCards).toBe(0)
    expect(result.avgEase).toBe(0)
    expect(result.avgInterval).toBe(0)
    expect(result.masteryRate).toBe(0)
  })

  it('excludes new cards from avgEase and avgInterval', () => {
    const cards = [
      { srs_status: 'new' as const, ease_factor: 2.5, interval_days: 0, repetitions: 0 },
      { srs_status: 'new' as const, ease_factor: 2.5, interval_days: 0, repetitions: 0 },
      { srs_status: 'learning' as const, ease_factor: 2.3, interval_days: 1, repetitions: 1 },
      { srs_status: 'review' as const, ease_factor: 2.7, interval_days: 30, repetitions: 5 },
    ]
    const result = calculateDeckStats(cards)
    // avgEase should only include learning + review: (2.3 + 2.7) / 2 = 2.5
    expect(result.avgEase).toBe(2.5)
    // avgInterval should only include learning + review: (1 + 30) / 2 = 15.5
    expect(result.avgInterval).toBe(15.5)
    // totalCards still counts all
    expect(result.totalCards).toBe(4)
    expect(result.newCount).toBe(2)
  })

  it('returns 0 avgEase/avgInterval when only new cards exist', () => {
    const cards = [
      { srs_status: 'new' as const, ease_factor: 2.5, interval_days: 0, repetitions: 0 },
      { srs_status: 'new' as const, ease_factor: 2.5, interval_days: 0, repetitions: 0 },
    ]
    const result = calculateDeckStats(cards)
    expect(result.avgEase).toBe(0)
    expect(result.avgInterval).toBe(0)
    expect(result.totalCards).toBe(2)
  })
})
