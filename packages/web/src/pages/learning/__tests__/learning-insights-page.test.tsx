/**
 * Learning insights page.
 *
 * The assertion that matters: a learner with no scored attempts must NOT be shown 0%.
 * "You got everything wrong" and "you haven't answered anything yet" are different
 * sentences, and one `?? 0` in a template turns the second into the first.
 */
import { render, screen } from '@testing-library/react'
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
    insights: emptyInsights, insightsLoading: false, fetchInsights: vi.fn(),
    planCards: {},
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

  it('states what the page does not cover, so the numbers are not mistaken for SRS stats', () => {
    renderPage()

    expect(screen.getByText('insights.scopeNote')).toBeInTheDocument()
  })
})
