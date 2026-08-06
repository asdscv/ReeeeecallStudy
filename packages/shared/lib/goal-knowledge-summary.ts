/**
 * Where a goal stands, in numbers that mean what they say.
 *
 * ## What the three counts actually are
 *
 * `get_goal_knowledge` (mig 181) does not measure mastery. It compares dates:
 *
 *   * `unseen`  — `last_reviewed_at IS NULL`. Never studied.
 *   * `known`   — studied, and `now <= last_reviewed_at + interval_days · k`. NOT past due.
 *   * `unknown` — studied, and past due.
 *
 * So `known` means "still inside its review window", and one rating on an overdue card moves it
 * there. The screens used to call that "확실" / "solid" and headline it as "29장 중 1장 기억",
 * which reads as "you have forgotten 28 cards" when what it says is "18 reviews are overdue and
 * 10 cards were never started". The learner who reported it had studied exactly one card and
 * could not make the numbers mean anything — correctly, because the words were not describing
 * the measurement.
 *
 * ## Why the arithmetic is here and not in each screen
 *
 * Three surfaces render this: the plan page, the mobile plan screen, and the dashboard widget.
 * They had already drifted — the widget drew `known / total` while the plan page drew
 * `known / attempted`, so the same goal showed 3% in one place and 5% in the other from one
 * RPC's numbers. One function, one ratio.
 */

/** The shape `get_goal_knowledge` returns. */
export interface GoalKnowledgeCounts {
  total: number
  known: number
  unknown: number
  unseen: number
}

export interface GoalKnowledgeSummary {
  /** Cards with any review history. The denominator: never-studied cards are not evidence. */
  attempted: number
  /** Of `attempted`, how many are still inside their review window. */
  withinWindow: number
  /** Studied and past due — the work the learner is behind on. */
  overdue: number
  /** Never studied. */
  unstudied: number
  /** `withinWindow / attempted` as a whole percent, or 0 when nothing has been studied. */
  percent: number
  /**
   * Nothing has been studied yet, so the ratio has no meaning.
   *
   * A brand-new goal must read as "not started", never as a confident 0% — those are different
   * claims and only one of them is true.
   */
  notStarted: boolean
}

export function goalKnowledgeSummary(counts: GoalKnowledgeCounts): GoalKnowledgeSummary {
  const attempted = counts.known + counts.unknown
  return {
    attempted,
    withinWindow: counts.known,
    overdue: counts.unknown,
    unstudied: counts.unseen,
    percent: attempted > 0 ? Math.round((counts.known / attempted) * 100) : 0,
    notStarted: attempted === 0,
  }
}
