import { describe, it, expect } from 'vitest'
import {
  filterSessionsByPeriod,
  filterSessionsByDeckScope,
  computeOverviewStats,
  computeModeBreakdown,
  computeDailySessionCounts,
  computeRatingDistribution,
  computeGroupedRatingDistribution,
  computeSessionDurationTrend,
  computeStudyTimeByMode,
  computePerformanceTrend,
  computeSrsStats,
} from '../study-history-stats'
import type { StudySession, StudyLog } from '../../types/database'

// ── Helpers ──

function makeSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: 'test-id',
    user_id: 'user-1',
    deck_id: 'deck-1',
    study_mode: 'srs',
    cards_studied: 10,
    total_cards: 20,
    total_duration_ms: 60000,
    ratings: { good: 7, easy: 3 },
    started_at: '2026-02-15T10:00:00Z',
    completed_at: '2026-02-15T10:01:00Z',
    ...overrides,
  }
}

function makeLog(overrides: Partial<StudyLog> = {}): StudyLog {
  return {
    id: 'log-1',
    user_id: 'user-1',
    card_id: 'card-1',
    deck_id: 'deck-1',
    study_mode: 'srs',
    rating: 'good',
    prev_interval: null,
    new_interval: null,
    prev_ease: null,
    new_ease: null,
    review_duration_ms: 5000,
    studied_at: '2026-02-15T10:00:00Z',
    ...overrides,
  }
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ── 1. filterSessionsByPeriod ──

describe('filterSessionsByPeriod', () => {
  it('returns empty array for empty input', () => {
    expect(filterSessionsByPeriod([], 7)).toEqual([])
  })

  it('includes sessions within the period', () => {
    const sessions = [
      makeSession({ id: 'recent', completed_at: daysAgo(2) }),
      makeSession({ id: 'old', completed_at: daysAgo(10) }),
    ]
    const result = filterSessionsByPeriod(sessions, 7)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('recent')
  })

  it('includes sessions from exactly the cutoff day', () => {
    const sessions = [
      makeSession({ id: 'edge', completed_at: daysAgo(6) }),
    ]
    const result = filterSessionsByPeriod(sessions, 7)
    expect(result).toHaveLength(1)
  })

  it('excludes sessions before the cutoff', () => {
    const sessions = [
      makeSession({ id: 'old', completed_at: daysAgo(31) }),
    ]
    const result = filterSessionsByPeriod(sessions, 30)
    expect(result).toHaveLength(0)
  })

  it('1-day period includes only today', () => {
    const sessions = [
      makeSession({ id: 'today', completed_at: daysAgo(0) }),
      makeSession({ id: 'yesterday', completed_at: daysAgo(1) }),
    ]
    const result = filterSessionsByPeriod(sessions, 1)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('today')
  })
})

// ── 2. computeOverviewStats ──

describe('computeOverviewStats', () => {
  it('returns zeros for empty sessions', () => {
    const stats = computeOverviewStats([])
    expect(stats).toEqual({
      totalSessions: 0,
      totalCardsStudied: 0,
      totalTimeMs: 0,
      avgPerformance: 0,
      avgSpeedMs: 0,
    })
  })

  it('computes correct totals for single session', () => {
    const sessions = [
      makeSession({
        cards_studied: 10,
        total_duration_ms: 30000,
        ratings: { good: 7, easy: 3 },
      }),
    ]
    const stats = computeOverviewStats(sessions)
    expect(stats.totalSessions).toBe(1)
    expect(stats.totalCardsStudied).toBe(10)
    expect(stats.totalTimeMs).toBe(30000)
    expect(stats.avgSpeedMs).toBe(3000) // 30000 / 10
  })

  it('computes correct totals for multiple sessions', () => {
    const sessions = [
      makeSession({ cards_studied: 10, total_duration_ms: 20000 }),
      makeSession({ id: 's2', cards_studied: 20, total_duration_ms: 40000 }),
    ]
    const stats = computeOverviewStats(sessions)
    expect(stats.totalSessions).toBe(2)
    expect(stats.totalCardsStudied).toBe(30)
    expect(stats.totalTimeMs).toBe(60000)
    expect(stats.avgSpeedMs).toBe(2000) // 60000 / 30
  })

  it('computes average performance across sessions', () => {
    const sessions = [
      makeSession({ ratings: { easy: 10 } }), // 100
      makeSession({ id: 's2', ratings: { again: 10 } }), // 0
    ]
    const stats = computeOverviewStats(sessions)
    expect(stats.avgPerformance).toBe(50)
  })
})

// ── 3. computeModeBreakdown ──

describe('computeModeBreakdown', () => {
  it('returns empty array for empty sessions', () => {
    expect(computeModeBreakdown([])).toEqual([])
  })

  it('groups sessions by mode', () => {
    const sessions = [
      makeSession({ study_mode: 'srs', cards_studied: 10, total_duration_ms: 30000, ratings: { good: 10 } }),
      makeSession({ id: 's2', study_mode: 'srs', cards_studied: 5, total_duration_ms: 20000, ratings: { easy: 5 } }),
      makeSession({ id: 's3', study_mode: 'random', cards_studied: 8, total_duration_ms: 15000, ratings: { hard: 8 } }),
    ]
    const breakdown = computeModeBreakdown(sessions)
    expect(breakdown).toHaveLength(2)

    const srs = breakdown.find((b) => b.mode === 'srs')!
    expect(srs.sessionCount).toBe(2)
    expect(srs.totalCards).toBe(15)
    expect(srs.totalTimeMs).toBe(50000)

    const random = breakdown.find((b) => b.mode === 'random')!
    expect(random.sessionCount).toBe(1)
    expect(random.totalCards).toBe(8)
  })

  it('computes average performance per mode', () => {
    const sessions = [
      makeSession({ study_mode: 'srs', ratings: { easy: 10 } }), // perf 100
      makeSession({ id: 's2', study_mode: 'srs', ratings: { again: 10 } }), // perf 0
    ]
    const breakdown = computeModeBreakdown(sessions)
    const srs = breakdown.find((b) => b.mode === 'srs')!
    expect(srs.avgPerformance).toBe(50)
  })
})

// ── 4. computeDailySessionCounts ──

describe('computeDailySessionCounts', () => {
  it('returns entries for all days in the period with zeros', () => {
    const result = computeDailySessionCounts([], 7)
    expect(result).toHaveLength(7)
    result.forEach((entry) => {
      expect(entry.sessions).toBe(0)
      expect(entry.cards).toBe(0)
    })
  })

  it('counts sessions and cards per day', () => {
    const today = daysAgo(0)
    const sessions = [
      makeSession({ id: 's1', completed_at: today, cards_studied: 10 }),
      makeSession({ id: 's2', completed_at: today, cards_studied: 5 }),
    ]
    const result = computeDailySessionCounts(sessions, 7)
    const todayEntry = result[result.length - 1]
    expect(todayEntry.sessions).toBe(2)
    expect(todayEntry.cards).toBe(15)
  })

  it('returns dates in YYYY-MM-DD format', () => {
    const result = computeDailySessionCounts([], 3)
    result.forEach((entry) => {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  it('handles sessions across multiple days', () => {
    const sessions = [
      makeSession({ id: 's1', completed_at: daysAgo(0), cards_studied: 5 }),
      makeSession({ id: 's2', completed_at: daysAgo(2), cards_studied: 3 }),
    ]
    const result = computeDailySessionCounts(sessions, 7)
    const withData = result.filter((e) => e.sessions > 0)
    expect(withData).toHaveLength(2)
  })
})

// ── 5. computeRatingDistribution ──

describe('computeRatingDistribution', () => {
  it('returns empty array for empty sessions', () => {
    expect(computeRatingDistribution([])).toEqual([])
  })

  it('aggregates ratings from all sessions', () => {
    const sessions = [
      makeSession({ ratings: { good: 5, easy: 5 } }),
      makeSession({ id: 's2', ratings: { again: 2, hard: 3, good: 5 } }),
    ]
    const dist = computeRatingDistribution(sessions)
    expect(dist.find((d) => d.rating === 'good')!.count).toBe(10)
    expect(dist.find((d) => d.rating === 'easy')!.count).toBe(5)
    expect(dist.find((d) => d.rating === 'again')!.count).toBe(2)
    expect(dist.find((d) => d.rating === 'hard')!.count).toBe(3)

    // Percentages should sum to ~100
    const totalPct = dist.reduce((s, d) => s + d.percentage, 0)
    expect(totalPct).toBeCloseTo(100, 0)
  })

  it('returns ratings in canonical order (again, hard, good, easy)', () => {
    const sessions = [
      makeSession({ ratings: { easy: 1, again: 1, good: 1, hard: 1 } }),
    ]
    const dist = computeRatingDistribution(sessions)
    expect(dist.map((d) => d.rating)).toEqual(['again', 'hard', 'good', 'easy'])
  })

  it('handles sessions with only one rating type', () => {
    const sessions = [makeSession({ ratings: { good: 10 } })]
    const dist = computeRatingDistribution(sessions)
    expect(dist).toHaveLength(1)
    expect(dist[0].percentage).toBe(100)
  })
})

// ── 6. computeSessionDurationTrend ──

describe('computeSessionDurationTrend', () => {
  it('returns entries for all days in the period', () => {
    const result = computeSessionDurationTrend([], 7)
    expect(result).toHaveLength(7)
    result.forEach((entry) => {
      expect(entry.avgDurationMs).toBe(0)
      expect(entry.sessionCount).toBe(0)
    })
  })

  it('computes average duration per day', () => {
    const today = daysAgo(0)
    const sessions = [
      makeSession({ id: 's1', completed_at: today, total_duration_ms: 60000 }),
      makeSession({ id: 's2', completed_at: today, total_duration_ms: 30000 }),
    ]
    const result = computeSessionDurationTrend(sessions, 7)
    const todayEntry = result[result.length - 1]
    expect(todayEntry.avgDurationMs).toBe(45000)
    expect(todayEntry.sessionCount).toBe(2)
  })

  it('returns dates in YYYY-MM-DD format', () => {
    const result = computeSessionDurationTrend([], 3)
    result.forEach((entry) => {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })
})

// ── 7. computeStudyTimeByMode ──

describe('computeStudyTimeByMode', () => {
  it('returns empty array for empty sessions', () => {
    expect(computeStudyTimeByMode([])).toEqual([])
  })

  it('groups time by mode', () => {
    const sessions = [
      makeSession({ study_mode: 'srs', total_duration_ms: 60000 }),
      makeSession({ id: 's2', study_mode: 'srs', total_duration_ms: 40000 }),
      makeSession({ id: 's3', study_mode: 'random', total_duration_ms: 50000 }),
    ]
    const result = computeStudyTimeByMode(sessions)
    expect(result).toHaveLength(2)

    const srs = result.find((r) => r.mode === 'srs')!
    expect(srs.totalTimeMs).toBe(100000)

    const random = result.find((r) => r.mode === 'random')!
    expect(random.totalTimeMs).toBe(50000)
  })

  it('percentages sum to 100', () => {
    const sessions = [
      makeSession({ study_mode: 'srs', total_duration_ms: 75000 }),
      makeSession({ id: 's2', study_mode: 'random', total_duration_ms: 25000 }),
    ]
    const result = computeStudyTimeByMode(sessions)
    const totalPct = result.reduce((s, r) => s + r.percentage, 0)
    expect(totalPct).toBeCloseTo(100, 0)
  })
})

// ── 8. computePerformanceTrend ──

describe('computePerformanceTrend', () => {
  it('returns entries for all days in the period', () => {
    const result = computePerformanceTrend([], 7)
    expect(result).toHaveLength(7)
    result.forEach((entry) => {
      expect(entry.avgPerformance).toBe(0)
      expect(entry.sessionCount).toBe(0)
    })
  })

  it('computes average performance per day', () => {
    const today = daysAgo(0)
    const sessions = [
      makeSession({ id: 's1', completed_at: today, ratings: { easy: 10 } }), // perf 100
      makeSession({ id: 's2', completed_at: today, ratings: { again: 10 } }), // perf 0
    ]
    const result = computePerformanceTrend(sessions, 7)
    const todayEntry = result[result.length - 1]
    expect(todayEntry.avgPerformance).toBe(50)
    expect(todayEntry.sessionCount).toBe(2)
  })

  it('returns dates in YYYY-MM-DD format', () => {
    const result = computePerformanceTrend([], 3)
    result.forEach((entry) => {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })
})

// ── 9. computeSrsStats ──

describe('computeSrsStats', () => {
  it('returns zeros for empty logs', () => {
    const stats = computeSrsStats([])
    expect(stats.totalReviews).toBe(0)
    expect(stats.retentionRate).toBe(0)
    expect(stats.avgIntervalGrowth).toBe(0)
    expect(stats.avgNewEase).toBe(0)
    expect(stats.easeDistribution).toEqual([])
  })

  it('counts total SRS reviews', () => {
    const logs = [
      makeLog({ study_mode: 'srs' }),
      makeLog({ id: 'log-2', study_mode: 'srs' }),
      makeLog({ id: 'log-3', study_mode: 'random' }), // not srs
    ]
    const stats = computeSrsStats(logs)
    expect(stats.totalReviews).toBe(2)
  })

  it('computes retention rate (non-again percentage)', () => {
    const logs = [
      makeLog({ study_mode: 'srs', rating: 'good' }),
      makeLog({ id: 'l2', study_mode: 'srs', rating: 'easy' }),
      makeLog({ id: 'l3', study_mode: 'srs', rating: 'again' }),
      makeLog({ id: 'l4', study_mode: 'srs', rating: 'hard' }),
    ]
    const stats = computeSrsStats(logs)
    expect(stats.retentionRate).toBe(75) // 3 out of 4
  })

  it('computes average interval growth', () => {
    const logs = [
      makeLog({ study_mode: 'srs', prev_interval: 1, new_interval: 3 }), // growth 2
      makeLog({ id: 'l2', study_mode: 'srs', prev_interval: 3, new_interval: 7 }), // growth 4
    ]
    const stats = computeSrsStats(logs)
    expect(stats.avgIntervalGrowth).toBe(3) // (2 + 4) / 2
  })

  it('computes average new ease factor', () => {
    const logs = [
      makeLog({ study_mode: 'srs', new_ease: 2.5 }),
      makeLog({ id: 'l2', study_mode: 'srs', new_ease: 2.0 }),
    ]
    const stats = computeSrsStats(logs)
    expect(stats.avgNewEase).toBe(2.25)
  })

  it('builds ease distribution buckets', () => {
    const logs = [
      makeLog({ study_mode: 'srs', new_ease: 1.5 }),
      makeLog({ id: 'l2', study_mode: 'srs', new_ease: 2.0 }),
      makeLog({ id: 'l3', study_mode: 'srs', new_ease: 2.3 }),
      makeLog({ id: 'l4', study_mode: 'srs', new_ease: 2.8 }),
      makeLog({ id: 'l5', study_mode: 'srs', new_ease: 3.2 }),
    ]
    const stats = computeSrsStats(logs)
    expect(stats.easeDistribution.length).toBeGreaterThan(0)
    const totalCount = stats.easeDistribution.reduce((s, b) => s + b.count, 0)
    expect(totalCount).toBe(5)
  })

  it('ignores logs with null interval for growth calculation', () => {
    const logs = [
      makeLog({ study_mode: 'srs', prev_interval: null, new_interval: null }),
      makeLog({ id: 'l2', study_mode: 'srs', prev_interval: 1, new_interval: 5 }),
    ]
    const stats = computeSrsStats(logs)
    expect(stats.avgIntervalGrowth).toBe(4) // only one valid log
  })
})

// ── 10. filterSessionsByDeckScope ──

describe('filterSessionsByDeckScope', () => {
  const sessions = [
    makeSession({ id: 's1', deck_id: 'deck-1', cards_studied: 10 }),
    makeSession({ id: 's2', deck_id: 'deck-2', cards_studied: 5 }),
    makeSession({ id: 's3', deck_id: 'deck-1', cards_studied: 8 }),
    makeSession({ id: 's4', deck_id: 'deck-3', cards_studied: 3 }),
  ]

  it('returns all sessions when scope is "all"', () => {
    const result = filterSessionsByDeckScope(sessions, 'all')
    expect(result).toHaveLength(4)
    expect(result).toEqual(sessions)
  })

  it('filters to specific deck when scope is a deck ID', () => {
    const result = filterSessionsByDeckScope(sessions, 'deck-1')
    expect(result).toHaveLength(2)
    expect(result.every(s => s.deck_id === 'deck-1')).toBe(true)
  })

  it('returns empty when no sessions match the deck', () => {
    const result = filterSessionsByDeckScope(sessions, 'deck-999')
    expect(result).toHaveLength(0)
  })

  it('returns empty for empty sessions regardless of scope', () => {
    expect(filterSessionsByDeckScope([], 'all')).toHaveLength(0)
    expect(filterSessionsByDeckScope([], 'deck-1')).toHaveLength(0)
  })
})

// ── 11. Per-deck stats composition ──

describe('per-deck stats composition', () => {
  const deck1Sessions = [
    makeSession({
      id: 's1',
      deck_id: 'deck-1',
      study_mode: 'srs',
      cards_studied: 10,
      total_duration_ms: 60000,
      ratings: { good: 7, easy: 3 },
      completed_at: daysAgo(0),
    }),
    makeSession({
      id: 's2',
      deck_id: 'deck-1',
      study_mode: 'random',
      cards_studied: 5,
      total_duration_ms: 30000,
      ratings: { hard: 3, good: 2 },
      completed_at: daysAgo(1),
    }),
  ]
  const deck2Sessions = [
    makeSession({
      id: 's3',
      deck_id: 'deck-2',
      study_mode: 'srs',
      cards_studied: 20,
      total_duration_ms: 120000,
      ratings: { again: 5, good: 15 },
      completed_at: daysAgo(0),
    }),
  ]
  const allSessions = [...deck1Sessions, ...deck2Sessions]

  it('overview stats differ when filtered by deck vs all', () => {
    const allStats = computeOverviewStats(filterSessionsByDeckScope(allSessions, 'all'))
    const deck1Stats = computeOverviewStats(filterSessionsByDeckScope(allSessions, 'deck-1'))
    const deck2Stats = computeOverviewStats(filterSessionsByDeckScope(allSessions, 'deck-2'))

    expect(allStats.totalSessions).toBe(3)
    expect(deck1Stats.totalSessions).toBe(2)
    expect(deck2Stats.totalSessions).toBe(1)

    expect(allStats.totalCardsStudied).toBe(35)
    expect(deck1Stats.totalCardsStudied).toBe(15)
    expect(deck2Stats.totalCardsStudied).toBe(20)
  })

  it('mode breakdown shows only modes used in that deck', () => {
    const deck1Breakdown = computeModeBreakdown(filterSessionsByDeckScope(allSessions, 'deck-1'))
    const deck2Breakdown = computeModeBreakdown(filterSessionsByDeckScope(allSessions, 'deck-2'))

    expect(deck1Breakdown).toHaveLength(2) // srs + random
    expect(deck2Breakdown).toHaveLength(1) // srs only
    expect(deck1Breakdown.map(b => b.mode).sort()).toEqual(['random', 'srs'])
    expect(deck2Breakdown[0].mode).toBe('srs')
  })

  it('rating distribution is deck-specific', () => {
    const deck1Dist = computeRatingDistribution(filterSessionsByDeckScope(allSessions, 'deck-1'))
    const deck2Dist = computeRatingDistribution(filterSessionsByDeckScope(allSessions, 'deck-2'))

    // deck-1: good 9, easy 3, hard 3
    expect(deck1Dist.find(d => d.rating === 'again')).toBeUndefined()
    // deck-2 has again
    expect(deck2Dist.find(d => d.rating === 'again')!.count).toBe(5)
  })
})

// ── 12. computeGroupedRatingDistribution ──

describe('computeGroupedRatingDistribution', () => {
  it('returns empty array for empty sessions', () => {
    expect(computeGroupedRatingDistribution([])).toEqual([])
  })

  it('returns single SRS group for SRS-only sessions', () => {
    const sessions = [
      makeSession({ study_mode: 'srs', ratings: { again: 2, hard: 3, good: 10, easy: 5 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(1)
    expect(result[0].groupId).toBe('srs')
    expect(result[0].total).toBe(20)
    expect(result[0].ratings.map(r => r.rating)).toEqual(['again', 'hard', 'good', 'easy'])
  })

  it('returns single simple group for random-mode sessions', () => {
    const sessions = [
      makeSession({ study_mode: 'random', ratings: { unknown: 4, known: 6 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(1)
    expect(result[0].groupId).toBe('simple')
    expect(result[0].ratings.map(r => r.rating)).toEqual(['unknown', 'known'])
  })

  it('returns single cramming group for cramming sessions', () => {
    const sessions = [
      makeSession({ study_mode: 'cramming', ratings: { missed: 3, got_it: 7 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(1)
    expect(result[0].groupId).toBe('cramming')
    expect(result[0].ratings.map(r => r.rating)).toEqual(['missed', 'got_it'])
  })

  it('separates SRS + simple into two groups', () => {
    const sessions = [
      makeSession({ id: 's1', study_mode: 'srs', ratings: { good: 10, easy: 5 } }),
      makeSession({ id: 's2', study_mode: 'random', ratings: { unknown: 3, known: 7 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(2)
    expect(result[0].groupId).toBe('srs')
    expect(result[1].groupId).toBe('simple')
  })

  it('returns all 3 groups when all modes are present', () => {
    const sessions = [
      makeSession({ id: 's1', study_mode: 'srs', ratings: { good: 5 } }),
      makeSession({ id: 's2', study_mode: 'sequential', ratings: { known: 3 } }),
      makeSession({ id: 's3', study_mode: 'cramming', ratings: { got_it: 2 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(3)
    expect(result.map(g => g.groupId)).toEqual(['srs', 'simple', 'cramming'])
  })

  it('maintains registry order (srs → simple → cramming)', () => {
    const sessions = [
      makeSession({ id: 's1', study_mode: 'cramming', ratings: { got_it: 1 } }),
      makeSession({ id: 's2', study_mode: 'srs', ratings: { good: 1 } }),
      makeSession({ id: 's3', study_mode: 'random', ratings: { known: 1 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result.map(g => g.groupId)).toEqual(['srs', 'simple', 'cramming'])
  })

  it('excludes "next" rating from distribution', () => {
    const sessions = [
      makeSession({ study_mode: 'srs', ratings: { good: 5, next: 10 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(1)
    expect(result[0].total).toBe(5)
    expect(result[0].ratings.find(r => r.rating === 'next')).toBeUndefined()
  })

  it('computes correct percentages per group', () => {
    const sessions = [
      makeSession({ study_mode: 'srs', ratings: { again: 1, hard: 2, good: 3, easy: 4 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    const group = result[0]
    expect(group.total).toBe(10)
    expect(group.ratings.find(r => r.rating === 'again')!.percentage).toBe(10)
    expect(group.ratings.find(r => r.rating === 'easy')!.percentage).toBe(40)
  })

  it('aggregates multiple sessions of the same group', () => {
    const sessions = [
      makeSession({ id: 's1', study_mode: 'random', ratings: { unknown: 3, known: 7 } }),
      makeSession({ id: 's2', study_mode: 'sequential', ratings: { unknown: 2, known: 8 } }),
      makeSession({ id: 's3', study_mode: 'by_date', ratings: { known: 5 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(1)
    expect(result[0].groupId).toBe('simple')
    expect(result[0].total).toBe(25)
    expect(result[0].ratings.find(r => r.rating === 'unknown')!.count).toBe(5)
    expect(result[0].ratings.find(r => r.rating === 'known')!.count).toBe(20)
  })

  it('skips group when all ratings are excluded', () => {
    const sessions = [
      makeSession({ study_mode: 'srs', ratings: { next: 10 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(0)
  })

  it('skips group when ratings are empty', () => {
    const sessions = [
      makeSession({ study_mode: 'srs', ratings: {} }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(0)
  })

  it('i18nKey matches the registry definition', () => {
    const sessions = [
      makeSession({ id: 's1', study_mode: 'srs', ratings: { good: 1 } }),
      makeSession({ id: 's2', study_mode: 'random', ratings: { known: 1 } }),
      makeSession({ id: 's3', study_mode: 'cramming', ratings: { got_it: 1 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result[0].i18nKey).toBe('ratingGroups.srs')
    expect(result[1].i18nKey).toBe('ratingGroups.simple')
    expect(result[2].i18nKey).toBe('ratingGroups.cramming')
  })

  it('excludes cross-group ratings (e.g. "good" in random-mode session)', () => {
    // Real-world case: a random-mode session may contain legacy "good" ratings
    const sessions = [
      makeSession({ study_mode: 'random', ratings: { good: 16, unknown: 12, known: 39 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result).toHaveLength(1)
    expect(result[0].groupId).toBe('simple')
    // "good" must NOT appear — it belongs to the SRS group
    expect(result[0].ratings.map(r => r.rating)).toEqual(['unknown', 'known'])
    expect(result[0].total).toBe(51) // only unknown + known
    expect(result[0].ratings.find(r => r.rating === 'good')).toBeUndefined()
  })

  it('excludes cross-group ratings from total calculation', () => {
    const sessions = [
      makeSession({ study_mode: 'cramming', ratings: { missed: 1, got_it: 9, good: 5 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    expect(result[0].total).toBe(10) // only missed + got_it, not good
    expect(result[0].ratings).toHaveLength(2)
  })

  it('handles session with only cross-group ratings (skips group)', () => {
    // A random-mode session that somehow only has SRS ratings
    const sessions = [
      makeSession({ study_mode: 'random', ratings: { good: 5, easy: 3 } }),
    ]
    const result = computeGroupedRatingDistribution(sessions)
    // No simple-group ratings found, so group should be skipped
    expect(result).toHaveLength(0)
  })
})
