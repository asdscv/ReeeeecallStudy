// ─── Learning diagnostics ────────────────────────────────────────────────────
//
// Turns the engine's own records — `answer_attempts` and `daily_plans` — into the few
// numbers a learner can act on. Pure, so every rule below is testable without a database.
//
// Scope note, deliberate: this reads LEARNING-ENGINE data only. The existing analytics tab
// on /history already summarises the legacy SRS side (study_logs, study_sessions), and
// duplicating it here with slightly different arithmetic would give the user two truths
// about the same question.
//
// It also does NOT produce `study_recommendations` rows. That table has no writer anywhere
// in the repo — no RPC, no code — so a feed rendered from it would be permanently empty,
// and inventing a producer is a design decision about WHO recommends (a deterministic
// client algorithm or the AI path), not a rendering detail.

/** The subset of an attempt row the aggregation needs. */
export interface InsightAttempt {
  readonly card_id: string | null
  readonly normalized_score: number | null
  readonly duration_ms: number
  readonly created_at: string
}

/** The subset of a daily plan row the aggregation needs. */
export interface InsightPlan {
  readonly plan_date: string
  readonly total_items: number
  readonly completed_items: number
}

export interface WeakCard {
  readonly cardId: string
  readonly attempts: number
  /** Mean normalized score across that card's SCORED attempts, 0..1. */
  readonly meanScore: number
}

export interface DayAdherence {
  readonly planDate: string
  readonly totalItems: number
  readonly completedItems: number
  /** 0..1, or null when the plan had no items (division by zero is not 0% done). */
  readonly ratio: number | null
}

export interface LearningInsights {
  readonly attemptCount: number
  /** Attempts that carried a score. The rest cannot count toward accuracy. */
  readonly scoredCount: number
  /** Share of scored attempts at or above KNOWN_THRESHOLD, or null with no scored data. */
  readonly accuracy: number | null
  /** Median, not mean: one 20-minute interruption should not redefine a typical answer. */
  readonly medianDurationMs: number | null
  readonly weakCards: readonly WeakCard[]
  readonly adherence: readonly DayAdherence[]
  /** Completed items ÷ planned items across the window, or null when nothing was planned. */
  readonly overallAdherence: number | null
}

/** A self-rating at or above this counts as "knew it" (the UI's third choice is 1). */
export const KNOWN_THRESHOLD = 0.75

/** A card needs at least this many scored attempts before it can be called weak. */
export const WEAK_MIN_ATTEMPTS = 2

/** Below this mean score a card is worth resurfacing. */
export const WEAK_MAX_MEAN_SCORE = 0.6

const WEAK_LIMIT = 10

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const isScored = (a: InsightAttempt): boolean =>
  typeof a.normalized_score === 'number' && Number.isFinite(a.normalized_score)

/**
 * Aggregate attempts + plans into the diagnostics the page renders.
 *
 * Every "no data" case returns null rather than 0. Zero is a real value here — 0% accuracy
 * means the learner got everything wrong — so using it for "we have nothing to say" would
 * report failure where there is only silence.
 */
export function summarizeLearning(input: {
  attempts: readonly InsightAttempt[]
  plans: readonly InsightPlan[]
}): LearningInsights {
  const attempts = input.attempts
  const scored = attempts.filter(isScored)

  const known = scored.filter((a) => (a.normalized_score as number) >= KNOWN_THRESHOLD).length
  const accuracy = scored.length === 0 ? null : known / scored.length

  const durations = attempts
    .map((a) => a.duration_ms)
    .filter((ms) => typeof ms === 'number' && Number.isFinite(ms) && ms > 0)

  // Per-card means, from scored attempts only.
  const byCard = new Map<string, number[]>()
  for (const attempt of scored) {
    if (!attempt.card_id) continue
    const bucket = byCard.get(attempt.card_id)
    if (bucket) bucket.push(attempt.normalized_score as number)
    else byCard.set(attempt.card_id, [attempt.normalized_score as number])
  }

  const weakCards = [...byCard.entries()]
    .map(([cardId, scores]) => ({
      cardId,
      attempts: scores.length,
      meanScore: scores.reduce((sum, s) => sum + s, 0) / scores.length,
    }))
    .filter((card) => card.attempts >= WEAK_MIN_ATTEMPTS && card.meanScore < WEAK_MAX_MEAN_SCORE)
    // Worst first; card id breaks ties so the list is stable across reloads.
    .sort((a, b) => a.meanScore - b.meanScore || a.cardId.localeCompare(b.cardId))
    .slice(0, WEAK_LIMIT)

  const adherence = [...input.plans]
    .sort((a, b) => b.plan_date.localeCompare(a.plan_date))
    .map((plan) => ({
      planDate: plan.plan_date,
      totalItems: plan.total_items,
      completedItems: plan.completed_items,
      ratio: plan.total_items > 0
        ? Math.min(1, plan.completed_items / plan.total_items)
        : null,
    }))

  const plannedTotal = input.plans.reduce((sum, p) => sum + p.total_items, 0)
  const completedTotal = input.plans.reduce((sum, p) => sum + p.completed_items, 0)

  return {
    attemptCount: attempts.length,
    scoredCount: scored.length,
    accuracy,
    medianDurationMs: median(durations),
    weakCards,
    adherence,
    overallAdherence: plannedTotal > 0 ? Math.min(1, completedTotal / plannedTotal) : null,
  }
}
