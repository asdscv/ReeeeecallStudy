// ─── Memory model: retrievability, and what a review is WORTH ────────────────
//
// The planner's original five features rank by urgency: the more overdue an item, the higher
// it scores. That is not what the evidence says. A review's value depends on the probability
// you can still recall the item at the moment you are asked, and that probability has a
// known shape.
//
// ## Where the numbers come from
//
// FSRS (Free Spaced Repetition Scheduler) models memory with three quantities — Difficulty,
// Stability, Retrievability — and defines **stability as the number of days for retrievability
// to fall from 100% to 90%**. FSRS-4.5 onward replaced the exponential forgetting curve with a
// power curve because it fits real review data better: a superposition of exponentials (which
// is what a deck of mixed-difficulty items is) is better approximated by a power law than by
// any single exponential.
//
//   R(t) = (1 + FACTOR · t/S)^DECAY,   DECAY = −0.5,   FACTOR = 19/81
//
// The constants are not free parameters here: they are fixed by the definition above. At
// t = S the expression is (1 + 19/81)^(−1/2) = (100/81)^(−1/2) = 0.9 exactly, which is the
// property a unit test in this repo asserts rather than trusts.
//
// FSRS's stability-increase function rises as R at review time FALLS — "the best time to
// review your material is when you almost forgot it, provided that you succeeded in recalling
// it". Both halves of that sentence matter, and they pull in opposite directions: waiting
// longer means a bigger gain if you succeed and a lapse if you do not. So the value of
// scheduling a review peaks at a target retrievability strictly below 1, and falls away on both
// sides — steeply above it (an item you certainly know teaches nothing, so the value reaches 0)
// and gently below it, where it FLOORS rather than collapses (an item you have probably
// forgotten still needs relearning; it is just more expensive than one caught at the peak).
//
// ## What this module deliberately does NOT do
//
// It does not implement FSRS scheduling. This app's SRS is SM-2-shaped (`ease_factor`,
// `interval_days`, `repetitions`) and owned by `apply_study_rating`; replacing it is a
// separate, migration-heavy decision. What this module does is READ that state to estimate how
// likely recall is right now, so the PLANNER can order a day's work. Estimating stability from
// a legacy interval is an approximation and is named as one — see `stabilityFromInterval`.

/** FSRS-5 forgetting-curve exponent. Negative: retrievability falls with elapsed time. */
export const FSRS_DECAY = -0.5

/**
 * FSRS-5 curve factor, fixed by the definition of stability (R = 0.9 at t = S):
 * solving (1 + F)^DECAY = 0.9 for F gives 19/81.
 */
export const FSRS_FACTOR = 19 / 81

/**
 * The retrievability a review is scheduled for.
 *
 * 0.9 is the value FSRS's own definition of stability is anchored to and the default desired
 * retention in every mainstream implementation. It is exposed so a future per-goal setting can
 * override it without the planner learning about memory models.
 */
export const DEFAULT_TARGET_RETENTION = 0.9

/**
 * How much more forgiving the value curve is BELOW the target than above it.
 *
 * Above the target the item is over-learned and a review buys almost nothing; below it the
 * item is at risk and a review still buys relearning. 1 would make the curve symmetric, which
 * would rank a certainly-known item as highly as one at the same distance on the risky side.
 *
 * A consequence to be aware of rather than surprised by: with 2.5 the at-risk side never
 * reaches 0 — at R = 0 the value is 1 − 0.9/2.25 = 0.6 (see `REVIEW_VALUE_AT_ZERO_RECALL`).
 * A forgotten item is worth less than one caught at the peak, and clearly more than one you
 * are certain to know. Zero would mean "not worth relearning", which is never true.
 */
const BELOW_TARGET_TOLERANCE = 2.5

/**
 * The value floor on the at-risk side: `1 - t/(t · TOLERANCE)` = `1 - 1/TOLERANCE`, which is
 * independent of the target. Exported so the test pins the floor instead of restating the
 * arithmetic.
 */
export const REVIEW_VALUE_AT_ZERO_RECALL = 1 - 1 / BELOW_TARGET_TOLERANCE

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * Probability of recalling an item after `elapsedDays`, given memory `stabilityDays`.
 *
 * `elapsedDays <= 0` means the last review is stamped at or after `now` — a just-reviewed card,
 * or clock skew — and returns 1: no time has passed, so nothing has been forgotten. A
 * non-positive or unknown stability returns null, "we cannot say", which the caller must not
 * read as 0. A brand-new card has no forgetting curve yet, and reporting 0% recall for it would
 * send the planner exactly the wrong signal.
 */
export function retrievability(elapsedDays: number, stabilityDays: number): number | null {
  if (!isFiniteNumber(elapsedDays) || !isFiniteNumber(stabilityDays)) return null
  if (stabilityDays <= 0) return null
  if (elapsedDays <= 0) return 1
  const r = Math.pow(1 + FSRS_FACTOR * (elapsedDays / stabilityDays), FSRS_DECAY)
  return Math.min(1, Math.max(0, r))
}

/**
 * Estimate stability from an SM-2 style interval.
 *
 * This is a BRIDGE, not a measurement. A legacy scheduler picks its interval so that recall is
 * still likely at the end of it — the same thing stability means — so the interval is the best
 * single estimate available without a review-history fit. It is deliberately a plain identity
 * rather than a tuned factor: inventing a multiplier here would look like precision the data
 * does not support.
 *
 * Returns null when there is no interval to read, which is the honest answer for a new card.
 */
export function stabilityFromInterval(intervalDays: number | null | undefined): number | null {
  if (!isFiniteNumber(intervalDays) || intervalDays <= 0) return null
  return intervalDays
}

/** Whole and fractional days between two instants; null if either is unusable. */
export function elapsedDaysBetween(
  fromIso: string | null | undefined,
  toIso: string,
): number | null {
  if (!fromIso) return null
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return (to - from) / 86_400_000
}

/**
 * How much a review right now is worth, 0..1, peaking at `target`.
 *
 * The shape encodes the two halves of FSRS's finding: value rises as recall gets less certain,
 * but stops rising once recall is unlikely enough that the review becomes relearning. Above the
 * target the penalty is the full distance, reaching 0 at certainty; below it the distance is
 * discounted by `BELOW_TARGET_TOLERANCE` and the curve settles on
 * `REVIEW_VALUE_AT_ZERO_RECALL`, so a risky item always outranks a certain one.
 *
 * Returns null for a null retrievability, so an unknown card contributes NOTHING to this
 * feature rather than a fabricated middle value — the planner renormalises around it.
 */
export function reviewValue(
  r: number | null,
  target: number = DEFAULT_TARGET_RETENTION,
): number | null {
  if (r === null || !isFiniteNumber(r)) return null
  const t = Math.min(0.99, Math.max(0.01, isFiniteNumber(target) ? target : DEFAULT_TARGET_RETENTION))
  const clamped = Math.min(1, Math.max(0, r))
  if (clamped >= t) {
    // Over-learned side: 1 at the target, 0 at certainty.
    const span = 1 - t
    return span <= 0 ? 1 : Math.max(0, 1 - (clamped - t) / span)
  }
  // At-risk side: 1 at the target, decaying more slowly toward 0 recall.
  const span = t * BELOW_TARGET_TOLERANCE
  return Math.max(0, 1 - (t - clamped) / span)
}

/**
 * The planner-facing summary of one item's memory state.
 *
 * `retrievability` is null exactly when it cannot be computed (new card, no last review, no
 * interval). Callers must propagate the null rather than substituting a number.
 */
export interface MemoryEstimate {
  readonly stabilityDays: number | null
  readonly elapsedDays: number | null
  readonly retrievability: number | null
  readonly reviewValue: number | null
}

/** Estimate memory state for a card from whatever the legacy SRS row holds. */
export function estimateMemory(input: {
  readonly intervalDays?: number | null
  readonly lastReviewedAt?: string | null
  readonly now: string
  readonly stabilityDays?: number | null
  readonly targetRetention?: number
}): MemoryEstimate {
  // A measured stability wins over one inferred from an interval: once the memory table
  // carries a fitted value, this module must prefer it without any caller change.
  const stabilityDays = isFiniteNumber(input.stabilityDays) && input.stabilityDays > 0
    ? input.stabilityDays
    : stabilityFromInterval(input.intervalDays)
  const elapsedDays = elapsedDaysBetween(input.lastReviewedAt, input.now)
  const r = stabilityDays === null || elapsedDays === null
    ? null
    : retrievability(elapsedDays, stabilityDays)
  return {
    stabilityDays,
    elapsedDays,
    retrievability: r,
    reviewValue: reviewValue(r, input.targetRetention),
  }
}
