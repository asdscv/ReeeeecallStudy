/**
 * Taking the coach's advice must not undo the learner's schedule.
 *
 * `applyPlanCoach` posted `settings: { new_cards_per_day: value }`. `update_learning_goal`'s
 * body is `settings = COALESCE(p_settings, settings)` — a whole-object REPLACE, not a merge —
 * so accepting a suggestion deleted every other key in `settings`.
 *
 * The key that mattered is `cadence`. It is what decides whether a learner gets a plan every
 * day; a 주7일 goal that loses it silently reverts to the default schedule. So the flow was:
 * the coach says "fewer new cards a day", the learner agrees, and their week quietly collapses
 * back to the behaviour the cadence work existed to fix.
 *
 * And the value went to the wrong key anyway. Both goal forms and `parseNewCardsPerDay` use
 * `newCardsPerDay`; `new_cards_per_day` is read by nothing on the client. The learner accepted
 * a change, lost their schedule, and their intake stayed exactly where it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useLearningStore } from '@reeeeecall/shared/stores/learning-store'

const GOAL_ID = '11111111-1111-4111-8111-111111111111'

/** A goal configured the way the cadence work configures one. */
const goalWithCadence = (settings: Record<string, unknown>) => ({
  id: GOAL_ID, domain_id: 'language', title: '영어회화', target_date: null,
  daily_minutes: 20, status: 'active', target: {}, settings,
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
  decks: [],
})

/** An accepted `lower_intake` recommendation, as the coach writes one. */
const recommendation = {
  id: 'rec-1', goal_id: GOAL_ID, action_type: 'lower_intake',
  payload: { value: 5 }, status: 'pending',
}

let updateGoal: ReturnType<typeof vi.fn>
let resolveRecommendation: ReturnType<typeof vi.fn>

beforeEach(() => {
  updateGoal = vi.fn().mockResolvedValue(true)
  resolveRecommendation = vi.fn().mockResolvedValue(true)
  useLearningStore.setState({
    goals: [goalWithCadence({
      cadence: { cycleDays: 7, studyDays: 7 },
      newCardsPerDay: 10,
    })] as never,
    recommendations: [recommendation] as never,
    updateGoal,
    resolveRecommendation,
  } as never)
})

describe('accepting an intake lever', () => {
  it('keeps the cadence the learner saved', async () => {
    // The regression this whole test exists for. Losing `cadence` turns a 주7일 learner back
    // into someone who only gets a plan when something is due.
    await useLearningStore.getState().applyPlanCoach('rec-1')
    const settings = updateGoal.mock.calls[0][0].settings as Record<string, unknown>
    expect(settings.cadence).toEqual({ cycleDays: 7, studyDays: 7 })
  })

  it('writes the intake where the app actually reads it', async () => {
    await useLearningStore.getState().applyPlanCoach('rec-1')
    const settings = updateGoal.mock.calls[0][0].settings as Record<string, unknown>
    expect(settings.newCardsPerDay).toBe(5)
  })

  it('does not leave a stale snake_case value behind to fight the new one', async () => {
    useLearningStore.setState({
      goals: [goalWithCadence({
        cadence: { cycleDays: 7, studyDays: 7 },
        new_cards_per_day: 12,
      })] as never,
    } as never)
    await useLearningStore.getState().applyPlanCoach('rec-1')
    const settings = updateGoal.mock.calls[0][0].settings as Record<string, unknown>
    expect(settings.newCardsPerDay).toBe(5)
    expect(settings).not.toHaveProperty('new_cards_per_day')
  })

  it('keeps every other setting it does not understand', async () => {
    // The store must not become the authority on what `settings` may contain. A key added by a
    // later feature has to survive a coach acceptance made by an older client.
    useLearningStore.setState({
      goals: [goalWithCadence({
        cadence: { cycleDays: 7, studyDays: 3 },
        somethingElse: { kept: true },
      })] as never,
    } as never)
    await useLearningStore.getState().applyPlanCoach('rec-1')
    const settings = updateGoal.mock.calls[0][0].settings as Record<string, unknown>
    expect(settings.somethingElse).toEqual({ kept: true })
    expect(settings.cadence).toEqual({ cycleDays: 7, studyDays: 3 })
  })

  it('still records the learner\'s answer', async () => {
    await useLearningStore.getState().applyPlanCoach('rec-1')
    expect(resolveRecommendation).toHaveBeenCalledWith('rec-1', 'accepted')
  })

  it('changes the goal\'s minutes, not its settings, for a duration lever', async () => {
    // `shorten_session` turns a different dial. Routing it through the settings path would
    // rewrite `settings` for a lever that has no business touching it.
    useLearningStore.setState({
      recommendations: [{ ...recommendation, action_type: 'shorten_session' }] as never,
    } as never)
    await useLearningStore.getState().applyPlanCoach('rec-1')
    expect(updateGoal).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: GOAL_ID, dailyMinutes: 5 }),
    )
    expect(updateGoal.mock.calls[0][0]).not.toHaveProperty('settings')
  })

  it('touches no setting at all for a lever that configures nothing', async () => {
    // `catch_up_week` is encouragement. Accepting it records an answer and writes nothing.
    useLearningStore.setState({
      recommendations: [{ ...recommendation, action_type: 'catch_up_week' }] as never,
    } as never)
    await useLearningStore.getState().applyPlanCoach('rec-1')
    expect(updateGoal).not.toHaveBeenCalled()
    expect(resolveRecommendation).toHaveBeenCalledWith('rec-1', 'accepted')
  })
})
