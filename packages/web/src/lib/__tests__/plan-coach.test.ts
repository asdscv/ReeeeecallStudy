/**
 * The plan coach's judgement.
 *
 * This is the whole feature. The RPC stores a row and the screen renders a sentence, but
 * WHICH lever gets chosen is the product — and it is a pure function of a digest, so it can
 * be argued with here rather than discovered by a learner.
 *
 * Every case below is a week someone could actually have. The ones that assert `hold` and
 * `null` matter most: a coach that always finds something wrong is a weekly interruption
 * that teaches the learner it does not understand their week.
 */
import { describe, it, expect } from 'vitest'
import { planCoach, type PlanDigest } from '@reeeeecall/shared/learning/application/plan-coach'

const week = (over: Partial<PlanDigest> = {}): PlanDigest => ({
  days: 7,
  plans: 7,
  days_finished: 0,
  days_untouched: 0,
  days_partial: 0,
  items_planned: 70,
  items_done: 70,
  daily_minutes: 20,
  new_cards_per_day: 10,
  ...over,
})

describe('planCoach', () => {
  it('refuses to judge a window that is not a week', () => {
    // Three plans is not evidence. Guessing from it is how a coach loses trust in one
    // sentence, and the learner has no way to tell it was guessing.
    expect(planCoach(week({ plans: 3, days_finished: 0, days_partial: 3, items_done: 5 })))
      .toBeNull()
  })

  it('says nothing is wrong when nothing is wrong', () => {
    // Finishing most days, some slack. `hold` is a real answer and should be the common one.
    const out = planCoach(week({ days_finished: 5, days_partial: 2, items_done: 60 }))
    expect(out?.lever).toBe('hold')
    expect(out?.value).toBeNull()
  })

  it('asks for consistency, not a smaller day, when the app is not being opened', () => {
    // Five of seven days untouched. Telling someone to do LESS on days they do NOTHING is
    // noise — the plan's size is not what is failing.
    const out = planCoach(week({ days_untouched: 5, days_partial: 1, days_finished: 1, items_done: 12 }))
    expect(out?.lever).toBe('add_study_day')
    expect(out?.value).toBeNull()
  })

  it('shortens the session when days are started but not finished', () => {
    // The day is too long to complete. Shrink today's LENGTH, not tomorrow's intake.
    const out = planCoach(week({ days_partial: 5, days_finished: 1, days_untouched: 1, items_done: 30 }))
    expect(out?.lever).toBe('shorten_session')
    expect(out?.value).toBe(14)   // 20 * 0.7
  })

  it('lowers intake when the week as a whole is unfinishable', () => {
    // Not the "started but stopped" shape — spread thin across the week. Every new card
    // becomes several reviews within days, so intake is the dial that shrinks TOMORROW.
    const out = planCoach(week({
      days_finished: 2, days_partial: 3, days_untouched: 2, items_done: 30,
    }))
    expect(out?.lever).toBe('lower_intake')
    expect(out?.value).toBe(6)    // floor(10 * 0.6)
  })

  it('will not lower an intake that is already zero', () => {
    // There is nothing left to turn down; suggesting it would be a button that does nothing.
    const out = planCoach(week({
      days_finished: 2, days_partial: 3, days_untouched: 2, items_done: 30,
      new_cards_per_day: 0,
    }))
    expect(out?.lever).not.toBe('lower_intake')
  })

  it('reassures a learner who came back and is finishing days', () => {
    const out = planCoach(week({ days_untouched: 2, days_finished: 5, items_done: 55 }))
    expect(out?.lever).toBe('catch_up_week')
    expect(out?.value).toBeNull()
  })

  it('only raises intake on a perfect week', () => {
    const out = planCoach(week({ days_finished: 7, items_done: 70 }))
    expect(out?.lever).toBe('raise_intake')
    expect(out?.value).toBe(14)   // ceil(10 * 1.3) + 1

    // One untouched day is enough to withhold it. This is the only lever that makes the
    // plan HARDER, so it is gated hardest.
    expect(planCoach(week({ days_finished: 6, days_untouched: 1, items_done: 65 }))?.lever)
      .not.toBe('raise_intake')
  })

  it('never proposes a value outside what the RPCs accept', () => {
    // The apply path writes straight through to `update_learning_goal`, whose CHECKs would
    // reject an out-of-range number — as an error the learner would see, on a suggestion
    // they were invited to accept.
    const tiny = planCoach(week({
      days_partial: 5, days_finished: 1, days_untouched: 1, items_done: 30, daily_minutes: 5,
    }))
    expect(tiny?.value).toBeGreaterThanOrEqual(5)

    const huge = planCoach(week({ days_finished: 7, items_done: 70, new_cards_per_day: 998 }))
    expect(huge?.value).toBeLessThanOrEqual(999)
  })

  it('carries the evidence that produced it', () => {
    // The UI must be able to say WHY without recomputing, and a stored row has to stay
    // explainable months later.
    const out = planCoach(week({ days_partial: 5, days_finished: 1, days_untouched: 1, items_done: 30 }))
    expect(out?.evidence.partialDays).toBe(5)
    expect(out?.evidence.windowDays).toBe(7)
    expect(out?.evidence.completion).toBeCloseTo(30 / 70)
  })
})
