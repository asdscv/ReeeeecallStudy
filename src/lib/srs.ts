import i18next from 'i18next'
import type { SrsSettings } from '../types/database'
import { DEFAULT_SRS_SETTINGS } from '../types/database'

export type SrsRating = 'again' | 'hard' | 'good' | 'easy'

export interface SrsCardData {
  srs_status: 'new' | 'learning' | 'review' | 'suspended'
  ease_factor: number
  interval_days: number
  repetitions: number
}

export interface SrsResult {
  ease_factor: number
  interval_days: number
  repetitions: number
  srs_status: 'new' | 'learning' | 'review'
  next_review_at: string
}

// ── Helpers ─────────────────────────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Schedule review at the start of a future "SRS day".
 * dayStartHour=4 means the SRS day boundary is 4:00 AM local time.
 * For interval >= 1 day, cards are scheduled to the next day boundary
 * so that studying at 10 PM means cards appear the next morning, not 24h later.
 */
export function nextDayBoundary(now: Date, days: number, dayStartHour: number = 4): Date {
  // Shift "now" back by dayStartHour to find which SRS-day we're in
  const shifted = new Date(now.getTime() - dayStartHour * 3600_000)
  // Start of the current SRS-day (midnight of the shifted date)
  const base = new Date(shifted)
  base.setHours(0, 0, 0, 0)
  // Add 'days' SRS-days, then shift forward to the real clock
  base.setDate(base.getDate() + days)
  // The target time is dayStartHour on that calendar date
  return new Date(base.getTime() + dayStartHour * 3600_000)
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

// ── Learning Steps ──────────────────────────────────────

/** Get effective learning steps, with fallback for backward compat */
function getSteps(settings: SrsSettings): number[] {
  const steps = settings.learning_steps
  if (!steps || steps.length === 0) return []
  return steps
}

// ── Core SRS Calculation ────────────────────────────────

export function calculateSRS(card: SrsCardData, rating: SrsRating, settings?: SrsSettings): SrsResult {
  const s = settings ?? DEFAULT_SRS_SETTINGS
  const now = new Date()
  const steps = getSteps(s)

  // ── Learning Phase (new or learning cards with steps) ──
  if ((card.srs_status === 'new' || card.srs_status === 'learning') && steps.length > 0) {
    return calculateLearning(card, rating, s, steps, now)
  }

  // ── Review Phase (or learning/new with no steps) ──
  return calculateReview(card, rating, s, now)
}

function calculateLearning(
  card: SrsCardData, rating: SrsRating, s: SrsSettings, steps: number[], now: Date,
): SrsResult {
  // For learning cards, repetitions tracks the current step index
  const currentStep = card.srs_status === 'new' ? 0 : Math.min(card.repetitions, steps.length - 1)
  let ease = card.ease_factor

  switch (rating) {
    case 'again': {
      // Reset to step 0
      ease = Math.max(1.3, ease - 0.20)
      const stepMinutes = steps[0]
      return {
        ease_factor: round(ease),
        interval_days: 0,
        repetitions: 0,
        srs_status: 'learning',
        next_review_at: addMinutes(now, stepMinutes).toISOString(),
      }
    }

    case 'hard': {
      // Repeat current step
      ease = Math.max(1.3, ease - 0.15)
      const stepMinutes = steps[currentStep]
      return {
        ease_factor: round(ease),
        interval_days: 0,
        repetitions: currentStep,
        srs_status: 'learning',
        next_review_at: addMinutes(now, stepMinutes).toISOString(),
      }
    }

    case 'good': {
      const nextStep = card.srs_status === 'new' ? 1 : currentStep + 1
      if (nextStep >= steps.length) {
        // Graduate to review
        const interval = s.good_days
        return {
          ease_factor: round(ease),
          interval_days: interval,
          repetitions: 1,
          srs_status: 'review',
          next_review_at: nextDayBoundary(now, interval).toISOString(),
        }
      }
      // Move to next step
      const stepMinutes = steps[nextStep]
      return {
        ease_factor: round(ease),
        interval_days: 0,
        repetitions: nextStep,
        srs_status: 'learning',
        next_review_at: addMinutes(now, stepMinutes).toISOString(),
      }
    }

    case 'easy': {
      // Skip all steps, graduate immediately
      ease = Math.min(4.0, ease + 0.15)
      const interval = s.easy_days
      return {
        ease_factor: round(ease),
        interval_days: interval,
        repetitions: 1,
        srs_status: 'review',
        next_review_at: nextDayBoundary(now, interval).toISOString(),
      }
    }
  }
}

function calculateReview(
  card: SrsCardData, rating: SrsRating, s: SrsSettings, now: Date,
): SrsResult {
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
          next_review_at: addMinutes(now, 10).toISOString(),
        }
      }
      return {
        ease_factor: round(ease),
        interval_days: s.again_days,
        repetitions: 0,
        srs_status: 'learning',
        next_review_at: nextDayBoundary(now, s.again_days).toISOString(),
      }

    case 'hard':
      ease = Math.max(1.3, ease - 0.15)
      reps += 1
      if (card.repetitions === 0) {
        interval = s.hard_days
      } else {
        interval = Math.max(card.interval_days + 1, Math.round(card.interval_days * 1.2))
      }
      return {
        ease_factor: round(ease),
        interval_days: interval,
        repetitions: reps,
        srs_status: card.srs_status === 'review' ? 'review' : 'learning',
        next_review_at: nextDayBoundary(now, interval).toISOString(),
      }

    case 'good': {
      reps += 1
      if (card.repetitions === 0) {
        interval = s.good_days
      } else if (card.repetitions === 1) {
        interval = Math.max(s.good_days, 3)
      } else {
        const hardIvl = Math.max(card.interval_days + 1, Math.round(card.interval_days * 1.2))
        interval = Math.max(hardIvl + 1, Math.round(card.interval_days * ease))
      }
      return {
        ease_factor: round(ease),
        interval_days: interval,
        repetitions: reps,
        srs_status: 'review',
        next_review_at: nextDayBoundary(now, interval).toISOString(),
      }
    }

    case 'easy': {
      ease = Math.min(4.0, ease + 0.15)
      reps += 1
      if (card.repetitions === 0) {
        interval = s.easy_days
      } else {
        const hardIvl = Math.max(card.interval_days + 1, Math.round(card.interval_days * 1.2))
        const goodIvl = Math.max(hardIvl + 1, Math.round(card.interval_days * card.ease_factor))
        interval = Math.max(goodIvl + 1, Math.round(card.interval_days * ease * 1.3))
      }
      return {
        ease_factor: round(ease),
        interval_days: interval,
        repetitions: reps,
        srs_status: 'review',
        next_review_at: nextDayBoundary(now, interval).toISOString(),
      }
    }
  }
}

// ── Preview & Formatting ────────────────────────────────

export function previewIntervals(card: SrsCardData, settings?: SrsSettings): Record<SrsRating, string> {
  const s = settings ?? DEFAULT_SRS_SETTINGS
  const steps = getSteps(s)
  const ratings: SrsRating[] = ['again', 'hard', 'good', 'easy']
  const result = {} as Record<SrsRating, string>

  for (const rating of ratings) {
    const srs = calculateSRS(card, rating, s)
    if (srs.srs_status === 'learning' && srs.interval_days === 0 && steps.length > 0) {
      // Learning step: show minutes
      const stepIndex = srs.repetitions
      const minutes = steps[stepIndex] ?? steps[steps.length - 1] ?? 10
      result[rating] = formatMinutes(minutes)
    } else {
      result[rating] = formatInterval(srs.interval_days)
    }
  }
  return result
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return i18next.t('study:interval.minutes', { count: minutes })
  }
  const hours = Math.round(minutes / 60)
  return i18next.t('study:interval.hours', { count: hours })
}

function formatInterval(days: number): string {
  if (days === 0) return i18next.t('study:interval.lessThanTenMin')
  if (days === 1) return i18next.t('study:interval.oneDay')
  if (days < 30) return i18next.t('study:interval.days', { count: days })
  if (days < 365) return i18next.t('study:interval.months', { count: Math.round(days / 30) })
  return i18next.t('study:interval.years', { count: parseFloat((days / 365).toFixed(1)) })
}
