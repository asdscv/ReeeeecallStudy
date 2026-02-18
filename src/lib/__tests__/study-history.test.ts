import { describe, it, expect } from 'vitest'
import {
  formatDuration,
  getSessionPerformance,
  groupSessionsByDate,
  getStudyModeLabel,
  getStudyModeEmoji,
  filterSessionsByDeck,
  filterSessionsByMode,
  paginateSessions,
  aggregateLogsToSessions,
  mergeSessionsWithLogs,
} from '../study-history'
import type { StudySession, StudyLog } from '../../types/database'

function makeSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: 'test-id',
    user_id: 'user-1',
    deck_id: 'deck-1',
    study_mode: 'srs',
    cards_studied: 10,
    total_cards: 10,
    total_duration_ms: 60000,
    ratings: { good: 8, easy: 2 },
    started_at: '2026-02-15T10:00:00Z',
    completed_at: '2026-02-15T10:01:00Z',
    ...overrides,
  }
}

// ── formatDuration ──

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(5000)).toBe('common:duration.seconds:5')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('common:duration.minutes:1 common:duration.seconds:30')
  })

  it('formats minutes only when seconds are 0', () => {
    expect(formatDuration(120000)).toBe('common:duration.minutes:2')
  })

  it('formats hours only', () => {
    expect(formatDuration(3600000)).toBe('common:duration.hours:1')
  })

  it('formats hours and minutes (no seconds)', () => {
    expect(formatDuration(3660000)).toBe('common:duration.hours:1 common:duration.minutes:1')
  })

  it('formats hours and minutes, drops seconds', () => {
    expect(formatDuration(3661000)).toBe('common:duration.hours:1 common:duration.minutes:1')
  })

  it('returns 0초 for 0', () => {
    expect(formatDuration(0)).toBe('common:duration.zeroSeconds')
  })

  it('returns 0초 for negative', () => {
    expect(formatDuration(-1000)).toBe('common:duration.zeroSeconds')
  })

  it('handles large durations', () => {
    // 2 hours 30 minutes
    expect(formatDuration(9000000)).toBe('common:duration.hours:2 common:duration.minutes:30')
  })
})

// ── getSessionPerformance ──

describe('getSessionPerformance', () => {
  it('returns 0 for empty ratings', () => {
    expect(getSessionPerformance({})).toBe(0)
  })

  it('returns 100 for all easy', () => {
    expect(getSessionPerformance({ easy: 10 })).toBe(100)
  })

  it('returns 0 for all again', () => {
    expect(getSessionPerformance({ again: 5 })).toBe(0)
  })

  it('calculates weighted average', () => {
    // 5 good (70) + 5 easy (100) = (350 + 500) / 10 = 85
    expect(getSessionPerformance({ good: 5, easy: 5 })).toBe(85)
  })

  it('handles numeric ratings (simple mode)', () => {
    // 3 × "3" (67) + 2 × "5" (100) = (201 + 200) / 5 = 80.2 → 80
    expect(getSessionPerformance({ '3': 3, '5': 2 })).toBe(80)
  })

  it('handles mixed SRS ratings', () => {
    // 2 again (0) + 3 hard (30) + 5 good (70) = (0 + 90 + 350) / 10 = 44
    expect(getSessionPerformance({ again: 2, hard: 3, good: 5 })).toBe(44)
  })

  it('uses 50 as default weight for unknown ratings', () => {
    // 2 × unknown (50) = 100 / 2 = 50
    expect(getSessionPerformance({ unknown: 2 })).toBe(50)
  })
})

// ── groupSessionsByDate ──

describe('groupSessionsByDate', () => {
  it('groups sessions by completion date', () => {
    const sessions = [
      makeSession({ id: '1', completed_at: '2026-02-15T10:00:00Z' }),
      makeSession({ id: '2', completed_at: '2026-02-15T14:00:00Z' }),
      makeSession({ id: '3', completed_at: '2026-02-14T10:00:00Z' }),
    ]
    const groups = groupSessionsByDate(sessions)
    expect(groups).toHaveLength(2)
    expect(groups[0].sessions).toHaveLength(2) // Feb 15
    expect(groups[1].sessions).toHaveLength(1) // Feb 14
  })

  it('sorts newest date first', () => {
    const sessions = [
      makeSession({ id: '1', completed_at: '2026-02-10T10:00:00Z' }),
      makeSession({ id: '2', completed_at: '2026-02-15T10:00:00Z' }),
    ]
    const groups = groupSessionsByDate(sessions)
    expect(groups[0].date).toContain('15')
    expect(groups[1].date).toContain('10')
  })

  it('returns empty array for no sessions', () => {
    expect(groupSessionsByDate([])).toEqual([])
  })
})

// ── getStudyModeLabel ──

describe('getStudyModeLabel', () => {
  it('returns SRS for srs', () => {
    expect(getStudyModeLabel('srs')).toBe('study:mode.srs')
  })

  it('returns 순차 복습 for sequential_review', () => {
    expect(getStudyModeLabel('sequential_review')).toBe('study:mode.sequentialReview')
  })

  it('returns 랜덤 for random', () => {
    expect(getStudyModeLabel('random')).toBe('study:mode.random')
  })

  it('returns 순차 for sequential', () => {
    expect(getStudyModeLabel('sequential')).toBe('study:mode.sequential')
  })

  it('returns 날짜별 for by_date', () => {
    expect(getStudyModeLabel('by_date')).toBe('study:mode.byDate')
  })

  it('returns raw mode for unknown', () => {
    expect(getStudyModeLabel('custom_mode')).toBe('custom_mode')
  })
})

// ── getStudyModeEmoji ──

describe('getStudyModeEmoji', () => {
  it('returns brain emoji for srs', () => {
    expect(getStudyModeEmoji('srs')).toBe('\uD83E\uDDE0')
  })

  it('returns fallback emoji for unknown mode', () => {
    expect(getStudyModeEmoji('unknown')).toBe('\uD83D\uDCDA')
  })
})

// ── filterSessionsByDeck ──

describe('filterSessionsByDeck', () => {
  it('filters sessions by deck_id', () => {
    const sessions = [
      makeSession({ deck_id: 'deck-1' }),
      makeSession({ deck_id: 'deck-2' }),
      makeSession({ deck_id: 'deck-1' }),
    ]
    const filtered = filterSessionsByDeck(sessions, 'deck-1')
    expect(filtered).toHaveLength(2)
  })

  it('returns empty for no matches', () => {
    const sessions = [makeSession({ deck_id: 'deck-1' })]
    expect(filterSessionsByDeck(sessions, 'deck-999')).toHaveLength(0)
  })
})

// ── filterSessionsByMode ──

describe('filterSessionsByMode', () => {
  it('filters sessions by study_mode', () => {
    const sessions = [
      makeSession({ study_mode: 'srs' }),
      makeSession({ study_mode: 'random' }),
      makeSession({ study_mode: 'srs' }),
    ]
    const filtered = filterSessionsByMode(sessions, 'srs')
    expect(filtered).toHaveLength(2)
  })

  it('returns empty for no matches', () => {
    const sessions = [makeSession({ study_mode: 'srs' })]
    expect(filterSessionsByMode(sessions, 'random')).toHaveLength(0)
  })
})

// ── paginateSessions ──

describe('paginateSessions', () => {
  const items = Array.from({ length: 25 }, (_, i) => i)

  it('returns first page correctly', () => {
    const result = paginateSessions(items, 1, 10)
    expect(result.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(result.totalPages).toBe(3)
    expect(result.startIdx).toBe(0)
    expect(result.endIdx).toBe(10)
  })

  it('returns last page with remaining items', () => {
    const result = paginateSessions(items, 3, 10)
    expect(result.items).toEqual([20, 21, 22, 23, 24])
    expect(result.totalPages).toBe(3)
  })

  it('clamps page to valid range', () => {
    const result = paginateSessions(items, 99, 10)
    expect(result.items).toEqual([20, 21, 22, 23, 24])
  })

  it('clamps page 0 to 1', () => {
    const result = paginateSessions(items, 0, 10)
    expect(result.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('returns empty items for empty input', () => {
    const result = paginateSessions([], 1, 10)
    expect(result.items).toEqual([])
    expect(result.totalPages).toBe(1)
  })

  it('handles pageSize larger than items', () => {
    const result = paginateSessions([1, 2, 3], 1, 10)
    expect(result.items).toEqual([1, 2, 3])
    expect(result.totalPages).toBe(1)
  })
})

// ── aggregateLogsToSessions ──

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
    review_duration_ms: 3000,
    studied_at: '2026-02-15T10:00:00Z',
    ...overrides,
  }
}

describe('aggregateLogsToSessions', () => {
  it('groups logs by deck, mode, and date into sessions', () => {
    const logs = [
      makeLog({ id: '1', deck_id: 'deck-1', study_mode: 'srs', studied_at: '2026-02-15T10:00:00Z' }),
      makeLog({ id: '2', deck_id: 'deck-1', study_mode: 'srs', studied_at: '2026-02-15T11:00:00Z' }),
      makeLog({ id: '3', deck_id: 'deck-1', study_mode: 'random', studied_at: '2026-02-15T10:00:00Z' }),
      makeLog({ id: '4', deck_id: 'deck-2', study_mode: 'srs', studied_at: '2026-02-15T10:00:00Z' }),
    ]
    const sessions = aggregateLogsToSessions(logs)
    expect(sessions).toHaveLength(3) // 3 unique (deck, mode, date) combos
  })

  it('counts cards and aggregates ratings', () => {
    const logs = [
      makeLog({ id: '1', rating: 'good', review_duration_ms: 2000 }),
      makeLog({ id: '2', rating: 'good', review_duration_ms: 3000 }),
      makeLog({ id: '3', rating: 'easy', review_duration_ms: 1000 }),
    ]
    const sessions = aggregateLogsToSessions(logs)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].cards_studied).toBe(3)
    expect(sessions[0].total_duration_ms).toBe(6000)
    expect(sessions[0].ratings).toEqual({ good: 2, easy: 1 })
  })

  it('uses min/max timestamps for started_at/completed_at', () => {
    const logs = [
      makeLog({ id: '1', studied_at: '2026-02-15T10:00:00Z' }),
      makeLog({ id: '2', studied_at: '2026-02-15T10:30:00Z' }),
      makeLog({ id: '3', studied_at: '2026-02-15T10:15:00Z' }),
    ]
    const sessions = aggregateLogsToSessions(logs)
    expect(sessions[0].started_at).toBe('2026-02-15T10:00:00.000Z')
    expect(sessions[0].completed_at).toBe('2026-02-15T10:30:00.000Z')
  })

  it('separates logs from different dates', () => {
    const logs = [
      makeLog({ id: '1', studied_at: '2026-02-15T10:00:00Z' }),
      makeLog({ id: '2', studied_at: '2026-02-16T10:00:00Z' }),
    ]
    const sessions = aggregateLogsToSessions(logs)
    expect(sessions).toHaveLength(2)
  })

  it('returns empty for no logs', () => {
    expect(aggregateLogsToSessions([])).toEqual([])
  })

  it('sorts sessions by completed_at descending', () => {
    const logs = [
      makeLog({ id: '1', studied_at: '2026-02-10T10:00:00Z' }),
      makeLog({ id: '2', studied_at: '2026-02-15T10:00:00Z' }),
    ]
    const sessions = aggregateLogsToSessions(logs)
    expect(new Date(sessions[0].completed_at).getTime())
      .toBeGreaterThan(new Date(sessions[1].completed_at).getTime())
  })

  it('handles null review_duration_ms', () => {
    const logs = [
      makeLog({ id: '1', review_duration_ms: null }),
      makeLog({ id: '2', review_duration_ms: 5000 }),
    ]
    const sessions = aggregateLogsToSessions(logs)
    expect(sessions[0].total_duration_ms).toBe(5000)
  })
})

// ── mergeSessionsWithLogs ──

describe('mergeSessionsWithLogs', () => {
  it('prefers real sessions over log sessions for same deck/mode/date', () => {
    const real = [
      makeSession({ id: 'real-1', deck_id: 'deck-1', study_mode: 'srs', completed_at: '2026-02-15T12:00:00Z', cards_studied: 20 }),
    ]
    const fromLogs = [
      makeSession({ id: 'log-deck-1|srs|2026-02-15', deck_id: 'deck-1', study_mode: 'srs', completed_at: '2026-02-15T10:00:00Z', cards_studied: 5 }),
    ]
    const merged = mergeSessionsWithLogs(real, fromLogs)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('real-1')
    expect(merged[0].cards_studied).toBe(20)
  })

  it('includes log sessions when no real session exists for that date', () => {
    const real = [
      makeSession({ id: 'real-1', completed_at: '2026-02-15T12:00:00Z' }),
    ]
    const fromLogs = [
      makeSession({ id: 'log-1', deck_id: 'deck-1', study_mode: 'srs', completed_at: '2026-02-14T10:00:00Z' }),
    ]
    const merged = mergeSessionsWithLogs(real, fromLogs)
    expect(merged).toHaveLength(2)
  })

  it('sorts merged result by completed_at descending', () => {
    const real = [
      makeSession({ id: 'real-1', completed_at: '2026-02-10T12:00:00Z' }),
    ]
    const fromLogs = [
      makeSession({ id: 'log-1', deck_id: 'deck-2', completed_at: '2026-02-15T10:00:00Z' }),
    ]
    const merged = mergeSessionsWithLogs(real, fromLogs)
    expect(merged[0].id).toBe('log-1') // Feb 15 first
    expect(merged[1].id).toBe('real-1') // Feb 10 second
  })

  it('handles empty real sessions (all from logs)', () => {
    const fromLogs = [
      makeSession({ id: 'log-1', completed_at: '2026-02-15T10:00:00Z' }),
      makeSession({ id: 'log-2', completed_at: '2026-02-14T10:00:00Z' }),
    ]
    const merged = mergeSessionsWithLogs([], fromLogs)
    expect(merged).toHaveLength(2)
  })

  it('handles empty log sessions', () => {
    const real = [makeSession({ id: 'real-1' })]
    const merged = mergeSessionsWithLogs(real, [])
    expect(merged).toHaveLength(1)
  })
})
