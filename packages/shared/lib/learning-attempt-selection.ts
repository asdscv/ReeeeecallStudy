// ─── Which attempt a remediation request should be grounded in ───────────────
//
// A paid AI request that says "explain why I keep missing this" needs ONE attempt id. Both
// platforms have to pick the same one, so the rule lives here as a pure function rather than
// twice in two screens.
//
// It is deliberately not in the store: the store must never guess an attempt for a paid call
// (see the attempt-grounded-remediation design §5). A screen decides, using this rule, and
// passes the id explicitly.
import type { AttemptRow } from '../stores/learning-store'

/** An attempt at or above this normalized score is treated as "recalled it". */
export const KNOWN_SCORE_THRESHOLD = 0.75

const parseTime = (value: string): number => {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
}

/**
 * The learner's most recent attempt on `cardId`, or null when there is none.
 *
 * Newest by `created_at`; ties broken by descending id so the choice is deterministic when two
 * attempts share a timestamp (the column is `timestamptz` and two self-ratings inside the same
 * millisecond are possible on a fast client). An unparseable timestamp sorts LAST rather than
 * first — a row we cannot date must not win "most recent".
 */
export function latestAttemptForCard(
  attempts: readonly AttemptRow[],
  cardId: string | null | undefined,
): AttemptRow | null {
  if (!cardId) return null
  let best: AttemptRow | null = null
  let bestTime = Number.NEGATIVE_INFINITY
  for (const attempt of attempts) {
    if (attempt.card_id !== cardId) continue
    const time = parseTime(attempt.created_at)
    if (best === null || time > bestTime || (time === bestTime && attempt.id > best.id)) {
      best = attempt
      bestTime = time
    }
  }
  return best
}

/**
 * Is this attempt worth paying to have explained?
 *
 * Only a miss or a partial recall is. Offering paid remediation on an item the learner just
 * said they knew would be selling something with no premise — and `explain` on a success has
 * nothing to work with beyond the card, which the card-scoped button already covers.
 * A null score means the attempt was never evaluated; that is not evidence of a miss, so it
 * does not qualify either.
 */
export function attemptNeedsRemediation(attempt: AttemptRow | null | undefined): boolean {
  if (!attempt) return false
  const score = attempt.normalized_score
  return typeof score === 'number' && Number.isFinite(score) && score < KNOWN_SCORE_THRESHOLD
}
