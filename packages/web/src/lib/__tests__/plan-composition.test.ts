/**
 * planComposition — the one sentence a plan screen says about the day ahead.
 *
 * It replaced a per-card list on both platforms, so it is now the ONLY thing telling a learner
 * what today holds beyond a bare count. Both screens call this same function: the drift these
 * cases guard against is not one screen breaking, it is the two of them quietly disagreeing
 * about how much work is left, which reads as the app being wrong about the learner's day.
 */
import { describe, it, expect } from 'vitest'
import { planComposition } from '@reeeeecall/shared/lib/plan-composition'

const item = (status: string, payload?: { recall_probability?: number } | null) =>
  ({ status, payload })

describe('planComposition', () => {
  it('splits pending work into reviews and cards never studied', () => {
    expect(planComposition([
      item('pending', { recall_probability: 0.9 }),
      item('pending', { recall_probability: 0.3 }),
      item('pending', {}),
    ])).toEqual({ review: 2, fresh: 1 })
  })

  it('counts what is left, not what the morning held', () => {
    // A finished item is no longer something the learner is "in for". Counting it would leave
    // the line describing a day that has already partly happened, beside a count that does not.
    expect(planComposition([
      item('completed', { recall_probability: 0.9 }),
      item('completed', {}),
      item('pending', { recall_probability: 0.4 }),
    ])).toEqual({ review: 1, fresh: 0 })
  })

  it('treats a recall estimate of zero as a review, not a new card', () => {
    // The single most likely way to get this wrong: `payload.recall_probability ? … : …` files
    // every thoroughly forgotten card under "new" — the exact opposite of what it is.
    expect(planComposition([item('pending', { recall_probability: 0 })]))
      .toEqual({ review: 1, fresh: 0 })
  })

  it('treats every shape of missing estimate as new', () => {
    // `save_daily_plan` writes `'{}'` by default, the planner omits the key when it has no
    // curve, and a plan written before the estimate existed has neither. All three are new.
    expect(planComposition([
      item('pending', {}),
      item('pending', null),
      item('pending', undefined),
      item('pending', { recall_probability: undefined }),
    ])).toEqual({ review: 0, fresh: 4 })
  })

  it('has nothing to say about an empty or fully finished plan', () => {
    expect(planComposition([])).toEqual({ review: 0, fresh: 0 })
    expect(planComposition([item('completed', { recall_probability: 0.5 })]))
      .toEqual({ review: 0, fresh: 0 })
  })

  it('ignores statuses other than completed', () => {
    // `daily_plan_items.status` is pending | completed today, but the screens count anything
    // not completed as work left. A future 'skipped' must not silently vanish from the line.
    expect(planComposition([item('skipped', { recall_probability: 0.5 })]))
      .toEqual({ review: 1, fresh: 0 })
  })
})
