/**
 * What the app tells a learner a quiz will cost.
 *
 * The billing rule is deliberately simple and stays that way: questions are the asset and are
 * paid for once, so retaking is free forever; grading is a fresh model call and is charged every
 * sitting; multiple choice is marked server-side for free, and only its optional AI explanation
 * is charged.
 *
 * What was missing was the TELLING. The grade button reads "이 답안 채점" with no price — a
 * deliberate choice, a button is a decision and not a price tag — but nothing else said anything
 * either, so the learner tapped it not knowing whether it was free. Measured on production
 * beforehand: a short answer is $0.01 and an essay $0.04, charged again on every retake.
 */
import { describe, it, expect } from 'vitest'
import { gradeCostLine, retakeNoteKey } from '@reeeeecall/shared/lib/quiz-pricing'

const quote = (over: Partial<Parameters<typeof gradeCostLine>[0] & object> = {}) => ({
  price_micro: 10_000, free_units: 0, trial_units: 0,
  free_remaining_today: 0, trial_remaining: 0, ...over,
})

describe('what grading costs', () => {
  it('names the amount in the wallet\'s own unit', () => {
    // Measured: grade_short is 2 units × 50,000 micro. The balance elsewhere reads "$499.60",
    // so a grade denominated any other way would be a second currency on the same screen.
    expect(gradeCostLine(quote())).toEqual({
      key: 'pricing.gradeCost', params: { amount: '$0.01' },
    })
    // grade_essay is 8 units — four times the price, and it has to say so.
    expect(gradeCostLine(quote({ price_micro: 40_000 }))!.params.amount).toBe('$0.04')
  })

  it('says nothing when the quote carries no price, rather than saying free', () => {
    // Grading has no free allowance any more: migration 233 gives `grade_*` zero free and zero
    // trial units, so a zero price is a quote with nothing to state, not a gift. The screen used
    // to read "무료로 채점돼요 · 27번 더 무료" off exactly this branch — the sentence the owner
    // asked to be removed — so the branch went with it.
    expect(gradeCostLine(quote({ price_micro: 0, free_units: 2, free_remaining_today: 8 }))).toBeNull()
    expect(gradeCostLine(quote({ price_micro: 0, trial_units: 2, trial_remaining: 12 }))).toBeNull()
  })

  it('says nothing at all without a quote', () => {
    // The button is disabled until the quote lands. A screen guessing a price is worse than a
    // screen that is briefly quiet.
    expect(gradeCostLine(null)).toBeNull()
    expect(gradeCostLine(undefined)).toBeNull()
  })
})

describe('what a retake costs', () => {
  it('promises nothing about charges on multiple choice, because there are none', () => {
    // Questions already paid for, grading done by string comparison. Saying "채점만 차감돼요"
    // here would invent a cost that does not exist.
    expect(retakeNoteKey('mcq')).toBe('pricing.retakeMcq')
  })

  it('warns on written answers, which really are charged every sitting', () => {
    expect(retakeNoteKey('short')).toBe('pricing.retakeWritten')
    expect(retakeNoteKey('essay')).toBe('pricing.retakeWritten')
    // An unknown or missing type errs toward warning: telling someone it is free when it is not
    // is the failure that costs them money.
    expect(retakeNoteKey(null)).toBe('pricing.retakeWritten')
    expect(retakeNoteKey(undefined)).toBe('pricing.retakeWritten')
  })
})
