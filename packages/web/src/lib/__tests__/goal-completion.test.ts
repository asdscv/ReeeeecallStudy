/**
 * goalCompletion — the rule that lets a learning plan finish, and the date it projects.
 *
 * Nothing in the app could answer "이 플랜 언제 완료돼?" before this: the status value existed,
 * the transition was permitted, the `target` column was created for it, and no code ever made
 * the decision. These cases pin the rule and, more importantly, the edges the rule has to
 * survive — which is where the design was decided.
 */
import { describe, it, expect } from 'vitest'
import {
  goalCompletion, COMPLETION_RATIO, MATURE_INTERVAL_DAYS,
  DAYS_FROM_RUNG_1, DAYS_FROM_RUNG_3, DAYS_FROM_RUNG_8,
} from '@reeeeecall/shared/lib/goal-completion'

const counts = (over: Partial<Parameters<typeof goalCompletion>[0]> = {}) =>
  ({ total: 0, mature: 0, unseen: 0, rung1: 0, rung3: 0, rung8: 0, ...over })

describe('the ladder constants', () => {
  it('reads the waiting time off the scheduler own ladder', () => {
    // [1, 3, 8, 21, ...]. A card at rung 8 waits 8 days and THAT review sets 21, so the
    // remaining time is the rungs it still sits through, not the rungs it still climbs.
    expect(MATURE_INTERVAL_DAYS).toBe(21)
    expect(DAYS_FROM_RUNG_8).toBe(8)
    expect(DAYS_FROM_RUNG_3).toBe(11)
    expect(DAYS_FROM_RUNG_1).toBe(12)
  })
})

describe('goalCompletion — the rule', () => {
  it('requires 80% of the cards to be mature', () => {
    expect(COMPLETION_RATIO).toBe(0.8)
    expect(goalCompletion(counts({ total: 10, mature: 8 })).earned).toBe(true)
    expect(goalCompletion(counts({ total: 10, mature: 7, rung8: 3 })).earned).toBe(false)
  })

  it('makes a tiny goal require every card, and that is correct', () => {
    // 2/2, 3/3, 4/4 — the ratio does not round in the learner's favour. Three of four cards
    // known is not a finished goal, and any absolute slack ("all but two") would complete a
    // two-card goal at zero cards learned.
    expect(goalCompletion(counts({ total: 2, mature: 1, rung8: 1 })).required).toBe(2)
    expect(goalCompletion(counts({ total: 3, mature: 2, rung8: 1 })).required).toBe(3)
    expect(goalCompletion(counts({ total: 4, mature: 3, rung8: 1 })).required).toBe(4)
    // From five up the slack begins.
    expect(goalCompletion(counts({ total: 5, mature: 4, rung8: 1 })).earned).toBe(true)
  })

  it('refuses to call an empty goal complete', () => {
    // 0/0 is not 100%. There is nothing to have learned, and stamping it would turn "you have
    // not added a deck yet" into a finish line.
    const out = goalCompletion(counts({ total: 0, mature: 0 }))

    expect(out.earned).toBe(false)
    expect(out.percent).toBe(0)
    expect(out.daysToComplete).toBeNull()
  })
})

describe('goalCompletion — the projected date', () => {
  it('takes the cards nearest to mature first', () => {
    // Needs 8 of 10. Has 6 mature, and two cards one review from maturing — so eight days,
    // not the twelve the cards further down would cost.
    const out = goalCompletion(counts({ total: 10, mature: 6, rung8: 2, rung1: 5 }))

    expect(out.remaining).toBe(2)
    expect(out.daysToComplete).toBe(DAYS_FROM_RUNG_8)
  })

  it('is decided by the furthest card it actually needs', () => {
    // Needs 2 more but only one is close, so the second comes off the bottom rung.
    const out = goalCompletion(counts({ total: 10, mature: 6, rung8: 1, rung3: 1 }))

    expect(out.daysToComplete).toBe(DAYS_FROM_RUNG_3)
  })

  it('waits for unseen cards to be introduced before they can climb', () => {
    // 20 unseen, 5 needed, intake 2/day: the last one starts on day 2 (batches on days 0, 1, 2)
    // and then climbs for twelve.
    const out = goalCompletion(
      counts({ total: 100, mature: 75, unseen: 20 }),
      { newCardsPerDay: 2 },
    )

    expect(out.remaining).toBe(5)
    expect(out.daysToComplete).toBe(2 + DAYS_FROM_RUNG_1)
  })

  it('says nothing rather than guessing when intake is uncapped', () => {
    // "Start 400 cards at once" has no honest day count, and inventing one is worse than a
    // blank: a wrong date is acted on, a missing date is not.
    expect(goalCompletion(counts({ total: 100, mature: 0, unseen: 100 }), {}).daysToComplete)
      .toBeNull()
  })

  it('says nothing when the goal cannot reach the ratio at all', () => {
    // Fewer cards in the goal than the rule needs — nothing to project.
    expect(goalCompletion(counts({ total: 10, mature: 0, rung8: 1 })).daysToComplete).toBeNull()
  })

  it('stretches the estimate by what the learner actually does', () => {
    // Someone completing half of each day's plan takes about twice as long. Claiming the
    // planned date anyway produces the one thing worse than no date: a confident wrong one.
    const onPlan = goalCompletion(counts({ total: 10, mature: 6, rung8: 2 }), { adherence: 1 })
    const halfPlan = goalCompletion(counts({ total: 10, mature: 6, rung8: 2 }), { adherence: 0.5 })

    expect(onPlan.daysToComplete).toBe(DAYS_FROM_RUNG_8)
    expect(halfPlan.daysToComplete).toBe(DAYS_FROM_RUNG_8 * 2)
  })

  it('never shortens the estimate for someone who does MORE than planned', () => {
    // Adherence above 1 means extra sessions, and extra sessions do not compress the calendar:
    // a card at rung 8 is due in eight days no matter how many other cards were studied today.
    expect(goalCompletion(counts({ total: 10, mature: 6, rung8: 2 }), { adherence: 3 }).daysToComplete)
      .toBe(DAYS_FROM_RUNG_8)
  })

  it('ignores an adherence figure it cannot use', () => {
    for (const adherence of [null, undefined, 0, Number.NaN, -1]) {
      expect(goalCompletion(counts({ total: 10, mature: 6, rung8: 2 }), { adherence }).daysToComplete)
        .toBe(DAYS_FROM_RUNG_8)
    }
  })

  it('projects nothing once the goal is already earned', () => {
    const out = goalCompletion(counts({ total: 10, mature: 9 }))

    expect(out.earned).toBe(true)
    expect(out.remaining).toBe(0)
    expect(out.daysToComplete).toBeNull()
  })
})
