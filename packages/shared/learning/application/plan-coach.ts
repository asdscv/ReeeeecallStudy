/**
 * 주간 플랜 코치 — which one thing, if anything, should change about this plan.
 *
 * ## Why this is code and not a prompt (yet)
 *
 * The lever set is CLOSED and the new number is derived here, not chosen — so a model's
 * entire contribution would be picking one member of a six-item enum from the same digest
 * this function reads. Shipping the chooser as code gets the table, the suggestion, the
 * apply path and these tests exercised first; swapping in a provider later writes the same
 * rows under `provider = 'ai'` and changes nothing else. That is what the `provider` column
 * on `study_recommendations` was built for and has never been used for.
 *
 * It also means the coach costs nothing to run. A learner should not be charged to be told
 * why they are behind.
 *
 * ## The rules, and why each one is the shape it is
 *
 * Ordered, first match wins, because a plan can be several kinds of wrong at once and a
 * coach that says three things says nothing. The order is by how much the learner gains
 * from acting on it.
 *
 * Every threshold below is deliberately conservative. A suggestion the learner disagrees
 * with is worse than silence: it is a weekly interruption that teaches them the coach does
 * not understand their week. `hold` is a real answer and is expected to be the common one.
 */

/** The digest `get_plan_digest` returns. Numbers only — no prose reaches the chooser. */
export interface PlanDigest {
  readonly days: number
  /** Plans that exist in the window. Fewer than `days` means days with no plan at all. */
  readonly plans: number
  readonly days_finished: number
  readonly days_untouched: number
  readonly days_partial: number
  readonly items_planned: number
  readonly items_done: number
  readonly daily_minutes: number | null
  readonly new_cards_per_day: number | null
}

/** Closed set, mirroring `learning_plan_levers`. */
export type PlanLever =
  | 'lower_intake' | 'raise_intake' | 'shorten_session'
  | 'catch_up_week' | 'add_study_day' | 'hold'

export interface CoachSuggestion {
  readonly lever: PlanLever
  /**
   * The proposed value for the lever's dial, already clamped. `null` for levers that change
   * no setting — those are encouragement, not configuration.
   */
  readonly value: number | null
  /** Which numbers produced this, so the UI can say WHY without recomputing it. */
  readonly evidence: {
    readonly finishedDays: number
    readonly untouchedDays: number
    readonly partialDays: number
    readonly completion: number
    readonly windowDays: number
  }
}

/** The floors and ceilings the RPCs already enforce; the coach must never propose past them. */
const MIN_NEW_CARDS = 0
const MAX_NEW_CARDS = 999
const MIN_MINUTES = 5
const MAX_MINUTES = 1440

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Pick at most one change. Returns `hold` when nothing is worth saying.
 *
 * `null` when the window holds too little to judge — fewer than four plans is not a week,
 * and guessing from two days is how a coach loses the learner's trust in one sentence.
 */
export function planCoach(digest: PlanDigest): CoachSuggestion | null {
  const {
    plans, days_finished: finished, days_untouched: untouched, days_partial: partial,
    items_planned: planned, items_done: done, daily_minutes: minutes,
    new_cards_per_day: intake, days,
  } = digest

  if (plans < 4) return null

  const completion = planned > 0 ? done / planned : 0
  const evidence = {
    finishedDays: finished, untouchedDays: untouched, partialDays: partial,
    completion, windowDays: days,
  }

  // 1. Not opened at all on most days. Nothing about the plan's SIZE is the problem when it
  //    is not being started — telling someone to do less on days they do nothing is noise.
  //    Consistency first.
  if (untouched >= Math.ceil(plans * 0.6)) {
    return { lever: 'add_study_day', value: null, evidence }
  }

  // 2. Started most days, finished few. The day is too big to complete, and a day that is
  //    never finished stops feeling finishable — so shrink the SESSION, not the intake:
  //    intake governs tomorrow's reviews, the budget governs today's length.
  if (partial >= Math.ceil(plans * 0.5) && completion < 0.6 && minutes !== null) {
    return {
      lever: 'shorten_session',
      value: clamp(Math.round(minutes * 0.7), MIN_MINUTES, MAX_MINUTES),
      evidence,
    }
  }

  // 3. Finishing less than half of what was planned, across the window. This is the intake
  //    being too high: every new card becomes several reviews within days, so the only
  //    change that shrinks TOMORROW without abandoning anything is fewer new cards.
  //    Refused when intake is already 0 — there is nothing left to lower.
  if (completion < 0.5 && intake !== null && intake > MIN_NEW_CARDS) {
    return {
      lever: 'lower_intake',
      value: clamp(Math.floor(intake * 0.6), MIN_NEW_CARDS, MAX_NEW_CARDS),
      evidence,
    }
  }

  // 4. A backlog from an absence, but the learner is back and finishing days. Nothing needs
  //    changing permanently; say so, because the alternative is a learner who sees a big
  //    number and concludes they have failed.
  if (untouched >= 2 && finished >= Math.ceil(plans * 0.5)) {
    return { lever: 'catch_up_week', value: null, evidence }
  }

  // 5. Finishing everything, every day, with the intake below its ceiling. This is the only
  //    suggestion that makes the plan HARDER, and it is gated hardest: every single plan in
  //    the window finished, nothing untouched.
  if (finished === plans && untouched === 0 && intake !== null && intake < MAX_NEW_CARDS) {
    return {
      lever: 'raise_intake',
      value: clamp(Math.ceil(intake * 1.3) + 1, MIN_NEW_CARDS, MAX_NEW_CARDS),
      evidence,
    }
  }

  return { lever: 'hold', value: null, evidence }
}
