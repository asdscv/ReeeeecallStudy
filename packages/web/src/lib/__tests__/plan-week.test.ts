/**
 * The week strip's reading of a week.
 *
 * This is the section that exists to make the plan screen not blank, so its failure mode is
 * the opposite of the coach's: the coach is dangerous when it says something wrong, and this
 * is dangerous when it says something FLATTERING. A strip that colours an untouched day as
 * studied, or a streak that survives a gap, turns the one honest thing on the screen into
 * decoration — and a learner only has to catch it once.
 *
 * The streak rule is the one worth arguing with here rather than in production: today not
 * being active must not break it (the day is not over), but yesterday's gap must.
 */
import { describe, it, expect } from 'vitest'
import { planWeek, type PlanDay } from '@reeeeecall/shared/learning/application/plan-week'

/** Seven days ending 2026-08-11 (a Tuesday), so weekday assertions are checkable by hand. */
const DATES = [
  '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08',
  '2026-08-09', '2026-08-10', '2026-08-11',
]

const week = (cells: Array<Partial<PlanDay>>): PlanDay[] =>
  DATES.map((date, i) => ({
    date, planned: 0, done: 0, studied: 0, ...(cells[i] ?? {}),
  }))

const digest = (cells: Array<Partial<PlanDay>>, over: Record<string, unknown> = {}) => ({
  by_day: week(cells), days: 7, items_planned: 0, items_done: 0, ...over,
})

describe('planWeek', () => {
  it('returns null when the server sent no per-day data', () => {
    // An older server, or a rollback. The section must disappear rather than draw an empty
    // strip that reads as "you did nothing this week".
    expect(planWeek({ by_day: null })).toBeNull()
    expect(planWeek({ by_day: [] })).toBeNull()
    expect(planWeek(undefined)).toBeNull()
  })

  it('names each day by what actually happened on it', () => {
    const out = planWeek(digest([
      {},                                        // nothing at all
      { planned: 10, done: 0 },                  // a plan, never opened
      { planned: 10, done: 4 },                  // started
      { planned: 10, done: 10 },                 // finished
      { planned: 0, studied: 6 },                // studied with no plan
      { planned: 10, done: 0, studied: 3 },      // studied, no plan item completed
      { planned: 12, done: 0 },
    ]))!
    expect(out.days.map((d) => d.state)).toEqual([
      'none', 'untouched', 'partial', 'done', 'extra', 'partial', 'untouched',
    ])
  })

  it('counts a day studied outside a plan as a day they showed up', () => {
    // The plan-only aggregate cannot see this, and most study is this. A strip that greys it
    // out is telling a learner who studied that they did not.
    const out = planWeek(digest([{ studied: 4 }]))!
    expect(out.activeDays).toBe(1)
    expect(out.days[0].state).toBe('extra')
  })

  it('does not count an untouched plan as activity', () => {
    const out = planWeek(digest([{ planned: 10 }, { planned: 10 }]))!
    expect(out.activeDays).toBe(0)
    expect(out.streak).toBe(0)
  })

  describe('streak', () => {
    it('survives today being unfinished', () => {
      // 9am. Breaking the streak because the day has not happened yet is both wrong and the
      // fastest way to make a learner stop caring about it.
      const out = planWeek(digest([
        {}, {}, {}, { planned: 5, done: 5 }, { planned: 5, done: 5 }, { studied: 3 },
        { planned: 8, done: 0 },   // today, not started
      ]))!
      expect(out.streak).toBe(3)
    })

    it('counts today when today IS done', () => {
      const out = planWeek(digest([
        {}, {}, {}, {}, { planned: 5, done: 5 }, { studied: 2 }, { planned: 8, done: 8 },
      ]))!
      expect(out.streak).toBe(3)
    })

    it('stops at a real gap, not at today', () => {
      // Yesterday is empty. Whatever happened before it is a previous streak, not this one.
      const out = planWeek(digest([
        { planned: 5, done: 5 }, { planned: 5, done: 5 }, { planned: 5, done: 5 },
        { planned: 5, done: 5 }, {}, { studied: 3 }, {},
      ]))!
      expect(out.streak).toBe(1)
    })

    it('is 0 when the last two days are both empty', () => {
      const out = planWeek(digest([
        { planned: 5, done: 5 }, { planned: 5, done: 5 }, {}, {}, {}, {}, {},
      ]))!
      expect(out.streak).toBe(0)
    })

    it('can be the whole window', () => {
      const out = planWeek(digest(DATES.map(() => ({ planned: 5, done: 5 }))))!
      expect(out.streak).toBe(7)
      expect(out.activeDays).toBe(7)
    })
  })

  it('reads the weekday locally, not from a UTC parse', () => {
    // `new Date('2026-08-11')` is UTC midnight, which is Aug 10 for every learner west of
    // Greenwich — the strip's letters would be off by one for all of them.
    const out = planWeek(digest([]))!
    expect(out.days.map((d) => d.weekday)).toEqual([3, 4, 5, 6, 0, 1, 2])  // Wed → Tue
  })

  it('leaves completion unanswerable when nothing was planned', () => {
    // 0% to someone who was never given a plan reads as a grade for a test they did not sit.
    expect(planWeek(digest([{ studied: 5 }]))!.completion).toBeNull()
  })

  it('reports completion as a share of what was planned', () => {
    const out = planWeek(digest([{ planned: 10, done: 4 }], {
      items_planned: 10, items_done: 4,
    }))!
    expect(out.completion).toBeCloseTo(0.4)
  })

  it('never reports more than complete', () => {
    // `completed_items` can exceed `total_items` — extending a plan moves both, and a study
    // session can complete an item the plan no longer counts. 130% is not a thing to render.
    const out = planWeek(digest([{ planned: 10, done: 13 }], {
      items_planned: 10, items_done: 13,
    }))!
    expect(out.completion).toBe(1)
  })

  it('carries the window length so the copy can name it', () => {
    expect(planWeek(digest([]))!.windowDays).toBe(7)
  })
})
