import { describe, it, expect } from 'vitest'
import { generateCostLine, freeLeftLine } from '@reeeeecall/shared/lib/quiz-pricing'

/**
 * The free allowance is only an allowance if the learner can see it.
 *
 * Since mig 239 it is five QUESTIONS a day whatever the type — the setup screen used to say
 * nothing at all unless the wallet was empty, so the only way to discover the limit was to be
 * charged for the sixth question.
 */
const quote = (over: Partial<Parameters<typeof generateCostLine>[0] & object> = {}) => ({
  count: 5,
  price_micro: 0,
  free_items: 5,
  trial_items: 0,
  paid_items: 0,
  free_items_limit: 5,
  free_items_remaining_today: 5,
  ...over,
})

describe('what generating costs', () => {
  it('says nothing is charged when the whole batch is free', () => {
    expect(generateCostLine(quote())).toEqual({ key: 'pricing.genAllFree', params: { free: 5 } })
  })

  it('counts the one-time trial as free, because the learner cannot tell them apart', () => {
    expect(generateCostLine(quote({ free_items: 0, trial_items: 3, count: 3 })))
      .toEqual({ key: 'pricing.genAllFree', params: { free: 3 } })
  })

  it('splits the sentence when the allowance runs out mid-batch', () => {
    // The boundary case, and the one a single "무료" or a single price would both misreport.
    expect(generateCostLine(quote({ count: 8, free_items: 5, paid_items: 3, price_micro: 450_000 })))
      .toEqual({ key: 'pricing.genPartlyFree', params: { free: 5, paid: 3, amount: '$0.45' } })
  })

  it('names the amount when nothing is free', () => {
    expect(generateCostLine(quote({ count: 4, free_items: 0, paid_items: 4, price_micro: 400_000 })))
      .toEqual({ key: 'pricing.genAllPaid', params: { paid: 4, amount: '$0.40' } })
  })

  it('says nothing at all without a quote', () => {
    expect(generateCostLine(null)).toBeNull()
    expect(generateCostLine(undefined)).toBeNull()
  })
})

describe("what is left of today's free questions", () => {
  it('reports the remainder against the limit', () => {
    expect(freeLeftLine(quote({ free_items_remaining_today: 2 })))
      .toEqual({ key: 'pricing.genFreeLeft', params: { left: 2, limit: 5 } })
  })

  it('says nothing to a tier that never had free questions', () => {
    // "0 left" implies there were some. A paid-only tier should not be told it ran out.
    expect(freeLeftLine(quote({ free_items_limit: 0, free_items_remaining_today: 0 }))).toBeNull()
  })

  it('never reports a negative remainder', () => {
    expect(freeLeftLine(quote({ free_items_remaining_today: -3 }))!.params.left).toBe(0)
  })
})
