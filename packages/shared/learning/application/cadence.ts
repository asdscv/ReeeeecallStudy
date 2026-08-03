// ─── How often the learner actually studies ──────────────────────────────────
//
// Every schedule number in this app divides by "days remaining". That divisor is wrong for
// anyone who does not study seven days a week, and it is wrong in the direction that hurts:
// a learner who studies three days a week is told a daily amount they will meet on three days
// and miss on four, then falls behind on a plan that was never achievable.
//
// ## Why a cycle, and not "days per week"
//
// "Three times a week" is a 7-day idea. It cannot say "seven days out of ten" or "fifteen days
// a month", both of which are things people actually do — and storing an integer 1..7 is what
// forces a migration the first time someone asks. A cycle length plus a count inside it says all
// of them with the same two numbers and the same arithmetic:
//
//     three times a week      { cycleDays: 7,  studyDays: 3  }
//     seven days out of ten   { cycleDays: 10, studyDays: 7  }
//     fifteen days a month    { cycleDays: 30, studyDays: 15 }
//     every day               { cycleDays: 7,  studyDays: 7  }
//
// It is a QUOTA, not a timetable: "three days in any seven", not "Monday, Wednesday, Friday".
// The learner picks which days as they go, and the arithmetic below never needs to know. A
// fixed-weekday rule is a different question ("is TODAY a study day"), it has no caller yet, and
// adding it now would be a second concept with no reader — so it is deliberately absent.
//
// ## What this does NOT model
//
// Reviews come due on CALENDAR days. A card reviewed today is due in three days whether or not
// the learner studies then, so studying fewer days does not reduce the work — it concentrates
// the same work onto fewer sessions. That is exactly what `studyDaysBetween` expresses, and it
// is why the conversion is a divisor on the daily amount rather than a filter on the workload.
//
// It also means a card can come due on a day the learner skips and be answered late. The
// planner already treats overdue cards as more urgent, so late reviews surface rather than
// disappear; nothing here needs to model the drift.

/**
 * A study rhythm: `studyDays` out of every `cycleDays`.
 *
 * Both are whole days and `studyDays <= cycleDays`. The ratio is what the schedule math uses;
 * the pair is stored because "3 of 7" is what a person can read back and change, while `0.4286`
 * is not.
 */
export interface StudyCadence {
  readonly cycleDays: number
  readonly studyDays: number
}

/**
 * The default, and what every existing goal means.
 *
 * Goals created before this shipped have no cadence stored, and they were planned as if every
 * day were a study day — so this is not merely a convenient default, it is the truthful reading
 * of the rows already in the database.
 */
export const EVERY_DAY: StudyCadence = { cycleDays: 7, studyDays: 7 }

/** Longest cycle we will accept. A year-long cycle is not a rhythm, it is a typo. */
const MAX_CYCLE_DAYS = 90

/**
 * Read a cadence out of `learning_goals.settings`, which is untyped jsonb.
 *
 * Falls back to {@link EVERY_DAY} for anything it cannot read, and never throws. A malformed
 * settings blob must not make a goal unplannable: the cost of guessing wrong here is a daily
 * amount that is too small, while the cost of throwing is a learner who cannot open their plan.
 *
 * Zero study days is rejected rather than honoured. It would divide the schedule by zero, and
 * "I study zero days a week" is not a rhythm anyone means to save — pausing a goal is what
 * `learning_goals.status` is for.
 */
export function parseCadence(raw: unknown): StudyCadence {
  if (raw === null || typeof raw !== 'object') return EVERY_DAY
  const candidate = (raw as { cadence?: unknown }).cadence
  if (candidate === null || typeof candidate !== 'object') return EVERY_DAY

  const { cycleDays, studyDays } = candidate as { cycleDays?: unknown; studyDays?: unknown }
  if (!Number.isInteger(cycleDays) || !Number.isInteger(studyDays)) return EVERY_DAY

  const cycle = cycleDays as number
  const study = studyDays as number
  if (cycle < 1 || cycle > MAX_CYCLE_DAYS) return EVERY_DAY
  if (study < 1 || study > cycle) return EVERY_DAY

  return { cycleDays: cycle, studyDays: study }
}

/**
 * How many STUDY days fall in a span of calendar days.
 *
 * This is the divisor the whole schedule rests on: remaining work spread over the sessions that
 * will actually happen, rather than over the dates on a calendar.
 *
 * Fractional on purpose. Rounding here would compound — a 0.5-day error repeated across a
 * recompute every morning drifts — and every caller either divides by it (where a fraction is
 * correct) or rounds once for display (where rounding belongs).
 *
 * Returns 0 for a non-positive span, which is the honest answer to "how many study days are left
 * before a date that has passed". Callers must treat 0 as "no time remains" rather than dividing
 * by it; `targetDateFeasibility` in the schedule module is where that decision is made.
 */
export function studyDaysBetween(cadence: StudyCadence, calendarDays: number): number {
  if (!Number.isFinite(calendarDays) || calendarDays <= 0) return 0
  return calendarDays * (cadence.studyDays / cadence.cycleDays)
}

/**
 * The multiplier from a per-calendar-day amount to a per-study-day amount.
 *
 * The same total work compressed into fewer sessions makes each session bigger, by exactly the
 * inverse of the study ratio: three days in seven means each session carries 7/3 of what a daily
 * learner does. Kept as a named function because that inversion is the step people get backwards
 * — it is tempting to multiply by the ratio, which would shrink the sessions of someone who
 * studies less.
 */
export function perStudyDayMultiplier(cadence: StudyCadence): number {
  return cadence.cycleDays / cadence.studyDays
}

/**
 * Read the daily intake throttle out of `learning_goals.settings`.
 *
 * Returns `undefined` — not a number — when nothing is stored, and `undefined` is what the
 * planner reads as "uncapped". That is deliberate: every goal saved before this existed planned
 * without a cap, and inventing one now would silently change the plan of a goal whose owner
 * never asked for it. The default belongs in the form that creates a goal, where the learner can
 * see and change it, not in the reader that interprets old rows.
 *
 * Zero is honoured, unlike a zero cadence. "Start no new cards, just let me catch up" is a real
 * and useful state — it is what a learner buried in reviews should be able to ask for.
 */
export function parseNewCardsPerDay(raw: unknown): number | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const value = (raw as { newCardsPerDay?: unknown }).newCardsPerDay
  if (!Number.isInteger(value)) return undefined
  const n = value as number
  if (n < 0 || n > 9999) return undefined
  return n
}

/**
 * New cards to start per study day, for a goal that has not chosen a number.
 *
 * Twenty is what every mainstream spaced-repetition tool ships, and the arithmetic supports it:
 * each new card commits the learner to roughly seven reviews over the following year, so 20/day
 * settles at a few hundred reviews a day rather than climbing without bound.
 *
 * It lives here, next to the reader, but is deliberately NOT what `parseNewCardsPerDay` returns
 * for a goal with nothing stored. That function answers "what did this goal choose", and the
 * honest answer for an old row is "nothing" — applying a default there would silently cap plans
 * whose owners never asked for one. This constant is for the FORM, where the learner can see the
 * number and change it.
 */
export const DEFAULT_NEW_CARDS_PER_DAY = 20
