// ─── How much a deck matters to a goal ───────────────────────────────────────
//
// `learning_goal_decks.importance` (0..1) feeds the planner's `goalRelevance`, 0.20 of the
// ranking weight. Both clients hard-coded it to 0.5 with an honest comment — "there is no
// product concept for weighting a deck yet" — so a fifth of the ranking has been a constant for
// every learner since the feature shipped. This module is that missing concept.
//
// THREE LEVELS, NOT A SLIDER. A 0..1 slider would invite the learner to distinguish 0.61 from
// 0.63, and nothing downstream can honour that: importance is one of six features, and its whole
// span moves a card's score by at most 0.20. Three named levels say what the control can
// actually deliver.
//
// The values are 0.25 / 0.5 / 0.75, NOT 0 / 0.5 / 1. Two reasons:
//
//   1. 0.20 weight × a 0.5 span = 0.10 of final score — comparable to the entire range of the
//      other 0.10-weight features. That is a real effect without letting one choice dominate a
//      ranking built from six signals.
//   2. "Low priority" must not mean "never show me this". A learner who wants that removes the
//      deck from the goal, which is a different, reversible, and already-existing action. An
//      importance of 0 would silently bury cards they are still due to review.
export const DECK_PRIORITY_LEVELS = ['low', 'normal', 'high'] as const
export type DeckPriority = typeof DECK_PRIORITY_LEVELS[number]

/** The neutral level, and the value every existing goal was written with. */
export const DEFAULT_DECK_PRIORITY: DeckPriority = 'normal'

const IMPORTANCE_BY_PRIORITY: Readonly<Record<DeckPriority, number>> = {
  low: 0.25,
  normal: 0.5,
  high: 0.75,
}

/** The stored 0..1 value for a chosen level. */
export function importanceForPriority(priority: DeckPriority): number {
  return IMPORTANCE_BY_PRIORITY[priority] ?? IMPORTANCE_BY_PRIORITY[DEFAULT_DECK_PRIORITY]
}

/**
 * The level a stored value represents, for re-opening a goal.
 *
 * Nearest level rather than exact match, because the column is a free 0..1 numeric: a goal
 * written by an older client (always 0.5), by a future control with more levels, or by hand,
 * must still open on a sensible selection instead of falling back to `normal` and silently
 * discarding what the learner chose the moment they press save.
 *
 * A non-finite or out-of-range value is the one case that DOES fall back — there is nothing to
 * be near.
 */
export function priorityForImportance(importance: number | null | undefined): DeckPriority {
  if (typeof importance !== 'number' || !Number.isFinite(importance)) return DEFAULT_DECK_PRIORITY
  if (importance < 0 || importance > 1) return DEFAULT_DECK_PRIORITY
  let best: DeckPriority = DEFAULT_DECK_PRIORITY
  let bestDistance = Number.POSITIVE_INFINITY
  for (const level of DECK_PRIORITY_LEVELS) {
    const distance = Math.abs(IMPORTANCE_BY_PRIORITY[level] - importance)
    // Strictly less than, so an exact tie keeps the earlier (lower) level rather than depending
    // on iteration order — deterministic, and it never silently promotes a deck.
    if (distance < bestDistance) {
      best = level
      bestDistance = distance
    }
  }
  return best
}
