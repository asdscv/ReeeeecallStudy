// ─── Legacy cards → planner candidates ──────────────────────────────────────
//
// The daily planner is deliberately pure: `buildDailyPlan` never queries Supabase
// (learning design §9.1). Something still has to turn what we DO have — legacy cards
// with their SRS columns, plus recent study logs — into the normalized candidate
// shape it scores. That translation is what this module is.
//
// It lives in shared/lib rather than shared/learning on purpose: it knows about
// `cards` rows and `study_logs` rows, which are legacy-app concepts the domain module
// must not learn about. Keeping it here also keeps it a pure function, so every
// feature-derivation rule below is unit-testable without a database.
//
// EVERY FEATURE STATES ITS "NO EVIDENCE" VALUE. Design §9.2 forbids implicit zero for
// missing evidence: zero is a real signal ("definitely not due", "never fails"), so
// using it for "we don't know" would systematically bury new or unlogged cards. The
// neutral value is 0.5 unless a different value is justified below.
//
// `reviewValue` is the one feature whose no-evidence value is NULL rather than a number: the
// planner can renormalise around a missing memory estimate (daily-plan-v2), so there is no need
// to pick a stand-in for a card that has no forgetting curve yet.
import { activitiesForLegacyCard } from '../learning/adapters/index.ts'
import { estimateMemory } from '../learning/application/memory.ts'
import type { PlannerCandidate } from '../learning/domain/index.ts'
import type { Card } from '../types/database.ts'

/** The subset of a study_logs row the mapper needs. */
export interface CandidateStudyLog {
  readonly card_id: string
  readonly rating: number | null
  readonly review_duration_ms: number | null
  readonly studied_at: string
}

export interface CandidateInput {
  readonly cards: readonly Card[]
  /** Recent logs for those cards, any order. Only the newest few per card are used. */
  readonly recentLogs: readonly CandidateStudyLog[]
  /** learning_goal_decks importance by deck id; a deck that is absent scores neutral. */
  readonly deckImportance: Readonly<Record<string, number>>
  /** ISO instant used as "now"; passed in so the result is deterministic in tests. */
  readonly now: string
  /**
   * Cards the learner ACCEPTED a recommendation for (mig 174).
   *
   * This is what makes accepting a recommendation mean something: without it the accept
   * would be a row nobody reads. It raises `contentImportance` — the feature that is
   * otherwise flat at 0.5 because no curated content metadata exists yet (design §5.2) —
   * so an accepted card competes better for tomorrow's budget. It does NOT force selection:
   * a recommendation is a suggestion, and overriding due-urgency entirely would let a
   * single accept crowd out everything the learner actually has to review.
   */
  readonly acceptedCardIds?: readonly string[]
}

/** Minutes we assume a single legacy recall item takes. */
export const RECALL_MINUTES = 0.5

/** Overdue beyond this many days is already maximally urgent. */
const DUE_SATURATION_DAYS = 7

/** How many of a card's most recent logs contribute to recentFailure. */
const RECENT_LOG_WINDOW = 5

/** A rating at or below this counts as a failure (1=Again, 2=Hard in the SRS UI). */
const FAILURE_RATING = 2

/** Neutral value for a feature with no evidence (design §9.2). */
const NEUTRAL = 0.5

/**
 * contentImportance for a card the learner accepted a recommendation for.
 *
 * 0.9 rather than 1.0: it is 0.10 of the priority weight, so this moves a card up without
 * pretending the learner's accept outranks the evidence that the card is due.
 */
const ACCEPTED_CONTENT_IMPORTANCE = 0.9

/**
 * recentFailure's no-evidence value. Lower than NEUTRAL on purpose: a card with no
 * logs has not failed, and treating "unknown" as "half-failing" would let brand-new
 * cards outrank cards the user is actually getting wrong.
 */
const NEUTRAL_RECENT_FAILURE = 0.3

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : NEUTRAL)

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Due urgency from `next_review_at`.
 *   never reviewed (no next_review_at)  → 1   (a new card is the most due thing there is)
 *   due now or overdue                  → 0.5 → 1 across DUE_SATURATION_DAYS overdue
 *   scheduled in the future             → 0.5 → 0 across the same span
 * A parse failure returns the neutral value rather than pretending the card is due.
 */
export function dueUrgencyFor(nextReviewAt: string | null | undefined, nowMs: number): number {
  if (nextReviewAt == null) return 1
  const due = parseTime(nextReviewAt)
  if (due === null) return NEUTRAL
  const days = (nowMs - due) / 86_400_000
  const span = DUE_SATURATION_DAYS
  return clamp01(NEUTRAL + (days / span) * NEUTRAL)
}

/** Share of failures among a card's most recent logs; no logs → NEUTRAL_RECENT_FAILURE. */
export function recentFailureFor(logs: readonly CandidateStudyLog[]): number {
  const rated = logs.filter((log) => typeof log.rating === 'number')
  if (rated.length === 0) return NEUTRAL_RECENT_FAILURE
  const window = rated.slice(0, RECENT_LOG_WINDOW)
  const failures = window.filter((log) => (log.rating as number) <= FAILURE_RATING).length
  return clamp01(failures / window.length)
}

/**
 * How slow this card is relative to the user's own baseline.
 *   no timing for the card, or no baseline → NEUTRAL
 *   at the baseline                        → 0.5
 *   twice the baseline or worse            → 1
 * Relative, not absolute, because "slow" for a sentence card is fast for a single word.
 */
export function responseTimePenaltyFor(cardMedianMs: number | null, baselineMs: number | null): number {
  if (cardMedianMs === null || baselineMs === null || baselineMs <= 0) return NEUTRAL
  return clamp01((cardMedianMs / baselineMs) * NEUTRAL)
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The user's own median review duration across the supplied logs; null when unknown. */
export function baselineDurationMs(logs: readonly CandidateStudyLog[]): number | null {
  return median(logs
    .map((log) => log.review_duration_ms)
    .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms > 0))
}

/** The activity shape a plan item needs, taken from the adapter's projection. */
export interface PlanItemShape {
  readonly activityType: string
  readonly stimulusType: string
  readonly responseType: string
  readonly evaluatorType: string
}

/**
 * The stimulus/response/evaluator triple `save_daily_plan` requires for an item.
 * `PlannerCandidate` only carries `activityType`, so this reads the rest back from
 * the same adapter projection the candidate was built from — one source of truth for
 * "what a legacy card is as an activity" rather than constants copied into the store.
 */
export function legacyCardItemShape(card: Card): PlanItemShape {
  const [activity] = activitiesForLegacyCard({ card, persistedActivities: [] })
  return {
    activityType: activity.activityType,
    stimulusType: activity.stimulusType,
    responseType: activity.responseType,
    evaluatorType: activity.evaluatorType,
  }
}

/**
 * Build planner candidates for the cards of a goal's attached decks.
 *
 * Ordering is by card id so the result — and therefore `buildDailyPlan`'s input
 * fingerprint — does not depend on the order Postgres happened to return rows in.
 * Determinism is a stated planner property (design §9.4) and it starts here.
 */
export function buildCandidatesFromCards(input: CandidateInput): readonly PlannerCandidate[] {
  const nowMs = parseTime(input.now) ?? Date.now()
  const baseline = baselineDurationMs(input.recentLogs)

  const logsByCard = new Map<string, CandidateStudyLog[]>()
  for (const log of input.recentLogs) {
    const bucket = logsByCard.get(log.card_id)
    if (bucket) bucket.push(log)
    else logsByCard.set(log.card_id, [log])
  }
  // Newest first, so RECENT_LOG_WINDOW really means "most recent".
  for (const bucket of logsByCard.values()) {
    bucket.sort((a, b) => (parseTime(b.studied_at) ?? 0) - (parseTime(a.studied_at) ?? 0))
  }

  const cards = [...input.cards].sort((a, b) => a.id.localeCompare(b.id))
  const acceptedCards = new Set(input.acceptedCardIds ?? [])

  return cards.map((card) => {
    const logs = logsByCard.get(card.id) ?? []
    const cardMedian = median(logs
      .map((log) => log.review_duration_ms)
      .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms > 0))
    // The adapter decides the activity shape; a legacy card projects to recall.
    const [activity] = activitiesForLegacyCard({ card, persistedActivities: [] })
    const importance = input.deckImportance[card.deck_id]
    const accepted = acceptedCards.has(card.id)
    // Memory state from the legacy SRS row. `reviewValue` stays null for a card with no
    // interval or no last review — the planner renormalises rather than inventing a number.
    const memory = estimateMemory({
      intervalDays: card.interval_days,
      lastReviewedAt: card.last_reviewed_at,
      now: input.now,
    })

    return {
      candidateId: `card:${card.id}`,
      activityId: null,          // legacy cards plan by card_id; no activity row is created
      cardId: card.id,
      conceptId: null,
      activityType: activity.activityType,
      dueUrgency: dueUrgencyFor(card.next_review_at, nowMs),
      recentFailure: recentFailureFor(logs),
      responseTimePenalty: responseTimePenaltyFor(cardMedian, baseline),
      goalRelevance: typeof importance === 'number' ? clamp01(importance) : NEUTRAL,
      contentImportance: accepted ? ACCEPTED_CONTENT_IMPORTANCE : NEUTRAL,
      reviewValue: memory.reviewValue,
      estimatedMinutes: RECALL_MINUTES,
      difficulty: null,
    }
  })
}
