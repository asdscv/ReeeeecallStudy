/**
 * Learning insights page.
 *
 * The assertion that matters: a learner with no scored attempts must NOT be shown 0%.
 * "You got everything wrong" and "you haven't answered anything yet" are different
 * sentences, and one `?? 0` in a template turns the second into the first.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

type StoreState = Record<string, unknown>

const { storeState } = vi.hoisted(() => ({ storeState: { current: {} as StoreState } }))

vi.mock('../../../stores/learning-store', () => ({
  useLearningStore: () => storeState.current,
}))

import { LearningInsightsPage } from '../LearningInsightsPage'

const goal = {
  id: 'goal-1', domain_id: 'language', title: 'JLPT N2', target_date: null,
  daily_minutes: 20, status: 'active', target: {}, settings: {},
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
  decks: [{ deck_id: 'deck-1', importance: 0.5 }],
}

const emptyInsights = {
  attemptCount: 0, scoredCount: 0, accuracy: null, medianDurationMs: null,
  weakCards: [], adherence: [], overallAdherence: null,
}

const renderPage = (over: StoreState = {}) => {
  storeState.current = {
    goals: [goal], goalsLoading: false, fetchGoals: vi.fn(),
    // `insightsGoalId` tags the numbers with the goal they describe. The page refuses to
    // render stats whose tag does not match the selected goal, so the harness must set it.
    insights: emptyInsights, insightsLoading: false, insightsGoalId: 'goal-1',
    insightsError: null, fetchInsights: vi.fn(),
    planCards: {},
    recommendations: [], recommendationBusyId: null,
    fetchRecommendations: vi.fn(), regenerateRecommendations: vi.fn(),
    resolveRecommendation: vi.fn(),
    ...over,
  }
  render(<MemoryRouter><LearningInsightsPage /></MemoryRouter>)
  return storeState.current
}

beforeEach(() => { vi.clearAllMocks() })

describe('LearningInsightsPage', () => {
  it('loads the diagnostics for the active goal on open', () => {
    const state = renderPage()

    expect(state.fetchGoals).toHaveBeenCalled()
    expect(state.fetchInsights).toHaveBeenCalledWith('goal-1')
  })

  it('will not show one goal\'s numbers under another goal\'s label', () => {
    // The loader resolved for a goal the learner has since switched away from. Showing those
    // stats would be the same class of lie as printing 0% for "no data".
    renderPage({
      insights: { ...emptyInsights, attemptCount: 9, scoredCount: 9, accuracy: 1 },
      insightsGoalId: 'goal-OTHER',
    })

    expect(screen.queryByText('100%')).not.toBeInTheDocument()
    expect(screen.queryByText('9')).not.toBeInTheDocument()
  })

  it('offers a retry when the diagnostics could not be loaded', () => {
    renderPage({ insights: null, insightsGoalId: null, insightsError: { code: 'NETWORK', message: 'x' } })

    // Previously this state rendered nothing at all: a blank screen with no way out.
    expect(screen.getByTestId('learning-insights-error')).toBeInTheDocument()
    expect(screen.getByText('actions.retry')).toBeInTheDocument()
  })

  it('says "no data" instead of 0% when nothing has been scored', () => {
    renderPage()

    // Four stats, three of which have nothing to report yet.
    expect(screen.getAllByText('insights.noData').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.getByText('insights.notScoredYet')).toBeInTheDocument()
  })

  it('does show a real 0% when the learner genuinely missed everything', () => {
    renderPage({
      insights: { ...emptyInsights, attemptCount: 4, scoredCount: 4, accuracy: 0 },
    })

    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.queryByText('insights.notScoredYet')).not.toBeInTheDocument()
  })

  it('renders the headline numbers', () => {
    renderPage({
      insights: {
        ...emptyInsights,
        attemptCount: 12, scoredCount: 10, accuracy: 0.8,
        medianDurationMs: 5500, overallAdherence: 0.25,
      },
    })

    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('insights.seconds')).toBeInTheDocument()
  })

  it('lists weak cards with a study link when the card is known', () => {
    renderPage({
      insights: {
        ...emptyInsights,
        weakCards: [{ cardId: 'card-1', attempts: 3, meanScore: 0.2 }],
      },
      planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } },
    })

    expect(screen.getByText('猫')).toBeInTheDocument()
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'today.item.study' }))
      .toHaveAttribute('href', '/decks/deck-7/study/setup')
  })

  it('still lists a weak card that is not in today\'s plan, without a broken link', () => {
    renderPage({
      insights: {
        ...emptyInsights,
        weakCards: [{ cardId: 'card-9', attempts: 2, meanScore: 0.1 }],
      },
      planCards: {},
    })

    expect(screen.getByText('insights.cardFallback')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'today.item.study' })).not.toBeInTheDocument()
  })

  it('says nothing is falling behind rather than showing an empty list', () => {
    renderPage({ insights: { ...emptyInsights, weakCards: [] } })

    expect(screen.getByText('insights.weakEmpty')).toBeInTheDocument()
  })

  it('marks a day that planned nothing as such, not as 0% done', () => {
    renderPage({
      insights: {
        ...emptyInsights,
        adherence: [
          { planDate: '2026-07-31', totalItems: 0, completedItems: 0, ratio: null },
          { planDate: '2026-07-30', totalItems: 4, completedItems: 1, ratio: 0.25 },
        ],
      },
    })

    expect(screen.getByText('insights.noPlanItems')).toBeInTheDocument()
    expect(screen.getByText('insights.dayRatio')).toBeInTheDocument()
  })

  it('points a user with no goal at goal creation', () => {
    renderPage({ goals: [] })

    expect(screen.getByText('today.empty.noGoal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'today.empty.createGoal' }))
      .toHaveAttribute('href', '/learning/goals')
  })

  it('cannot produce recommendations with nothing weak to recommend', () => {
    renderPage({ insights: { ...emptyInsights, weakCards: [] } })

    // Producing replaces the pending set server-side, so an empty producer run would wipe
    // the feed for no reason.
    expect(screen.getByRole('button', { name: 'recommend.regenerate' })).toBeDisabled()
    expect(screen.getByText('recommend.empty')).toBeInTheDocument()
  })

  it('produces on an explicit press only', async () => {
    const state = renderPage({
      insights: { ...emptyInsights, weakCards: [{ cardId: 'card-1', attempts: 3, meanScore: 0.2 }] },
    })

    expect(state.regenerateRecommendations).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'recommend.regenerate' }))
    expect(state.regenerateRecommendations).toHaveBeenCalledWith('goal-1')
  })

  it('offers accept and dismiss on a pending suggestion, with its evidence', async () => {
    const state = renderPage({
      recommendations: [{
        id: 'rec-1', goal_id: 'goal-1', card_id: 'card-1', concept_id: null, activity_id: null,
        action_type: 'review_card', provider: 'algorithm', reason: 'mean 20% over 3 attempts',
        algorithm_version: 'weak-card-v1', status: 'pending', created_at: '2026-07-31T00:00:00Z',
      }],
      planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } },
    })

    expect(screen.getByText('猫')).toBeInTheDocument()
    expect(screen.getByText('mean 20% over 3 attempts')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'recommend.accept' }))
    expect(state.resolveRecommendation).toHaveBeenCalledWith('rec-1', 'accepted')

    await userEvent.click(screen.getByRole('button', { name: 'recommend.dismiss' }))
    expect(state.resolveRecommendation).toHaveBeenCalledWith('rec-1', 'dismissed')
  })

  it('shows a decided suggestion as decided, with no way to change it', () => {
    renderPage({
      recommendations: [{
        id: 'rec-1', goal_id: 'goal-1', card_id: 'card-1', concept_id: null, activity_id: null,
        action_type: 'review_card', provider: 'algorithm', reason: null,
        algorithm_version: 'weak-card-v1', status: 'dismissed', created_at: '2026-07-31T00:00:00Z',
      }],
    })

    // The decision is terminal server-side; the UI must not offer an action that would 409.
    expect(screen.getByText('recommend.status.dismissed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'recommend.accept' })).not.toBeInTheDocument()
  })

  it('states what the page does not cover, so the numbers are not mistaken for SRS stats', () => {
    renderPage()

    expect(screen.getByText('insights.scopeNote')).toBeInTheDocument()
  })
})
