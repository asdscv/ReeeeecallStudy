import { supabase } from './supabase'
import { utcToLocalDateKey, dateToLocalKey, parseUTC } from './date-utils'
import type { StudyLog } from '../types/database'

// ─── Pure Functions (testable without Supabase) ──────────────────────

/**
 * Forecast: count reviews per day for the next N days.
 * Cards with null next_review_at are ignored.
 */
export function getForecastReviews(
  cards: { next_review_at: string | null }[],
  days = 7,
): { date: string; count: number }[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Build date buckets
  const buckets: { date: string; count: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    buckets.push({ date: dateToLocalKey(d), count: 0 })
  }

  // Count cards per bucket (overdue cards go into today's bucket)
  const todayKey = buckets[0].date
  for (const card of cards) {
    if (!card.next_review_at) continue
    const key = utcToLocalDateKey(card.next_review_at)
    const bucket = buckets.find((b) => b.date === key)
    if (bucket) {
      bucket.count++
    } else if (key < todayKey) {
      // Overdue card — count as due today
      buckets[0].count++
    }
  }

  return buckets
}

/**
 * Heatmap: aggregate study logs into { date, count } entries.
 * Only dates with activity are included.
 */
export function getHeatmapData(
  logs: { studied_at: string }[],
): { date: string; count: number }[] {
  if (logs.length === 0) return []

  const map = new Map<string, number>()
  for (const log of logs) {
    const key = utcToLocalDateKey(log.studied_at)
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  return Array.from(map.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Daily study counts: returns one entry per day for the last N days.
 * Missing days are filled with 0.
 */
export function getDailyStudyCounts(
  logs: { studied_at: string }[],
  days = 30,
): { date: string; count: number }[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Count logs by date
  const map = new Map<string, number>()
  for (const log of logs) {
    const key = utcToLocalDateKey(log.studied_at)
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  // Build entries from (today - days + 1) to today
  const result: { date: string; count: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = dateToLocalKey(d)
    result.push({ date: key, count: map.get(key) ?? 0 })
  }

  return result
}

/**
 * Streak: count consecutive days of study up to today.
 * Returns 0 if no study today.
 */
export function getStreakDays(logs: { studied_at: string }[]): number {
  if (logs.length === 0) return 0

  // Collect unique study dates
  const dates = new Set<string>()
  for (const log of logs) {
    dates.add(utcToLocalDateKey(log.studied_at))
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Check today first
  if (!dates.has(dateToLocalKey(today))) return 0

  let streak = 0
  const d = new Date(today)
  while (dates.has(dateToLocalKey(d))) {
    streak++
    d.setDate(d.getDate() - 1)
  }

  return streak
}

/**
 * Mastery rate: percentage of cards that are "mature"
 * (srs_status === 'review' && interval_days >= 21)
 */
export function getMasteryRate(
  cards: { srs_status: string; interval_days: number }[],
): number {
  if (cards.length === 0) return 0
  const mature = cards.filter(
    (c) => c.srs_status === 'review' && c.interval_days >= 21,
  ).length
  return Math.round((mature / cards.length) * 100)
}

/**
 * Group cards by creation date, sorted descending (newest first).
 */
export function groupCardsByDate(
  cards: { created_at: string }[],
): { date: string; count: number }[] {
  if (cards.length === 0) return []

  const map = new Map<string, number>()
  for (const card of cards) {
    const key = utcToLocalDateKey(card.created_at)
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  return Array.from(map.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Calculate comprehensive statistics for a deck's cards.
 */
export function calculateDeckStats(
  cards: {
    srs_status: string
    ease_factor: number
    interval_days: number
    repetitions: number
  }[],
): {
  totalCards: number
  newCount: number
  learningCount: number
  reviewCount: number
  avgEase: number
  avgInterval: number
  masteryRate: number
} {
  const total = cards.length
  if (total === 0) {
    return {
      totalCards: 0,
      newCount: 0,
      learningCount: 0,
      reviewCount: 0,
      avgEase: 0,
      avgInterval: 0,
      masteryRate: 0,
    }
  }

  const newCount = cards.filter((c) => c.srs_status === 'new').length
  const learningCount = cards.filter((c) => c.srs_status === 'learning').length
  const reviewCount = cards.filter((c) => c.srs_status === 'review').length
  // Only include cards that have been studied (learning/review) in averages
  const studiedCards = cards.filter((c) => c.srs_status !== 'new')
  const studiedCount = studiedCards.length
  const avgEase = studiedCount > 0
    ? studiedCards.reduce((s, c) => s + c.ease_factor, 0) / studiedCount
    : 0
  const avgInterval = studiedCount > 0
    ? studiedCards.reduce((s, c) => s + c.interval_days, 0) / studiedCount
    : 0
  const masteryRate = getMasteryRate(cards)

  return {
    totalCards: total,
    newCount,
    learningCount,
    reviewCount,
    avgEase: Math.round(avgEase * 100) / 100,
    avgInterval: Math.round(avgInterval * 100) / 100,
    masteryRate,
  }
}

/**
 * Filter study logs to only include entries within the last N days.
 */
export function filterLogsByPeriod(
  logs: { studied_at: string }[],
  days: number,
): { studied_at: string }[] {
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days + 1)

  return logs.filter((log) => {
    const d = parseUTC(log.studied_at)
    return d >= cutoff
  })
}

// ─── Supabase Query Functions ────────────────────────────────────────

/**
 * Fetch study logs for a user within a date range.
 */
export async function fetchStudyLogs(
  userId: string,
  fromDate?: string,
): Promise<StudyLog[]> {
  let query = supabase
    .from('study_logs')
    .select('*')
    .eq('user_id', userId)
    .order('studied_at', { ascending: false })

  if (fromDate) {
    query = query.gte('studied_at', fromDate)
  }

  const { data, error } = await query
  if (error) {
    console.error('fetchStudyLogs error:', error)
    return []
  }
  return (data ?? []) as StudyLog[]
}

/**
 * Fetch study logs for a specific deck.
 */
export async function fetchDeckStudyLogs(
  deckId: string,
  fromDate?: string,
): Promise<StudyLog[]> {
  let query = supabase
    .from('study_logs')
    .select('*')
    .eq('deck_id', deckId)
    .order('studied_at', { ascending: false })

  if (fromDate) {
    query = query.gte('studied_at', fromDate)
  }

  const { data, error } = await query
  if (error) {
    console.error('fetchDeckStudyLogs error:', error)
    return []
  }
  return (data ?? []) as StudyLog[]
}
