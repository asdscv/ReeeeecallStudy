/**
 * goalCompletion — the rule that lets a learning plan finish, and the date it projects.
 *
 * Nothing in the app could answer "이 플랜 언제 완료돼?" before this: the status value existed,
 * the transition was permitted, the `target` column was created for it, and no code ever made
 * the decision. These cases pin the rule and, more importantly, the edges the rule has to
 * survive — which is where the design was decided.
 */
import { describe, it, expect } from 'vitest'
import { calculateSRS } from '@reeeeecall/shared/lib/srs'
import {
  goalCompletion, COMPLETION_RATIO, MATURE_INTERVAL_DAYS,
  DAYS_FROM_RUNG_1, DAYS_FROM_RUNG_3, DAYS_FROM_RUNG_8,
} from '@reeeeecall/shared/lib/goal-completion'

const counts = (over: Partial<Parameters<typeof goalCompletion>[0]> = {}) =>
  ({ total: 0, mature: 0, unseen: 0, rung1: 0, rung3: 0, rung8: 0, ...over })

describe('the maturity line', () => {
  it('is 21 days, the same line the rest of the app draws', () => {
    expect(MATURE_INTERVAL_DAYS).toBe(21)
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

describe('the rung costs come from the scheduler', () => {
  // These were constants summed off `INTERVALS_DAYS`, and the scheduler does not use that
  // ladder to decide WHEN a card is answered next — it grants `interval × ease` with a growth
  // cap. Every constant was one rung too long, because summing from the card's current rung
  // counts the interval it is already sitting in as time it still has to wait. A card the
  // planner is offering is due NOW.
  it('prices a card at interval 8 as one answer away, not eight days', () => {
    // The one that decided the estimate: `goalCompletion` spends the cheapest cards first, so
    // it was reaching past the rung that is actually free.
    expect(DAYS_FROM_RUNG_8).toBe(0)
  })

  it('prices the rungs below it by what the scheduler actually grants', () => {
    expect(DAYS_FROM_RUNG_3).toBe(8)
    expect(DAYS_FROM_RUNG_1).toBe(11)
  })

  it('agrees with a card walked through the scheduler from new', () => {
    // The whole point of deriving rather than declaring: if `calculateSRS` changes, this test
    // and the constants move together, and neither can quietly disagree with the other.
    let card = {
      srs_status: 'new' as const, interval_days: 0, ease_factor: 2.5, repetitions: 0,
    }
    let days = 0
    const reached: Record<string, number> = {}
    let matureAt = -1
    for (let i = 0; i < 40; i += 1) {
      const iv = card.interval_days
      if (iv >= 1 && iv < 3 && reached.r1 === undefined) reached.r1 = days
      if (iv >= 3 && iv < 8 && reached.r3 === undefined) reached.r3 = days
      if (iv >= 8 && iv < 21 && reached.r8 === undefined) reached.r8 = days
      if (iv >= 21) { matureAt = days; break }
      const n = calculateSRS(card, 'good')
      card = {
        srs_status: n.srs_status as typeof card.srs_status,
        interval_days: n.interval_days, ease_factor: n.ease_factor, repetitions: n.repetitions,
      }
      if (card.interval_days < 21) days += card.interval_days
    }

    expect(matureAt, 'a correct card never matured').toBeGreaterThanOrEqual(0)
    expect(DAYS_FROM_RUNG_1).toBe(matureAt - reached.r1)
    expect(DAYS_FROM_RUNG_3).toBe(matureAt - reached.r3)
    expect(DAYS_FROM_RUNG_8).toBe(matureAt - reached.r8)
  })

  it('a card answered correctly from new matures in under a fortnight', () => {
    // The sentence the screen makes — "다 맞히면 빨라야 N일" — has to be a number the
    // scheduler can actually produce.
    expect(DAYS_FROM_RUNG_1).toBeGreaterThan(0)
    expect(DAYS_FROM_RUNG_1).toBeLessThan(14)
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

  it('does not divide the wait by how much of the plan was done', () => {
    // A learner asked "완료까지 약 25일은 뭐야? 지금 29장밖에 안 되는데?" and the answer was
    // that 25 = 12 / 0.49 — twelve days of ladder waiting divided by a plan-adherence figure
    // printed in a different section under a different name. The deck's size was never in it.
    //
    // The division was not just unexplained, it was not a model of anything. Adherence is the
    // share of planned ITEMS completed over fourteen days; the rungs are how long a memory has
    // to rest. Skipping a plan item delays when a review is ANSWERED, which is a different
    // quantity from how long the card must WAIT, and the two do not multiply.
    const c = counts({ total: 10, mature: 6, rung8: 2 })

    // Whatever a caller passes, the answer is what the cards need.
    expect(goalCompletion(c).daysToComplete).toBe(DAYS_FROM_RUNG_8)
    expect(goalCompletion(c, { newCardsPerDay: 20 }).daysToComplete).toBe(DAYS_FROM_RUNG_8)
  })

  it('does not depend on how many cards are left, only on how far they have to climb', () => {
    // The other half of "29장밖에 안 되는데?". Cards climb the ladder in PARALLEL, so one card
    // and ten cards at the same rung finish on the same day. Deck size is not an input, and a
    // screen that implies otherwise invites the arithmetic the learner tried and failed to do.
    const one = goalCompletion(counts({ total: 10, mature: 7, rung1: 1 }))
    const many = goalCompletion(counts({ total: 100, mature: 70, rung1: 30 }))

    expect(one.daysToComplete).toBe(many.daysToComplete)
  })

  it('projects nothing once the goal is already earned', () => {
    const out = goalCompletion(counts({ total: 10, mature: 9 }))

    expect(out.earned).toBe(true)
    expect(out.remaining).toBe(0)
    expect(out.daysToComplete).toBeNull()
  })
})
