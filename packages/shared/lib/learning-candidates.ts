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
import {
  resolveCardAnswerFaces, type CardAnswerTemplate, type CardFaceKeys,
} from './card-answer.ts'

/** The subset of a study_logs row the mapper needs. */
export interface CandidateStudyLog {
  readonly card_id: string
  /**
   * `study_logs.rating` is TEXT, not a number.
   *
   * This was declared `number | null` and the store cast the rows to this interface, so the
   * compiler had nothing to disagree with — and `recentFailureFor`'s `typeof === 'number'`
   * filter was false for every row a real database returns. A 0.25-weight feature sat at its
   * no-evidence constant in production. See `ratingStruggle` for the actual vocabulary.
   *
   * Numbers stay accepted because the SM-2 grade scale (1..4) is the natural shape for a
   * future column and one function should judge both rather than this file breaking again.
   */
  readonly rating: string | number | null
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

/** A numeric rating at or below this counts as a full failure (1=Again, 2=Hard in the SRS UI). */
const FAILURE_RATING = 2

/**
 * How much each rating says the learner STRUGGLED with the card, 0..1. `null` = not a rating.
 *
 * The vocabulary is fixed by the CHECK constraint on `study_logs.rating`
 * (`071_fix_study_logs_constraints.sql`): again, hard, good, easy, known, unknown, next,
 * viewed, got_it, missed. Every one of them is named here so a value the database can store is
 * never silently read as something it is not.
 *
 * `hard` is 0.5, not 1. Counting it as a lapse would contradict the scheduler, which on `hard`
 * INCREASES the interval (`srs.ts` review phase: `interval × 1.2`); counting it as a success
 * would throw away the only signal that distinguishes a card the learner barely got from one
 * they knew cold. A graded value is the only reading that agrees with both.
 *
 * `next` and `viewed` are navigation, not judgement — they are recorded by the browse/cram
 * modes where the learner never says whether they recalled anything. They return null so they
 * leave the DENOMINATOR too: a card flipped past ten times has no failure evidence, and
 * averaging zeros into it would read as ten clean successes.
 *
 * An unrecognized string also returns null. A rating added by a future migration must not be
 * counted as a success by default — that would quietly lower the priority of cards the learner
 * is failing, which is the exact defect this function was written to fix.
 */
export function ratingStruggle(rating: string | number | null | undefined): number | null {
  if (typeof rating === 'number') {
    // SM-2 grade scale, kept for a future numeric column. Below the failure line is a lapse;
    // at the line ("hard") is the same half-credit the text vocabulary gives it.
    if (!Number.isFinite(rating)) return null
    if (rating < FAILURE_RATING) return 1
    if (rating === FAILURE_RATING) return 0.5
    return 0
  }
  switch (rating) {
    // Recall failed outright: SRS "Again", sequential-review "unknown", cramming "missed".
    case 'again':
    case 'unknown':
    case 'missed':
      return 1
    // Recalled, but with effort.
    case 'hard':
      return 0.5
    // Recall succeeded: SRS good/easy, sequential-review "known", cramming "got_it".
    case 'good':
    case 'easy':
    case 'known':
    case 'got_it':
      return 0
    // Not a judgement of recall (browse/sequential modes), and anything unrecognized.
    default:
      return null
  }
}

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

/**
 * Mean struggle across a card's most recent RATED logs; no rated log → NEUTRAL_RECENT_FAILURE.
 *
 * Logs that carry no judgement of recall (`next`, `viewed`, unrecognized values) are dropped
 * before the window is taken, not after: keeping them would let ten browse events push the one
 * real lapse out of a 5-log window.
 */
export function recentFailureFor(logs: readonly CandidateStudyLog[]): number {
  const struggles = logs
    .map((log) => ratingStruggle(log.rating))
    .filter((value): value is number => value !== null)
  if (struggles.length === 0) return NEUTRAL_RECENT_FAILURE
  const window = struggles.slice(0, RECENT_LOG_WINDOW)
  return clamp01(window.reduce((sum, value) => sum + value, 0) / window.length)
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
  /**
   * The prompt/reference field keys the card's TEMPLATE declared, or null when it did not.
   *
   * Non-null is what makes `responseType` `'text'`, and it is carried out of here so the
   * caller can record the decision on the plan row instead of re-deriving it later from a
   * template that may since have been edited.
   */
  readonly answerFaces: CardFaceKeys | null
}

/**
 * Resolver identity stored alongside the keys on a plan item.
 *
 * The keys are only meaningful together with the rule that produced them: "the template's
 * declared faces, refusing when they cannot be known" (shared/lib/card-answer). A stored payload
 * that does not say which rule wrote it cannot be audited after the rule changes.
 */
export const ANSWER_FACE_RESOLVER = 'card-answer-v1'

/**
 * Ceiling on a typed answer, in characters.
 *
 * `record_answer_attempt` rejects a `response` over 64 KiB (mig 167 §21.2) with P0006 — the same
 * code the plan-save cap uses, which the UI renders as "you've hit today's limit for rebuilding
 * plans". So the limit has to be enforced where the learner can see it (the input's `maxLength`)
 * rather than discovered as an unrelated error message. 2000 characters is ~6 KB of Korean or
 * Japanese, an order of magnitude below the server's cap, and far more than a recall answer.
 */
export const TYPED_ANSWER_MAX_CHARS = 2000

/**
 * The stimulus/response/evaluator triple `save_daily_plan` requires for an item.
 * `PlannerCandidate` only carries `activityType`, so this reads the rest back from
 * the same adapter projection the candidate was built from — one source of truth for
 * "what a legacy card is as an activity" rather than constants copied into the store.
 *
 * `template` upgrades `responseType` to `'text'` — and ONLY when the template declares both
 * faces unambiguously (`resolveCardAnswerFaces`). Passing nothing, or a template that does not
 * declare them, keeps the item exactly as it was before typed answers existed: three rating
 * buttons and no input. That asymmetry is the feature's safety property — the subset is defined
 * by what the data can name, not by what the UI would like to offer.
 *
 * `evaluatorType` stays `'self_rate'` even for a typed item, which is precise rather than a
 * hedge: the response IS text and the learner IS still the judge. `exact` would mark a correct
 * paraphrase wrong, and that score feeds `normalized_score` → insights → recommendations → the
 * next plan, so a bad grade does not just misinform, it changes what the learner studies.
 */
export function legacyCardItemShape(card: Card, template?: CardAnswerTemplate | null): PlanItemShape {
  const [activity] = activitiesForLegacyCard({ card, persistedActivities: [] })
  const answerFaces = resolveCardAnswerFaces(template, card)
  return {
    activityType: activity.activityType,
    stimulusType: activity.stimulusType,
    responseType: answerFaces ? 'text' : activity.responseType,
    evaluatorType: activity.evaluatorType,
    answerFaces,
  }
}

/**
 * What to store in `daily_plan_items.payload` for an item, or null when there is nothing to say.
 *
 * The column exists and has been written as `{}` since mig 165; this is its first real use. It
 * records WHICH fields the plan treated as prompt and reference at generation time, so the
 * decision stays auditable after the template is edited or the resolver changes. Null rather
 * than `{}` so the store can omit the key entirely and `save_daily_plan`'s
 * `COALESCE(NULLIF(payload,'null'), '{}')` keeps its existing behaviour untouched.
 *
 * It is a RECORD, not an input: nothing reads it back to decide what to show. The plan row's
 * `response_type` is the gate, because that is the column `record_answer_attempt` compares
 * against, and a second source for the same decision is a second thing that can drift.
 */
export function planItemAnswerPayload(shape: PlanItemShape): Record<string, unknown> | null {
  if (!shape.answerFaces) return null
  return {
    typed_answer: {
      resolver: ANSWER_FACE_RESOLVER,
      prompt_keys: [...shape.answerFaces.promptKeys],
      reference_keys: [...shape.answerFaces.referenceKeys],
    },
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
    // interval — the planner renormalises rather than inventing a number. `next_review_at` is
    // passed so the value curve's knee lands on the day the scheduler actually made the card
    // due, instead of one shifted by the 04:00 review-day snap (see memory.ts).
    const memory = estimateMemory({
      intervalDays: card.interval_days,
      lastReviewedAt: card.last_reviewed_at,
      nextReviewAt: card.next_review_at,
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
