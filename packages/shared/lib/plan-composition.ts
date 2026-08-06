/**
 * What a day's plan is made of: cards coming back, and cards never studied.
 *
 * ## Why this exists at all
 *
 * Both plan screens used to print the whole day, one row per card, each row carrying the
 * planner's reason, its recall estimate and its minute cost. Thirty rows of scroll above the
 * buttons, nothing on any of them to tap, every row reading the same phrase, and the numbers
 * frozen at the moment the planner ran — stale for anyone returning mid-day.
 *
 * The question that list was actually answering is "what am I in for?", and thirty reviews and
 * thirty new cards are the same number and nothing like the same evening. That is one line.
 *
 * ## Why it is shared rather than written twice
 *
 * Web and mobile print the same sentence from the same plan, so a split computed separately on
 * each would be two chances to disagree — and disagreeing about how much work today holds is
 * exactly the kind of drift a learner reads as the app being wrong. One function, one test.
 */

/** The fields of a `daily_plan_items` row this needs. Deliberately structural. */
export interface PlanCompositionItem {
  status: string
  payload?: { recall_probability?: number } | null
}

export interface PlanComposition {
  /** Pending cards the learner has studied before. */
  review: number
  /** Pending cards with no forgetting curve yet — never studied. */
  fresh: number
}

/**
 * Split the work still PENDING in a plan.
 *
 * Completed items are excluded: they are no longer something the learner is "in for", and
 * counting them would leave the line describing a morning that has already happened while the
 * count beside it describes what is left.
 *
 * "New" is `recall_probability` being ABSENT, which is precisely when the planner found no
 * forgetting curve for the card (see where it writes the payload in learning-store). A card
 * estimated at `0` has been studied and forgotten — the opposite of new — so the check must be
 * `== null` and never a truthiness test, which would file every forgotten card under "new".
 */
export function planComposition(items: readonly PlanCompositionItem[]): PlanComposition {
  let review = 0
  let fresh = 0
  for (const item of items) {
    if (item.status === 'completed') continue
    if (item.payload?.recall_probability == null) fresh += 1
    else review += 1
  }
  return { review, fresh }
}
