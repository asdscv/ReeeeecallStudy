import type { Card, SrsSettings } from '../types/database'
import { DEFAULT_SRS_SETTINGS } from '../types/database'

export type SrsRating = 'again' | 'hard' | 'good' | 'easy'

export interface SrsResult {
  ease_factor: number
  interval_days: number
  repetitions: number
  srs_status: 'new' | 'learning' | 'review'
  next_review_at: string
}

export function calculateSRS(card: Card, rating: SrsRating, settings?: SrsSettings): SrsResult {
  const s = settings ?? DEFAULT_SRS_SETTINGS
  const now = new Date()
  let ease = card.ease_factor
  let interval = card.interval_days
  let reps = card.repetitions

  switch (rating) {
    case 'again':
      ease = Math.max(1.3, ease - 0.20)
      reps = 0
      if (s.again_days === 0) {
        return {
          ease_factor: round(ease),
          interval_days: 0,
          repetitions: 0,
          srs_status: 'learning',
          next_review_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        }
      }
      return {
        ease_factor: round(ease),
        interval_days: s.again_days,
        repetitions: 0,
        srs_status: 'learning',
        next_review_at: addDays(now, s.again_days).toISOString(),
      }

    case 'hard':
      ease = Math.max(1.3, ease - 0.15)
      reps += 1
      if (card.repetitions === 0) {
        interval = s.hard_days
      } else {
        interval = Math.max(1, Math.round(interval * 1.2))
      }
      return {
        ease_factor: round(ease),
        interval_days: interval,
        repetitions: reps,
        srs_status: card.srs_status === 'learning' ? 'learning' : 'review',
        next_review_at: addDays(now, interval).toISOString(),
      }

    case 'good':
      reps += 1
      if (card.repetitions === 0) {
        interval = s.good_days
      } else if (card.repetitions === 1) {
        interval = Math.max(s.good_days, 3)
      } else {
        interval = Math.round(interval * ease)
      }
      return {
        ease_factor: round(ease),
        interval_days: interval,
        repetitions: reps,
        srs_status: 'review',
        next_review_at: addDays(now, interval).toISOString(),
      }

    case 'easy':
      ease = Math.min(4.0, ease + 0.15)
      reps += 1
      if (card.repetitions === 0) {
        interval = s.easy_days
      } else {
        interval = Math.round(interval * ease * 1.3)
      }
      return {
        ease_factor: round(ease),
        interval_days: interval,
        repetitions: reps,
        srs_status: 'review',
        next_review_at: addDays(now, interval).toISOString(),
      }
  }
}

export function previewIntervals(card: Card, settings?: SrsSettings): Record<SrsRating, string> {
  const ratings: SrsRating[] = ['again', 'hard', 'good', 'easy']
  const result = {} as Record<SrsRating, string>
  for (const rating of ratings) {
    const srs = calculateSRS(card, rating, settings)
    result[rating] = formatInterval(srs.interval_days)
  }
  return result
}

function formatInterval(days: number): string {
  if (days === 0) return '10분'
  if (days === 1) return '1일'
  if (days < 30) return `${days}일`
  if (days < 365) return `${Math.round(days / 30)}개월`
  return `${(days / 365).toFixed(1)}년`
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
