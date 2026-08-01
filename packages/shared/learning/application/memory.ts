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
// it". That sentence justifies a scheduler's CHOICE of interval. It does not decide the order
// of a day's queue, and this module was originally built as if it did: value peaked at the
// target retention and fell away on BOTH sides, so the cards the learner had most nearly lost
// scored lowest. See `reviewValue` for why that is now monotone instead.
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
 * The value of a review at exactly the target retention — a card that is due right now.
 *
 * It is not 1 because the maximum belongs to a card the learner has probably already lost
 * (see `reviewValue`). It is high because being due is the scheduler's own statement that this
 * is the right day, and it sets the slope on both sides: above the target the value falls to 0
 * across only `1 - target` of retrievability, below it the remaining `1 - VALUE_AT_TARGET`
 * spreads across the whole `target`. With 0.75 and a 0.9 target that is a 27:1 asymmetry —
 * over-learned cards are punished hard, at-risk cards separated gently.
 */
export const REVIEW_VALUE_AT_TARGET = 0.75

/**
 * The value of a review for a card whose estimated recall has reached 0.
 *
 * 1, the maximum. Kept as a named export because it is the half of the curve that reverses an
 * earlier decision, and a test should pin it rather than restate the arithmetic.
 */
export const REVIEW_VALUE_AT_ZERO_RECALL = 1

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
 * Elapsed days measured from the SCHEDULE rather than from the last review.
 *
 * `next_review_at` is the scheduler's own statement of when this card reaches the target
 * retention. Reading it directly — `elapsed = interval + (now − due)` — makes the value curve's
 * knee land exactly on the day the card becomes due, for every card, whatever hour the learner
 * studies. Reconstructing the same instant from `last_reviewed_at + interval` does not, because
 * the two are allowed to disagree, and in this app they always do:
 *
 *   `nextDayBoundary` (lib/srs.ts) snaps every review to 04:00 local, so a card studied at
 *   21:00 comes due after `interval − 17/24` days, not `interval`. The shortfall is divided by
 *   the interval, so it is worst exactly where it matters most: measured against
 *   `last_reviewed_at`, a due 1-day card studied at 21:00 scored 0.5394 while a due 30-day card
 *   scored 0.9857 — the planner systematically preferred mature cards over ones the learner had
 *   just started learning, and only for learners who study in the evening.
 *
 * The same disagreement is produced by rescheduling, manual date edits, and cramming logs that
 * update `last_reviewed_at` without touching the interval. Trusting the due stamp removes all of
 * them at once.
 *
 * Returns null when there is no usable due stamp, no interval to anchor against, or no review
 * to anchor FROM; the caller falls back to `elapsedDaysBetween`.
 */
export function scheduleAnchoredElapsedDays(input: {
  readonly intervalDays: number | null | undefined
  readonly lastReviewedAt: string | null | undefined
  readonly nextReviewAt: string | null | undefined
  readonly now: string
}): number | null {
  // No review to anchor FROM. A never-reviewed card still carries a `next_review_at` — new
  // cards are given one so they surface in a queue — and reading that as a forgetting curve
  // would invent a memory estimate for a card the learner has never seen, which is the exact
  // "implicit evidence" the design forbids (§9.2).
  if (!input.lastReviewedAt) return null
  if (!isFiniteNumber(input.intervalDays) || input.intervalDays <= 0) return null
  const sinceDue = elapsedDaysBetween(input.nextReviewAt, input.now)
  if (sinceDue === null) return null
  return input.intervalDays + sinceDue
}

/**
 * How much a review right now is worth, 0..1. Monotone NON-INCREASING in `r`.
 *
 * ## Why monotone, when this used to peak at the target
 *
 * The peaked version scored a card at exactly the target retention 1.0 and a card the learner
 * had almost certainly forgotten 0.6. Three independent reasons say that is the wrong ordering
 * for a QUEUE (it remains the right idea for choosing an interval, which is the scheduler's
 * job, not this module's):
 *
 *  1. The reason code this feature justifies is literally `memory_risk`. Under the peaked curve
 *     its highest value went to cards that are NOT at risk — the explanation shown to the
 *     learner disagreed with the arithmetic that produced it.
 *  2. Mainstream practice for review ORDER is FSRS/Anki's "relative overdueness": lowest
 *     retrievability first, because those cards are closest to being lost outright.
 *  3. The product surface says "cards you are most likely to forget, first". Under the peaked
 *     curve that sentence was false, and no wording of a pricing page could make it true.
 *
 * The cost is acknowledged rather than hidden: a card at R ≈ 0 is expensive to relearn, so the
 * minutes it consumes buy less than a card caught near the target. That is a real tradeoff, and
 * it is the lesser one — the alternative ranks a card the learner has lost behind one they are
 * certain of.
 *
 * ## Shape
 *
 * Piecewise linear with a knee at `target`:
 *   r = 1       → 0                        (certain knowledge; a review teaches nothing)
 *   r = target  → REVIEW_VALUE_AT_TARGET   (due exactly now)
 *   r = 0       → 1                        (probably lost; relearn before it is gone)
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
    // Over-learned side: REVIEW_VALUE_AT_TARGET at the target, 0 at certainty.
    const span = 1 - t
    return span <= 0 ? REVIEW_VALUE_AT_TARGET : REVIEW_VALUE_AT_TARGET * ((1 - clamped) / span)
  }
  // At-risk side: REVIEW_VALUE_AT_TARGET at the target, rising to 1 as recall reaches 0.
  return REVIEW_VALUE_AT_TARGET + (1 - REVIEW_VALUE_AT_TARGET) * ((t - clamped) / t)
}

/**
 * The planner-facing summary of one item's memory state.
 *
 * `retrievability` is null exactly when it cannot be computed (new card, no last review, no
 * interval). Callers must propagate the null rather than substituting a number.
 */
interface MemoryEstimate {
  readonly stabilityDays: number | null
  readonly elapsedDays: number | null
  readonly retrievability: number | null
  readonly reviewValue: number | null
  /** Which clock `elapsedDays` came from. Reported so a diagnostic can say, not for scoring. */
  readonly elapsedSource: 'schedule' | 'last_review' | 'unknown'
}

/** Estimate memory state for a card from whatever the legacy SRS row holds. */
export function estimateMemory(input: {
  readonly intervalDays?: number | null
  readonly lastReviewedAt?: string | null
  /**
   * The scheduler's due stamp. Preferred over `lastReviewedAt` when present — see
   * `scheduleAnchoredElapsedDays` for why reconstructing it instead is measurably wrong here.
   */
  readonly nextReviewAt?: string | null
  readonly now: string
  readonly stabilityDays?: number | null
  readonly targetRetention?: number
}): MemoryEstimate {
  // A measured stability wins over one inferred from an interval: once the memory table
  // carries a fitted value, this module must prefer it without any caller change.
  const stabilityDays = isFiniteNumber(input.stabilityDays) && input.stabilityDays > 0
    ? input.stabilityDays
    : stabilityFromInterval(input.intervalDays)
  // The anchor uses `intervalDays`, not `stabilityDays`: it is answering "where is this card
  // relative to the day the SCHEDULER chose", and the scheduler chose that day from the
  // interval. A fitted stability then converts that position into a recall probability.
  const anchored = scheduleAnchoredElapsedDays({
    intervalDays: input.intervalDays,
    lastReviewedAt: input.lastReviewedAt,
    nextReviewAt: input.nextReviewAt,
    now: input.now,
  })
  const elapsedDays = anchored ?? elapsedDaysBetween(input.lastReviewedAt, input.now)
  const r = stabilityDays === null || elapsedDays === null
    ? null
    : retrievability(elapsedDays, stabilityDays)
  return {
    stabilityDays,
    elapsedDays,
    retrievability: r,
    reviewValue: reviewValue(r, input.targetRetention),
    elapsedSource: anchored !== null ? 'schedule' : (elapsedDays !== null ? 'last_review' : 'unknown'),
  }
}
