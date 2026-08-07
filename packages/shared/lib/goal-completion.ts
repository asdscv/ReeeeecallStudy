/**
 * When a learning goal is finished, and when it will be.
 *
 * ## Why this had to be invented rather than read off
 *
 * Nothing in the app could answer "이 플랜 언제 완료돼?". `learning_goals.status` has allowed
 * 'completed' since mig 165 and `update_learning_goal` has permitted the transition since 167,
 * but no code ever made it. `learning_goals.target jsonb` was created for exactly this and is
 * `{}` on every row in production. `target_date` drives pacing and nothing reacts when it passes.
 *
 * And under SRS a goal genuinely never ends on its own: intervals grow, reviews recur, the daily
 * count never reaches zero. "Done" is a product decision the scheduler cannot make.
 *
 * ## The rule
 *
 * Complete when {@link COMPLETION_RATIO} of the goal's cards are MATURE, where mature is an
 * interval of {@link MATURE_INTERVAL_DAYS} days or more — the fourth rung of the scheduler's own
 * ladder and the usual spaced-repetition line between "being learned" and "retained".
 *
 * The comparison is a plain ratio with no rounding kindness, which makes a 2-4 card goal require
 * every card. That is correct rather than unfortunate: three of four cards known is not a
 * finished goal, and any absolute slack ("all but two") completes a two-card goal at zero cards
 * learned.
 */
import { INTERVALS_DAYS } from '../learning/application/workload'

/**
 * An interval at or above this counts as retained. Fourth rung of INTERVALS_DAYS.
 *
 * The SAME line the rest of the app already draws: `mature_card_count` (mig 183) uses
 * `interval_days >= 21` inclusive, and the dashboard's `getMasteryRate` reads it. Migration 183
 * exists because two surfaces once disagreed about what "mastered" meant — the older rule fired
 * after a single correct answer — so this deliberately reuses the settled definition rather than
 * introducing a third one. If 21 ever moves, it has to move in both places at once.
 */
export const MATURE_INTERVAL_DAYS = INTERVALS_DAYS[3] ?? 21

/** Share of a goal's cards that must be mature. */
export const COMPLETION_RATIO = 0.8

/**
 * Days from a rung to maturity, if every answer from here is correct.
 *
 * Read off the ladder rather than written as constants: a card sitting at rung 8 waits 8 days
 * for its next review, and THAT review is the one that sets 21. So the remaining time is the
 * sum of the rungs it still has to sit through, not the rungs it still has to climb.
 *
 * A card in a learning step (interval 0) graduates to rung 1 the same day, so it costs the same
 * as one already at rung 1 — no extra calendar day.
 */
function daysFromRung(rungIndex: number): number {
  let days = 0
  for (let i = rungIndex; i < INTERVALS_DAYS.length; i += 1) {
    if (INTERVALS_DAYS[i] >= MATURE_INTERVAL_DAYS) break
    days += INTERVALS_DAYS[i]
  }
  return days
}

/** interval 0-2 (learning, or just graduated): 1 + 3 + 8 = 12 days of waiting. */
export const DAYS_FROM_RUNG_1 = daysFromRung(0)
/** interval 3-7: 3 + 8 = 11. */
export const DAYS_FROM_RUNG_3 = daysFromRung(1)
/** interval 8-20: the next review is the one that matures it. */
export const DAYS_FROM_RUNG_8 = daysFromRung(2)

/** The card-state counts {@link goalCompletion} needs, as `get_goal_knowledge` returns them. */
export interface GoalCompletionCounts {
  total: number
  mature: number
  unseen: number
  /** Studied, interval 0-2. */
  rung1: number
  /** interval 3-7. */
  rung3: number
  /** interval 8-20. */
  rung8: number
}

export interface GoalCompletion {
  /** Cards that must be mature. `ceil(total * ratio)`. */
  required: number
  mature: number
  /** How many more mature cards the goal needs. 0 once earned. */
  remaining: number
  /** `mature / total` as a whole percent, 0 when the goal holds no cards. */
  percent: number
  /** The ratio is met RIGHT NOW. Not the same as the goal being stamped completed. */
  earned: boolean
  /**
   * Calendar days until the ratio can first be met, if every answer is correct from here.
   *
   * `null` when it cannot be projected: a goal with no cards, or one already earned.
   */
  daysToComplete: number | null
}

/**
 * Where a goal stands against the completion rule, and how far off it is.
 *
 * `newCardsPerDay` gates how fast unseen cards can even start, so a goal with 400 unseen cards
 * and an intake of 20 is at least 20 days from introducing them all — before any of them has
 * begun the twelve-day climb.
 *
 * `adherence` (0..1) stretches the estimate by what the learner actually does. Someone who
 * completes half of each day's plan takes roughly twice as long, and saying otherwise would
 * produce the one thing worse than no date: a confident wrong one. Absent or non-finite
 * adherence means "assume the plan is followed", which is the honest default before there is
 * any history to judge.
 */
export function goalCompletion(
  counts: GoalCompletionCounts,
  options: { newCardsPerDay?: number; adherence?: number | null } = {},
): GoalCompletion {
  const total = Math.max(0, Math.floor(counts.total));
  const mature = Math.max(0, Math.floor(counts.mature));

  if (total === 0) {
    // 0/0 is not 100%. There is nothing to have learned, and calling that complete turns
    // "you have not added a deck yet" into a finish line.
    return { required: 0, mature: 0, remaining: 0, percent: 0, earned: false, daysToComplete: null }
  }

  const required = Math.ceil(total * COMPLETION_RATIO)
  const remaining = Math.max(0, required - mature)
  const percent = Math.round((mature / total) * 100)
  const earned = mature >= required

  if (earned) {
    return { required, mature, remaining: 0, percent, earned: true, daysToComplete: null }
  }

  // Nearest-first: the goal needs `remaining` more mature cards, and the cheapest ones decide
  // when that happens. Taking the furthest cards would answer a question nobody asked.
  const intake = Number.isFinite(options.newCardsPerDay) && (options.newCardsPerDay as number) > 0
    ? Math.floor(options.newCardsPerDay as number)
    : null

  let left = remaining
  let days = 0

  const take = (available: number, costDays: number) => {
    if (left <= 0 || available <= 0) return
    left -= Math.min(left, available)
    days = Math.max(days, costDays)
  }

  take(counts.rung8, DAYS_FROM_RUNG_8)
  take(counts.rung3, DAYS_FROM_RUNG_3)
  take(counts.rung1, DAYS_FROM_RUNG_1)

  if (left > 0) {
    const unseen = Math.max(0, Math.floor(counts.unseen))
    if (left > unseen || intake === null) {
      // Either the goal does not hold enough cards to reach the ratio at all, or intake is
      // uncapped and there is no honest day count for "start them all at once".
      return { required, mature, remaining, percent, earned: false, daysToComplete: null }
    }
    // The LAST card that has to be introduced decides the date: introduced on day
    // ceil(left / intake) - 1 (the first batch starts today), then twelve days of climbing.
    const introDay = Math.ceil(left / intake) - 1
    days = Math.max(days, introDay + DAYS_FROM_RUNG_1)
  }

  const adherence = options.adherence
  const stretched = typeof adherence === 'number' && Number.isFinite(adherence) && adherence > 0
    ? Math.ceil(days / Math.min(1, adherence))
    : days

  return { required, mature, remaining, percent, earned: false, daysToComplete: stretched }
}
