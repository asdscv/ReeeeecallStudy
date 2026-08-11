/**
 * 오늘 몫은 끝났어요 — what to say when there is nothing due.
 *
 * The screen used to say 「오늘 이 덱들에서 복습할 카드가 없습니다」 and a learner read it, quite
 * reasonably, as "the app lost my cards". They had just finished all twelve of today's items
 * and pressed 더 하기; twelve of their cards were sitting in 1- and 10-minute learning steps,
 * due back within the hour. The sentence was true about the instant and false about the
 * situation, and the card directly above it was simultaneously claiming twelve reviews were
 * overdue.
 *
 * "Nothing due" is three different situations wearing one sentence, and only one of them is
 * bad news:
 *
 *   - the next card is minutes away — they are mid-session and should wait, not leave;
 *   - the next card is hours or days away — they are done, and the useful fact is WHEN;
 *   - nothing is scheduled at all — the goal has run out of material, which is the only one
 *     of the three that needs the learner to do something.
 *
 * Pure, and returns a shape rather than a string, so the two screens phrase it in their own
 * locale files and neither has to re-derive which case it is in.
 */

export type CaughtUpKind =
  /** Cards return within the hour. Mid-session: the honest advice is to wait. */
  | 'soon'
  /** Cards return later. `atISO` is when. */
  | 'later'
  /** Nothing is scheduled. The goal needs new material, not patience. */
  | 'empty'

export interface CaughtUp {
  kind: CaughtUpKind
  /** The soonest review still ahead, ISO. Null when `kind` is `empty`. */
  atISO: string | null
  /** Whole minutes until `atISO`, rounded up, floored at 1. Null when `empty`. */
  minutes: number | null
}

/** Anything returning inside this window is "잠시 뒤", not a date. */
export const SOON_MINUTES = 60

export function caughtUp(
  nextDueAtISO: string | null | undefined,
  nowISO: string,
): CaughtUp {
  const at = nextDueAtISO ? Date.parse(nextDueAtISO) : Number.NaN
  const now = Date.parse(nowISO)
  if (!Number.isFinite(at) || !Number.isFinite(now)) {
    return { kind: 'empty', atISO: null, minutes: null }
  }

  // Already past. Treated as `soon` rather than as a negative wait: the row IS due, so the
  // caller is about to be handed work, and "0분 뒤" is a truthful floor for that.
  const minutes = Math.max(1, Math.ceil((at - now) / 60_000))
  return {
    kind: minutes <= SOON_MINUTES ? 'soon' : 'later',
    atISO: nextDueAtISO ?? null,
    minutes,
  }
}
