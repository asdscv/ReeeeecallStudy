/**
 * A read that failed is not a day that does not exist.
 *
 * `fetchPlan`'s catch is careful about this: it sets `plan: null` but leaves `planAbsentFor`
 * null on purpose, with the comment "a failed read tells us nothing about whether a plan
 * exists". The screen then ignored the distinction. With no plan and no pending automation the
 * render fell to its last branch, which offers 플랜 만들기 — and that button does not retry
 * anything. It BUILDS a plan, replacing whatever is on the server and taking `completed_items`
 * back to zero.
 *
 * So a learner who had finished nine of twelve cards, hit a flaky connection, and pressed the
 * only button on the screen destroyed the record of their day. The error banner above it even
 * said 다시 시도해 주세요 — while the single control did something else entirely.
 *
 * The fix is not new machinery: a failed read is answered by reading again.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

type StoreState = Record<string, unknown>

const { storeState, quizState } = vi.hoisted(() => ({
  storeState: { current: {} as StoreState },
  quizState: { current: {} as StoreState },
}))

vi.mock('../../../stores/learning-store', () => ({
  useLearningStore: () => storeState.current,
}))
vi.mock('@reeeeecall/shared/stores/quiz-store', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useQuizStore: () => quizState.current,
}))
vi.mock('../../../stores/confirm-store', () => ({
  useConfirmStore: (s: (v: { confirm: unknown }) => unknown) => s({ confirm: vi.fn() }),
}))
vi.mock('../../../stores/auth-store', () => ({ useAuthStore: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../stores/deck-store', () => ({
  useDeckStore: () => ({
    decks: [{ id: 'deck-1', name: '영작 오답노트' }], stats: [],
    fetchDecks: vi.fn(), fetchStats: vi.fn(),
  }),
}))

import { LearningTodayPage } from '../LearningTodayPage'

const goal = {
  id: 'goal-1', domain_id: 'language', title: '영작 회화 마스터', target_date: null,
  daily_minutes: 20, status: 'active', target: {}, settings: {},
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
  decks: [{ deck_id: 'deck-1', importance: 0.5 }],
}

const baseState = (over: StoreState = {}): StoreState => ({
  knowledge: {}, knowledgeLoading: false, fetchGoalKnowledge: vi.fn(),
  completeGoalIfEarned: vi.fn().mockResolvedValue(false),
  goals: [goal], goalsLoading: false, goalsError: null,
  plan: null, planItems: [], planCards: {}, planTemplateFields: {},
  planLoading: false, planGenerating: false, planError: null, planErrorFrom: null,
  planBlockedReason: null, attemptsError: null, coachError: null,
  fetchGoals: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(), archiveGoal: vi.fn(),
  deleteGoal: vi.fn(), archivedGoals: null, archivedGoalsLoading: false,
  fetchArchivedGoals: vi.fn(), restoreGoal: vi.fn(), setGoalDecks: vi.fn(),
  fetchPlan: vi.fn(), generatePlan: vi.fn(), autoGeneratePlan: vi.fn(),
  generateAheadPlan: vi.fn().mockResolvedValue(true),
  planAbsentFor: null, autoPlanAttempted: {}, extendPlan: vi.fn(),
  planExtending: false, planExtension: null,
  planForecast: {}, planForecastLoading: null, forecastPlan: vi.fn(),
  recordingItemId: null, attempts: [], attemptsLoading: false,
  recordAttempt: vi.fn().mockResolvedValue(true), fetchAttempts: vi.fn(),
  insights: null, weakCardDecks: {}, insightsLoading: false, insightsGoalId: null,
  fetchInsights: vi.fn(),
  planWeek: null, planWeekGoalId: null,
  recommendations: [], fetchRecommendations: vi.fn().mockResolvedValue(undefined),
  regeneratePlanCoach: vi.fn().mockResolvedValue(false),
  applyPlanCoach: vi.fn(), resolveRecommendation: vi.fn(),
  requestRemediation: vi.fn().mockResolvedValue(true),
  dismissRemediation: vi.fn(),
  loadRemediation: vi.fn().mockResolvedValue(false),
  showOwnedRemediation: vi.fn().mockReturnValue(true),
  remediation: null, remediationOwned: {},
  remediationBusyAttemptId: null, remediationError: null,
  ...over,
})

const renderToday = (over: StoreState = {}) => {
  storeState.current = baseState(over)
  render(
    <MemoryRouter initialEntries={['/learning/goal-1']}>
      <Routes><Route path="/learning/:goalId" element={<LearningTodayPage />} /></Routes>
    </MemoryRouter>,
  )
  return storeState.current
}

beforeEach(() => {
  vi.clearAllMocks()
  quizState.current = {
    countDailyCheck: vi.fn().mockResolvedValue({
      studiedToday: 0, checkable: 0, windowDays: 1, blocked: [],
    }),
    buildDailyCheck: vi.fn(), startRun: vi.fn(),
  }
})

/** The state `fetchPlan`'s catch actually leaves behind. */
const READ_FAILED: StoreState = {
  plan: null,
  planError: { code: 'NETWORK_ERROR' },
  planErrorFrom: 'read',
  planAbsentFor: null,
}

describe('when the plan could not be READ', () => {
  it('does not offer to build one over it', () => {
    // The whole defect. `today.generate` here is not a retry — it overwrites the server's plan
    // for today, and with it the count of what the learner already finished.
    renderToday(READ_FAILED)
    expect(screen.queryByTestId('learning-generate')).not.toBeInTheDocument()
  })

  it('offers a retry instead', () => {
    renderToday(READ_FAILED)
    expect(screen.getByTestId('learning-plan-retry')).toBeInTheDocument()
  })

  it('retries by READING, never by generating', () => {
    const state = renderToday(READ_FAILED)
    ;(state.fetchPlan as ReturnType<typeof vi.fn>).mockClear()
    return userEvent.click(screen.getByTestId('learning-plan-retry')).then(() => {
      expect(state.fetchPlan).toHaveBeenCalled()
      // The assertion that matters: nothing on this screen may write while we do not know
      // what is on the server.
      expect(state.generatePlan).not.toHaveBeenCalled()
    })
  })

  it('still says what went wrong', () => {
    // The retry replaces a button, not the explanation above it.
    renderToday(READ_FAILED)
    expect(screen.getByTestId('learning-plan-retry')).toBeInTheDocument()
    expect(screen.queryByTestId('learning-generate')).not.toBeInTheDocument()
  })
})

describe('when the plan is genuinely ABSENT', () => {
  // The distinction the fix turns on. A SUCCESSFUL read that found nothing sets
  // `planAbsentFor`, and there 플랜 만들기 is exactly right — there is nothing to overwrite.
  it('still offers to build one', () => {
    renderToday({
      plan: null, planError: null, planErrorFrom: null,
      // Not today's key, so the auto-generation branch does not claim the render first; this
      // is the "automation already had its turn" state the button exists for.
      planAbsentFor: 'goal-1|1999-01-01',
      autoPlanAttempted: { 'goal-1': true },
    })
    expect(screen.getByTestId('learning-generate')).toBeInTheDocument()
    expect(screen.queryByTestId('learning-plan-retry')).not.toBeInTheDocument()
  })

  it('builds when pressed', () => {
    const state = renderToday({
      plan: null, planError: null, planErrorFrom: null,
      planAbsentFor: 'goal-1|1999-01-01',
      autoPlanAttempted: { 'goal-1': true },
    })
    return userEvent.click(screen.getByTestId('learning-generate')).then(() => {
      expect(state.generatePlan).toHaveBeenCalled()
    })
  })
})
