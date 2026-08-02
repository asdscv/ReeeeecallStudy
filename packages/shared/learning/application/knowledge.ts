// ─── What "I know this" means, in exactly one place ──────────────────────────
//
// Every surface that reports learning state — the plan, the dashboard, study history,
// achievements — must answer the same question the same way. Before this module the app
// carried TWO conflicting answers and neither was defensible:
//
//   packages/shared/lib/stats.ts   `srs_status='review' && interval_days >= 21`
//   migration 070 (achievements)   `ease_factor > 2.5 && srs_status='review'`
//
// The second is the worse of the two: ease starts at 2.5 and gains +0.05 on every correct
// review, so ONE right answer makes a card "mastered" and the 1,000-card mastery badge means
// "answered 1,000 cards correctly once". The first borrows Anki's 21-day line, which Anki's own
// author calls arbitrary — "there's nothing special about 21 days in particular".
//
// Neither is usable as a GOAL, for a reason that is structural rather than cosmetic. An
// interval threshold is a state to be maintained, not a place to arrive: lapses knock cards back
// below the line every day, and a simulation of this app's own scheduler puts the equilibrium at
// ~99% (10k cards, 10% lapse rate) — never 100%, at any threshold, forever. Raising the bar
// makes it worse, not better (56 days settles at 97.7%, 365 days at 89%). A progress bar built
// on one can never fill.
//
// So the default criterion here is a question with an achievable answer: **will this card be
// recalled on the day that matters**. Retrievability on a target date is a probability the
// forgetting curve already computes, it has no arbitrary constant in it, and it can reach 100%
// because a lapse two months before an exam has time to recover.
//
// THE CRITERION IS PLUGGABLE ON PURPOSE. The owner intends to change this rule, so it is one
// registration rather than a constant to grep for. The threshold variants are registered too —
// not as speculative hooks (this codebase just deleted a registry with zero importers and four
// adapter members nothing read) but because they are what the dashboard and the achievement
// migration are being moved OFF of, and the migration needs to name the old rule to replace it.
import {
  DEFAULT_TARGET_RETENTION, elapsedDaysBetween, estimateMemory, retrievability, stabilityFromInterval,
} from './memory.ts'
import { validationError } from '../domain/errors.ts'

// Not exported: no consumer outside this file names these yet, and
// `learning-kernel-no-dead-exports.test.ts` fails an export nothing reads. They become public
// the moment a screen needs to name one — with that screen in the same change.

/** Whatever the SRS row holds. Deliberately the legacy card shape — nothing new to persist. */
interface CardMemoryInput {
  readonly intervalDays?: number | null
  readonly lastReviewedAt?: string | null
  readonly nextReviewAt?: string | null
  readonly easeFactor?: number | null
  readonly repetitions?: number | null
  readonly srsStatus?: string | null
  /** A fitted stability, once the memory table carries one. Preferred over the interval. */
  readonly stabilityDays?: number | null
}

/**
 * When the question is being asked.
 *
 * `now` is always required. `at` is the moment being judged — the same as `now` for "do I know
 * this today", or the goal's target date for "will I know this on exam day".
 */
interface KnowledgeMoment {
  readonly now: string
  readonly at: string
}

export interface KnowledgeCriterion {
  readonly id: string
  readonly version: string
  /** Human-facing summary of the rule, for the UI to explain itself without hard-coding prose. */
  readonly describe: () => { readonly kind: string; readonly value: number }
  /**
   * Confidence in 0..1 that the card is known at `moment.at`, or null when the card has never
   * been reviewed and there is nothing to judge.
   *
   * Null rather than 0: an unseen card is UNKNOWN in the sense of "no evidence", and counting it
   * as a confident zero would let a deck of new cards report a precise 0% instead of "not
   * started". `knowledgeState` keeps the two apart.
   */
  readonly confidence: (card: CardMemoryInput, moment: KnowledgeMoment) => number | null
  /** Whether the card counts as known. Derived from `confidence` unless a rule is not graded. */
  readonly isKnown: (card: CardMemoryInput, moment: KnowledgeMoment) => boolean
}

function daysBetween(from: string, to: string): number | null {
  const days = elapsedDaysBetween(from, to)
  return days === null ? null : days
}

/**
 * DEFAULT — the card will still be recalled at `moment.at`.
 *
 * Pessimistic by construction: it assumes NO further review between now and the target date, so
 * it answers "if I stopped studying today, what would I still know on exam day". That is the
 * floor, and the only projection that needs no assumption about future behaviour. A forecast of
 * where the plan will GET you is a different question and belongs to a different module — one
 * that has to simulate, and should not masquerade as a fact about the present.
 */
export function retentionCriterion(targetRetention: number = DEFAULT_TARGET_RETENTION): KnowledgeCriterion {
  if (!Number.isFinite(targetRetention) || targetRetention <= 0 || targetRetention >= 1) {
    throw validationError('targetRetention must be between 0 and 1 exclusive', { targetRetention })
  }
  const confidence = (card: CardMemoryInput, moment: KnowledgeMoment): number | null => {
    // `estimateMemory` owns the awkward part — preferring a fitted stability, and anchoring
    // elapsed time on the scheduler's due stamp rather than reconstructing it.
    const memory = estimateMemory({
      intervalDays: card.intervalDays,
      lastReviewedAt: card.lastReviewedAt,
      nextReviewAt: card.nextReviewAt,
      stabilityDays: card.stabilityDays,
      now: moment.now,
      targetRetention,
    })
    const stability = memory.stabilityDays ?? stabilityFromInterval(card.intervalDays)
    if (stability === null || stability <= 0) return null
    // Elapsed time is measured from the last review to the judged moment, so a target date in
    // the future decays the card further and a target of `now` reproduces today's estimate.
    const anchor = card.lastReviewedAt ?? null
    if (!anchor) return null
    const elapsed = daysBetween(anchor, moment.at)
    if (elapsed === null) return null
    return retrievability(Math.max(0, elapsed), stability)
  }
  return {
    id: 'retention',
    version: 'retention-v1',
    describe: () => ({ kind: 'retention', value: targetRetention }),
    confidence,
    isKnown: (card, moment) => {
      const value = confidence(card, moment)
      return value !== null && value >= targetRetention
    },
  }
}

/**
 * The rule the dashboard used: an interval at or beyond a fixed number of days.
 *
 * Registered so the migration replacing it can name it, and so the equilibrium argument above
 * stays testable rather than being a comment. Not recommended as a goal — see the module header.
 */
export function intervalCriterion(thresholdDays: number): KnowledgeCriterion {
  if (!Number.isFinite(thresholdDays) || thresholdDays <= 0) {
    throw validationError('thresholdDays must be positive', { thresholdDays })
  }
  const known = (card: CardMemoryInput): boolean =>
    typeof card.intervalDays === 'number' && card.intervalDays >= thresholdDays
  return {
    id: 'interval',
    version: 'interval-v1',
    describe: () => ({ kind: 'interval', value: thresholdDays }),
    // Ungraded: a card is over the line or it is not, so confidence is the boolean itself rather
    // than a fabricated ratio. A progress bar over this rule is counting cards, not certainty.
    confidence: (card) => (typeof card.intervalDays === 'number' ? (known(card) ? 1 : 0) : null),
    isKnown: known,
  }
}

/**
 * The rule the achievement migration used, stated honestly.
 *
 * `ease_factor > 2.5` is not a mastery test — ease starts AT 2.5 and rises +0.05 per correct
 * review, so the predicate is "has been answered correctly at least once while in review". It is
 * registered under its real meaning so replacing it is a visible, reviewable change rather than
 * a silent one.
 */
export function easeAboveDefaultCriterion(): KnowledgeCriterion {
  const known = (card: CardMemoryInput): boolean =>
    card.srsStatus === 'review' && typeof card.easeFactor === 'number' && card.easeFactor > 2.5
  return {
    id: 'ease-above-default',
    version: 'ease-above-default-v1',
    describe: () => ({ kind: 'ease', value: 2.5 }),
    confidence: (card) => (card.srsStatus ? (known(card) ? 1 : 0) : null),
    isKnown: known,
  }
}

/** Counts every surface reports. One shape, so the numbers cannot disagree between screens. */
interface KnowledgeState {
  readonly total: number
  /** Never reviewed — no evidence either way, kept out of both `known` and `unknown`. */
  readonly unseen: number
  readonly known: number
  readonly unknown: number
  /** Mean confidence over cards that have any, for a progress bar that is not just a count. */
  readonly meanConfidence: number | null
}

export function knowledgeState(
  cards: readonly CardMemoryInput[],
  moment: KnowledgeMoment,
  criterion: KnowledgeCriterion,
): KnowledgeState {
  let unseen = 0, known = 0, unknown = 0, sum = 0, scored = 0
  for (const card of cards) {
    const value = criterion.confidence(card, moment)
    if (value === null) { unseen += 1; continue }
    sum += value; scored += 1
    if (criterion.isKnown(card, moment)) known += 1
    else unknown += 1
  }
  return {
    total: cards.length,
    unseen,
    known,
    unknown,
    meanConfidence: scored > 0 ? sum / scored : null,
  }
}
