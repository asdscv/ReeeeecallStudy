/**
 * 주 N일 설정이 실제로 무언가를 하는가.
 *
 * `settings.cadence` was written by the goal form and read by exactly two files — both of them
 * that same form, computing a projection. Nothing in the planning path had ever seen it. The
 * planner asked only "what is due today", so a goal set to seven days a week produced a plan on
 * six days out of twenty-nine and an empty screen on the rest.
 *
 * This is the function that makes the setting mean something: how far the DAILY plan may reach
 * to fill a session it could not fill from owed work. Someone who saved "every day" has already
 * said they intend to study every day; someone who saved three days a week has said the
 * opposite, and the reach follows.
 */
import { describe, it, expect } from 'vitest'
import { autoAheadDays } from '@reeeeecall/shared/stores/learning-store'
import { EVERY_DAY, parseCadence } from '@reeeeecall/shared/learning/application/cadence'

describe('autoAheadDays', () => {
  it('reaches a full week for someone who studies every day', () => {
    // The case the report was about. Seven days a week means the plan has to be able to make a
    // day, not just report that there is none.
    expect(autoAheadDays(EVERY_DAY)).toBe(7)
  })

  it('reaches less for someone who studies less', () => {
    // Three days a week has NOT consented to daily study. Manufacturing one every day would be
    // the app overriding a setting rather than honouring it.
    expect(autoAheadDays({ cycleDays: 7, studyDays: 3 })).toBe(3)
    expect(autoAheadDays({ cycleDays: 7, studyDays: 1 })).toBe(1)
  })

  it('never reaches zero days', () => {
    // A reach of zero cannot fill anything, so the top-up would silently do nothing and the
    // setting would be decoration again.
    expect(autoAheadDays({ cycleDays: 30, studyDays: 1 })).toBeGreaterThanOrEqual(1)
  })

  it('never reaches beyond a week', () => {
    // Past that a card is not "nearly due" by any reading, and pulling it forward is a
    // rescheduling the learner did not ask for. That reach stays behind an explicit press.
    expect(autoAheadDays({ cycleDays: 1, studyDays: 1 })).toBeLessThanOrEqual(7)
    expect(autoAheadDays({ cycleDays: 7, studyDays: 7 })).toBeLessThanOrEqual(7)
  })

  it('is monotonic in how often the learner studies', () => {
    // More sessions per cycle can never mean a shorter reach — that inversion is exactly the
    // mistake `perStudyDayMultiplier` warns about in its own docblock.
    let previous = 0
    for (const studyDays of [1, 2, 3, 4, 5, 6, 7]) {
      const days = autoAheadDays({ cycleDays: 7, studyDays })
      expect(days, `${studyDays}/7`).toBeGreaterThanOrEqual(previous)
      previous = days
    }
  })

  it('survives a goal with no cadence saved', () => {
    // Most rows predate the setting. `parseCadence` reads those as every-day, so an old goal
    // gets the daily behaviour rather than an unplannable one.
    expect(autoAheadDays(parseCadence({}))).toBe(7)
    expect(autoAheadDays(parseCadence(null))).toBe(7)
    expect(autoAheadDays(parseCadence({ cadence: 'nonsense' }))).toBe(7)
  })
})
