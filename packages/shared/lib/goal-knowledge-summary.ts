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
 *
 * ## Why the card names the total
 *
 * Reported next: "17장은 뭐고 12장은 뭐야". The card said "배운 17장 중 17장이 복습 주기 안에
 * 있어요 / 아직 안 배움 12장" above a plan card saying "12장 남음", and nothing on screen said
 * that 17 + 12 = the goal's 29 cards, or that the 12 unstudied ARE today's 12. Two counts in the
 * same unit, drawn from different populations, with the population itself never named.
 *
 * Worse, the bar was full. `known / attempted` reaches 100% as soon as nothing is overdue, so a
 * goal 59% of the way through drew a complete bar. The ratio is `attempted / total` now, and the
 * headline — not the bar — carries whether the learner is behind.
 */

/** The shape `get_goal_knowledge` returns. */
export interface GoalKnowledgeCounts {
  total: number
  known: number
  unknown: number
  unseen: number
}

export interface GoalKnowledgeSummary {
  /** Every card the goal's decks hold. The anchor both numbers below are parts of. */
  total: number
  /** Cards with any review history — studied at least once, whatever state they are in now. */
  attempted: number
  /** Of `attempted`, how many are still inside their review window. */
  withinWindow: number
  /** Studied and past due — the work the learner is behind on. */
  overdue: number
  /** Never studied. */
  unstudied: number
  /**
   * How far through the goal's cards the learner has got: `attempted / total`, whole percent.
   *
   * Deliberately NOT `withinWindow / attempted`, which is what this used to be. That ratio hits
   * 100% the moment nothing is overdue — so a goal with 17 cards studied and 12 never opened
   * drew a full bar and read as finished. A progress bar may only fill when there is no card
   * left to reach; "nothing is overdue" is a different claim and the headline makes it.
   */
  percent: number
  /**
   * Reviews are past due. The one state the learner has to act on TODAY, so the headline leads
   * with it and everything else moves to the line below.
   */
  behind: boolean
  /**
   * Nothing has been studied yet, so there is no progress to report.
   *
   * A brand-new goal must read as "not started", never as a confident 0% — those are different
   * claims and only one of them is true.
   */
  notStarted: boolean
}

export function goalKnowledgeSummary(counts: GoalKnowledgeCounts): GoalKnowledgeSummary {
  const attempted = counts.known + counts.unknown
  return {
    total: counts.total,
    attempted,
    withinWindow: counts.known,
    overdue: counts.unknown,
    unstudied: counts.unseen,
    percent: counts.total > 0 ? Math.round((attempted / counts.total) * 100) : 0,
    behind: counts.unknown > 0,
    notStarted: attempted === 0,
  }
}
