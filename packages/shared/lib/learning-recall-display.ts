// ─── Turning a recall probability into something a learner can read ──────────
//
// The memory model is the most defensible part of this engine and, until now, the least
// visible: a plan row asserted "at risk of forgetting" and showed no number. An estimate the
// learner cannot see is an estimate they cannot judge, and sophistication nobody perceives
// cannot be sold.
//
// This is deliberately tiny and shared. Both platforms must round the same way, or the same
// card reads 39% on web and 40% on mobile and the number stops looking like a measurement.
//
// There is deliberately NO "recompute it from the card" helper here. The tempting version reads
// `cards.interval_days` / `last_reviewed_at`, which on a subscribed or official deck belong to
// the PUBLISHER — the defect #389 fixed. The only trustworthy source is what the planner
// recorded when it chose the row, so a plan saved before that existed shows no number.

/**
 * A recall probability as whole percent, or null when there is nothing to show.
 *
 * Null in, null out — the whole point of the null discipline upstream is that "no forgetting
 * curve yet" reaches the screen as *no claim*, not as 0%. A new card showing "0% chance you
 * remember this" would be alarming and false.
 *
 * Rounded to whole percent because the underlying estimate does not support more: stability is
 * bridged from an SM-2 interval, which is a scheduler's guess, not a fitted measurement. One
 * decimal place would advertise a precision the input does not have.
 */
export function recallPercent(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(Math.min(1, Math.max(0, value)) * 100)
}
