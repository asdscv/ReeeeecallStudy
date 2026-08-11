/**
 * 이번 주, 한 줄로.
 *
 * The learning plan screen had five sections and every one of them was allowed to render
 * nothing. That is defensible per section — none of them has anything TRUE to say in the
 * state it hides in — and collectively it meant the screen was blank for a learner who had
 * not studied yet today. Which is every learner, at the moment they open the app to decide
 * whether to study.
 *
 * This is the thing that is always true: the last seven days happened. It needs no model, no
 * minimum history, and no judgement — a learner on day one has a week with one day in it, and
 * that is a legitimate thing to show them.
 *
 * Deliberately NOT a coach. `plan-coach.ts` decides whether something should CHANGE and stays
 * quiet when nothing should; this only reports. Keeping them apart is what lets the strip be
 * unconditional without the app nagging every time it appears.
 */

/** One cell. `planned`/`done` are the plan's own counters; `studied` is cards actually touched. */
export interface PlanDay {
  /** `YYYY-MM-DD`, local to the learner's zone — the server has already resolved it. */
  date: string
  planned: number
  done: number
  studied: number
}

export type DayState =
  /** No plan and no study. Nothing happened. */
  | 'none'
  /** A plan existed and was never opened. */
  | 'untouched'
  /** Started, not finished — or studied without finishing a plan item. */
  | 'partial'
  /** Every planned item done. */
  | 'done'
  /** Studied with no plan for that day. Real work the plan-only view cannot see. */
  | 'extra'

/**
 * Not exported: `PlanWeek['days']` already carries this shape structurally, and the kernel's
 * dead-export gate is right that a name nothing reads is an API nobody asked for.
 */
interface WeekDay extends PlanDay {
  state: DayState
  /** 0 = Sunday. Computed without `Intl`, which Hermes does not carry. */
  weekday: number
}

export interface PlanWeek {
  days: WeekDay[]
  /** Days with any activity at all — the number the headline is about. */
  activeDays: number
  windowDays: number
  /**
   * Consecutive active days ending now. Today NOT being active does not break it: the day is
   * not over, and telling someone their streak is 0 at 9am is both wrong and the most
   * effective way to make them stop caring about it.
   */
  streak: number
  /** Planned items actually completed, 0–1, or null when the window planned nothing. */
  completion: number | null
}

/** The digest fields this reads. A superset of it is what `get_plan_digest` returns. */
export interface WeekDigest {
  by_day?: PlanDay[] | null
  days?: number
  items_planned?: number
  items_done?: number
}

function stateOf(day: PlanDay): DayState {
  if (day.planned > 0) {
    if (day.done >= day.planned) return 'done'
    // Study that completed no plan item is still a day they showed up. `done` counts plan
    // items, and a learner who opened a deck instead of the plan did not do nothing.
    if (day.done > 0 || day.studied > 0) return 'partial'
    return 'untouched'
  }
  return day.studied > 0 ? 'extra' : 'none'
}

const ACTIVE: ReadonlySet<DayState> = new Set<DayState>(['done', 'partial', 'extra'])

/**
 * Day of week for a `YYYY-MM-DD` key, 0 = Sunday.
 *
 * Parsed by hand rather than `new Date(key)`, which reads a bare date as UTC midnight and so
 * returns the PREVIOUS day for every learner west of Greenwich.
 */
function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return 0
  return new Date(y, m - 1, d).getDay()
}

export function planWeek(digest: WeekDigest | null | undefined): PlanWeek | null {
  const raw = digest?.by_day
  if (!Array.isArray(raw) || raw.length === 0) return null

  const days: WeekDay[] = raw.map((d) => {
    const day: PlanDay = {
      date: String(d?.date ?? ''),
      planned: Number(d?.planned ?? 0) || 0,
      done: Number(d?.done ?? 0) || 0,
      studied: Number(d?.studied ?? 0) || 0,
    }
    return { ...day, state: stateOf(day), weekday: weekdayOf(day.date) }
  })

  const activeDays = days.filter((d) => ACTIVE.has(d.state)).length

  // Counted backwards from the end. The last day is allowed to be inactive exactly once —
  // that is today, still in progress — and after that any gap ends the run.
  let streak = 0
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (ACTIVE.has(days[i].state)) streak += 1
    else if (i === days.length - 1) continue
    else break
  }

  const planned = Number(digest?.items_planned ?? 0) || 0
  const done = Number(digest?.items_done ?? 0) || 0

  return {
    days,
    activeDays,
    windowDays: days.length,
    streak,
    // A ratio over nothing planned is not 0, it is unanswerable — and rendering 0% to
    // someone who has never been given a plan reads as a grade.
    completion: planned > 0 ? Math.min(1, done / planned) : null,
  }
}
