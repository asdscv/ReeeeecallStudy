import { getSessionPerformance } from './study-history'
import { dateToLocalKey } from './date-utils'
import type { StudySession, StudyLog } from '../types/database'

// ── 기간 필터링 ──

export function filterSessionsByPeriod(sessions: StudySession[], days: number): StudySession[] {
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days + 1)

  return sessions.filter((s) => new Date(s.completed_at) >= cutoff)
}

// ── 요약 통계 ──

export interface OverviewStats {
  totalSessions: number
  totalCardsStudied: number
  totalTimeMs: number
  avgPerformance: number
  avgSpeedMs: number
}

export function computeOverviewStats(sessions: StudySession[]): OverviewStats {
  if (sessions.length === 0) {
    return { totalSessions: 0, totalCardsStudied: 0, totalTimeMs: 0, avgPerformance: 0, avgSpeedMs: 0 }
  }

  const totalSessions = sessions.length
  const totalCardsStudied = sessions.reduce((s, sess) => s + sess.cards_studied, 0)
  const totalTimeMs = sessions.reduce((s, sess) => s + sess.total_duration_ms, 0)

  const perfSum = sessions.reduce((s, sess) => s + getSessionPerformance(sess.ratings), 0)
  const avgPerformance = Math.round(perfSum / totalSessions)
  const avgSpeedMs = totalCardsStudied > 0 ? Math.round(totalTimeMs / totalCardsStudied) : 0

  return { totalSessions, totalCardsStudied, totalTimeMs, avgPerformance, avgSpeedMs }
}

// ── 모드별 분석 ──

export interface ModeBreakdown {
  mode: string
  sessionCount: number
  totalCards: number
  totalTimeMs: number
  avgPerformance: number
}

export function computeModeBreakdown(sessions: StudySession[]): ModeBreakdown[] {
  if (sessions.length === 0) return []

  const groups = new Map<string, StudySession[]>()
  for (const s of sessions) {
    const arr = groups.get(s.study_mode) ?? []
    arr.push(s)
    groups.set(s.study_mode, arr)
  }

  return Array.from(groups.entries()).map(([mode, modeSessions]) => {
    const sessionCount = modeSessions.length
    const totalCards = modeSessions.reduce((s, sess) => s + sess.cards_studied, 0)
    const totalTimeMs = modeSessions.reduce((s, sess) => s + sess.total_duration_ms, 0)
    const perfSum = modeSessions.reduce((s, sess) => s + getSessionPerformance(sess.ratings), 0)
    const avgPerformance = Math.round(perfSum / sessionCount)
    return { mode, sessionCount, totalCards, totalTimeMs, avgPerformance }
  })
}

// ── 일별 세션/카드 수 ──

export interface DailySessionCount {
  date: string
  sessions: number
  cards: number
}

export function computeDailySessionCounts(sessions: StudySession[], days: number): DailySessionCount[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Build date buckets
  const buckets: DailySessionCount[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    buckets.push({ date: dateToLocalKey(d), sessions: 0, cards: 0 })
  }

  // Count sessions per date
  const bucketMap = new Map(buckets.map((b) => [b.date, b]))
  for (const s of sessions) {
    const key = dateToLocalKey(new Date(s.completed_at))
    const bucket = bucketMap.get(key)
    if (bucket) {
      bucket.sessions++
      bucket.cards += s.cards_studied
    }
  }

  return buckets
}

// ── 평가 분포 ──

export interface RatingDistribution {
  rating: string
  count: number
  percentage: number
}

const RATING_ORDER = ['again', 'hard', 'good', 'easy']

export function computeRatingDistribution(sessions: StudySession[]): RatingDistribution[] {
  if (sessions.length === 0) return []

  const counts = new Map<string, number>()
  for (const s of sessions) {
    for (const [rating, count] of Object.entries(s.ratings)) {
      counts.set(rating, (counts.get(rating) ?? 0) + count)
    }
  }

  const total = Array.from(counts.values()).reduce((s, c) => s + c, 0)
  if (total === 0) return []

  // Sort by canonical order, unknown ratings at end
  return Array.from(counts.entries())
    .sort((a, b) => {
      const ai = RATING_ORDER.indexOf(a[0])
      const bi = RATING_ORDER.indexOf(b[0])
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
    .map(([rating, count]) => ({
      rating,
      count,
      percentage: Math.round((count / total) * 100),
    }))
}

// ── 세션 소요시간 트렌드 ──

export interface SessionDurationPoint {
  date: string
  avgDurationMs: number
  sessionCount: number
}

export function computeSessionDurationTrend(sessions: StudySession[], days: number): SessionDurationPoint[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const buckets: SessionDurationPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    buckets.push({ date: dateToLocalKey(d), avgDurationMs: 0, sessionCount: 0 })
  }

  // Group sessions by date
  const dateGroups = new Map<string, number[]>()
  for (const s of sessions) {
    const key = dateToLocalKey(new Date(s.completed_at))
    const arr = dateGroups.get(key) ?? []
    arr.push(s.total_duration_ms)
    dateGroups.set(key, arr)
  }

  for (const bucket of buckets) {
    const durations = dateGroups.get(bucket.date)
    if (durations && durations.length > 0) {
      bucket.sessionCount = durations.length
      bucket.avgDurationMs = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    }
  }

  return buckets
}

// ── 모드별 학습 시간 ──

export interface StudyTimeByMode {
  mode: string
  totalTimeMs: number
  percentage: number
}

export function computeStudyTimeByMode(sessions: StudySession[]): StudyTimeByMode[] {
  if (sessions.length === 0) return []

  const modeTime = new Map<string, number>()
  for (const s of sessions) {
    modeTime.set(s.study_mode, (modeTime.get(s.study_mode) ?? 0) + s.total_duration_ms)
  }

  const totalTime = Array.from(modeTime.values()).reduce((s, t) => s + t, 0)
  if (totalTime === 0) return []

  return Array.from(modeTime.entries()).map(([mode, totalTimeMs]) => ({
    mode,
    totalTimeMs,
    percentage: Math.round((totalTimeMs / totalTime) * 100),
  }))
}

// ── 성과 트렌드 ──

export interface PerformanceTrendPoint {
  date: string
  avgPerformance: number
  sessionCount: number
}

export function computePerformanceTrend(sessions: StudySession[], days: number): PerformanceTrendPoint[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const buckets: PerformanceTrendPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    buckets.push({ date: dateToLocalKey(d), avgPerformance: 0, sessionCount: 0 })
  }

  // Group performances by date
  const dateGroups = new Map<string, number[]>()
  for (const s of sessions) {
    const key = dateToLocalKey(new Date(s.completed_at))
    const arr = dateGroups.get(key) ?? []
    arr.push(getSessionPerformance(s.ratings))
    dateGroups.set(key, arr)
  }

  for (const bucket of buckets) {
    const perfs = dateGroups.get(bucket.date)
    if (perfs && perfs.length > 0) {
      bucket.sessionCount = perfs.length
      bucket.avgPerformance = Math.round(perfs.reduce((s, p) => s + p, 0) / perfs.length)
    }
  }

  return buckets
}

// ── SRS 전용 통계 ──

export interface SrsStats {
  totalReviews: number
  retentionRate: number
  avgIntervalGrowth: number
  avgNewEase: number
  easeDistribution: { bucket: string; count: number }[]
}

export function computeSrsStats(logs: StudyLog[]): SrsStats {
  const srsLogs = logs.filter((l) => l.study_mode === 'srs')

  if (srsLogs.length === 0) {
    return { totalReviews: 0, retentionRate: 0, avgIntervalGrowth: 0, avgNewEase: 0, easeDistribution: [] }
  }

  const totalReviews = srsLogs.length
  const nonAgain = srsLogs.filter((l) => l.rating !== 'again').length
  const retentionRate = Math.round((nonAgain / totalReviews) * 100)

  // Interval growth
  const growthLogs = srsLogs.filter((l) => l.prev_interval != null && l.new_interval != null)
  const avgIntervalGrowth = growthLogs.length > 0
    ? Math.round(growthLogs.reduce((s, l) => s + (l.new_interval! - l.prev_interval!), 0) / growthLogs.length)
    : 0

  // Average new ease
  const easeLogs = srsLogs.filter((l) => l.new_ease != null)
  const avgNewEase = easeLogs.length > 0
    ? Math.round((easeLogs.reduce((s, l) => s + l.new_ease!, 0) / easeLogs.length) * 100) / 100
    : 0

  // Ease distribution buckets
  const easeBuckets = new Map<string, number>()
  for (const l of easeLogs) {
    const ease = l.new_ease!
    let bucket: string
    if (ease < 1.5) bucket = '~1.5'
    else if (ease < 2.0) bucket = '1.5~2.0'
    else if (ease < 2.5) bucket = '2.0~2.5'
    else if (ease < 3.0) bucket = '2.5~3.0'
    else bucket = '3.0~'
    easeBuckets.set(bucket, (easeBuckets.get(bucket) ?? 0) + 1)
  }

  const bucketOrder = ['~1.5', '1.5~2.0', '2.0~2.5', '2.5~3.0', '3.0~']
  const easeDistribution = bucketOrder
    .filter((b) => easeBuckets.has(b))
    .map((bucket) => ({ bucket, count: easeBuckets.get(bucket)! }))

  return { totalReviews, retentionRate, avgIntervalGrowth, avgNewEase, easeDistribution }
}
