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
import { calculateSRS } from './srs'
import type { SrsCardData } from './srs'

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
 * Derived by walking ONE card from new through `calculateSRS`, so the numbers cannot drift
 * from the scheduler, and reading off how far each rung is from the day it matures. The walk
 * is what makes it honest: a card sitting at interval 8 GOT there by being answered correctly,
 * so its ease has grown, and `round(8 × 2.59) = 21` — one answer away. Instantiating a card at
 * interval 8 with a fresh 2.5 ease instead gives `round(8 × 2.55) = 20`, one day short of
 * mature, and a projection twenty days too long.
 *
 * `calculateSRS` takes no clock — it reads `new Date()` itself — so elapsed time is
 * accumulated from the intervals it grants. A wait IS the interval the previous answer gave.
 *
 * This replaces a sum over `INTERVALS_DAYS` from the card's current rung, which counted the
 * interval a card is already sitting in as time it still had to wait. A card the planner is
 * offering is due now; the answer it is about to get is the one that promotes it. Every
 * constant was one rung too long, and worst where it decides the most:
 *
 *     interval 1   was 12   is 11
 *     interval 3   was 11   is  8
 *     interval 8   was  8   is  0   ← one answer away, and it was priced as eight days
 *
 * `goalCompletion` spends the cheapest cards first, so mispricing the cheapest rung is what
 * decided the whole estimate.
 */
function rungCosts(): { rung1: number; rung3: number; rung8: number } {
  let card: SrsCardData = {
    srs_status: 'new',
    interval_days: 0,
    ease_factor: 2.5,
    repetitions: 0,
  }
  let days = 0
  const reached: Record<string, number> = {}
  for (let step = 0; step < 40; step += 1) {
    const iv = card.interval_days
    if (iv >= 1 && iv < 3 && reached.rung1 === undefined) reached.rung1 = days
    if (iv >= 3 && iv < 8 && reached.rung3 === undefined) reached.rung3 = days
    if (iv >= 8 && iv < MATURE_INTERVAL_DAYS && reached.rung8 === undefined) reached.rung8 = days
    if (iv >= MATURE_INTERVAL_DAYS) {
      return {
        rung1: days - (reached.rung1 ?? 0),
        rung3: days - (reached.rung3 ?? 0),
        rung8: days - (reached.rung8 ?? 0),
      }
    }
    const next = calculateSRS(card, 'good')
    card = {
      srs_status: next.srs_status,
      interval_days: next.interval_days,
      ease_factor: next.ease_factor,
      repetitions: next.repetitions,
    }
    // A learning step is minutes away: it costs an answer and no calendar day.
    if (card.interval_days < MATURE_INTERVAL_DAYS) days += card.interval_days
  }
  // Unreachable by correct answers. A projection is better absent than invented.
  return { rung1: Infinity, rung3: Infinity, rung8: Infinity }
}

const RUNG_COSTS = rungCosts()

/** interval 0-2 (learning, or just graduated). */
export const DAYS_FROM_RUNG_1 = RUNG_COSTS.rung1
/** interval 3-7. */
export const DAYS_FROM_RUNG_3 = RUNG_COSTS.rung3
/** interval 8-20 — one correct answer away, which is why it is spent first. */
export const DAYS_FROM_RUNG_8 = RUNG_COSTS.rung8

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
   * Calendar days until the ratio can first be met, if every answer from here is correct.
   *
   * `null` when it cannot be projected: a goal with no cards, or one already earned.
   *
   * A FLOOR, and the screen has to say so. It is the sum of the ladder rungs the remaining
   * cards still have to sit through — pure calendar waiting, with no failure term. Cards climb
   * in PARALLEL, so ten cards and one card both take twelve days; the deck's size is not an
   * input and never was.
   *
   * It used to be divided by the learner's plan adherence before being shown, which is how a
   * 29-card goal came to read "완료까지 약 25일": twelve ladder days ÷ 0.49. The learner asked
   * what it meant and there was no answer on the screen — the 0.49 lived in a different
   * section under a different name. That division is also not a model of anything. Adherence
   * is the share of PLANNED ITEMS completed over fourteen days; the rungs are how long a
   * memory has to rest. Skipping a plan item delays when a review is answered, which is a
   * different quantity from how long the card must wait, and the two cannot be multiplied.
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
 * There is deliberately no `adherence` option any more. It used to divide the answer, and the
 * quotient was what a learner photographed as "완료까지 약 25일" on a 29-card goal without
 * being able to work out where it came from. See `daysToComplete` for why the division was
 * not a model of anything either.
 */
export function goalCompletion(
  counts: GoalCompletionCounts,
  options: { newCardsPerDay?: number } = {},
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

  return { required, mature, remaining, percent, earned: false, daysToComplete: days }
}
