/**
 * How the studying actually went — the day's attempts, read as a session rather than a list.
 *
 * ## What this replaced
 *
 * Both plan screens ended in "최근 시도": one row per attempt, each showing the card's prompt, a
 * rating word and a timestamp. It was the same failure as the per-card plan list above it —
 * a column of words that says nothing about how the session went, in the one place a learner
 * has actually finished something and might want to know.
 *
 * A learner asking "how did I do?" wants how much, how long, and how it went. Those are three
 * numbers, not twenty rows. The rows that remain are the ones with something to DO on them:
 * the cards that were missed, where paid remediation is offered.
 *
 * ## Why scored bands and not raw scores
 *
 * `normalized_score` is continuous, and the study screen's four SRS ratings collapse into it
 * (again → 0, hard → 0.5, good/easy → 1). The thresholds here are the same ones the row labels
 * already used, kept in one place so the summary and the per-row word can never disagree about
 * what "알았음" means.
 */
import { utcToLocalDateKey } from './date-utils'

export interface StudyRecapAttempt {
  normalized_score: number | null
  duration_ms: number
  created_at: string
}

export interface StudyRecap {
  /** Attempts counted — after the day filter, if one was given. */
  count: number
  totalMs: number
  /** Mean milliseconds per attempt, rounded. 0 when nothing was counted. */
  avgMs: number
  known: number
  partial: number
  missed: number
  /** Attempts with no score at all: recorded, but never judged. */
  unscored: number
}

/** The band a score falls in, or null when there is no score. Shared by the recap and the rows. */
export function scoreBand(score: number | null): 'known' | 'partial' | 'missed' | null {
  if (score === null || Number.isNaN(score)) return null
  if (score >= 0.75) return 'known'
  if (score >= 0.25) return 'partial'
  return 'missed'
}

/**
 * Summarise attempts, optionally narrowed to one local day.
 *
 * `dateKey` is compared against each attempt's LOCAL date, not UTC: a learner studying at 1am in
 * Seoul is on today's plan, and a UTC comparison would file their session under yesterday. Pass
 * it as the plan's own date so the recap covers exactly the day the screen is showing.
 */
export function studyRecap(
  attempts: readonly StudyRecapAttempt[],
  dateKey?: string,
): StudyRecap {
  const recap: StudyRecap = {
    count: 0, totalMs: 0, avgMs: 0, known: 0, partial: 0, missed: 0, unscored: 0,
  }
  for (const attempt of attempts) {
    if (dateKey !== undefined && utcToLocalDateKey(attempt.created_at) !== dateKey) continue
    recap.count += 1
    // Guarded rather than trusted: `duration_ms` is client-reported, and one absurd row would
    // otherwise put "카드당 평균 3시간" under a perfectly normal session.
    if (Number.isFinite(attempt.duration_ms) && attempt.duration_ms > 0) {
      recap.totalMs += attempt.duration_ms
    }
    const band = scoreBand(attempt.normalized_score)
    if (band === null) recap.unscored += 1
    else recap[band] += 1
  }
  recap.avgMs = recap.count > 0 ? Math.round(recap.totalMs / recap.count) : 0
  return recap
}
