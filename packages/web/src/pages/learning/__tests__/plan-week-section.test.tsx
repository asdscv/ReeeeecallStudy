/**
 * 이번 주 — the section that must not be able to disappear.
 *
 * The whole defect this replaces was a rendering one that no test could see: five sections,
 * five `return null` guards, each correct on its own, and a screen that was one card and a
 * button for anyone who had not studied yet today. Nothing failed. The page tests passed,
 * because they asserted what the page says when it has something to say.
 *
 * So these assert the opposite: what it says when it has NOTHING to say. The coach holding,
 * the coach being too early to judge, a week with no plans in it at all — every one of those
 * used to render nothing, and every one of them must now render the week.
 */
import { render, screen } from '@testing-library/react'
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
  useConfirmStore: (selector: (s: { confirm: unknown }) => unknown) =>
    selector({ confirm: vi.fn() }),
}))
vi.mock('../../../stores/auth-store', () => ({ useAuthStore: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../stores/deck-store', () => ({
  useDeckStore: () => ({ decks: [{ id: 'deck-1', name: 'Deck one' }], stats: [], fetchDecks: vi.fn(), fetchStats: vi.fn() }),
}))

import { LearningTodayPage } from '../LearningTodayPage'
import { planWeek } from '@reeeeecall/shared/learning/application/plan-week'

const goal = {
  id: 'goal-1', domain_id: 'language', title: 'JLPT N2', target_date: null,
  daily_minutes: 20, status: 'active', target: {}, settings: {},
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
  decks: [{ deck_id: 'deck-1', importance: 0.5 }],
}

/** A week shaped like the live account this was measured against: one day done, then nothing. */
const LIVE_WEEK = [
  { date: '2026-08-05', planned: 0, done: 0, studied: 0 },
  { date: '2026-08-06', planned: 28, done: 28, studied: 29 },
  { date: '2026-08-07', planned: 12, done: 0, studied: 0 },
  { date: '2026-08-08', planned: 0, done: 0, studied: 0 },
  { date: '2026-08-09', planned: 0, done: 0, studied: 0 },
  { date: '2026-08-10', planned: 0, done: 0, studied: 0 },
  { date: '2026-08-11', planned: 12, done: 0, studied: 0 },
]

const baseState = (over: StoreState = {}): StoreState => ({
  knowledge: {}, knowledgeLoading: false, fetchGoalKnowledge: vi.fn(),
  completeGoalIfEarned: vi.fn().mockResolvedValue(false),
  goals: [goal], goalsLoading: false, goalsError: null,
  plan: null, planItems: [], planCards: {}, planTemplateFields: {},
  planLoading: false, planGenerating: false, planError: null, planBlockedReason: null,
  fetchGoals: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(), archiveGoal: vi.fn(),
  deleteGoal: vi.fn(), archivedGoals: null, archivedGoalsLoading: false,
  fetchArchivedGoals: vi.fn(), restoreGoal: vi.fn(), setGoalDecks: vi.fn(),
  fetchPlan: vi.fn(), generatePlan: vi.fn(), autoGeneratePlan: vi.fn(),
  planAbsentFor: null, autoPlanAttempted: {}, extendPlan: vi.fn(),
  planExtending: false, planExtension: null,
  planForecast: {}, planForecastLoading: null, forecastPlan: vi.fn(),
  recordingItemId: null, attempts: [], attemptsLoading: false,
  recordAttempt: vi.fn().mockResolvedValue(true), fetchAttempts: vi.fn(),
  insights: null, weakCardDecks: {}, insightsLoading: false, insightsGoalId: null,
  fetchInsights: vi.fn(),

  // The week, and the coach that lives inside it.
  planWeek: planWeek({ by_day: LIVE_WEEK, days: 7, items_planned: 52, items_done: 28 }),
  planWeekGoalId: 'goal-1',
  recommendations: [],
  fetchRecommendations: vi.fn().mockResolvedValue(undefined),
  regeneratePlanCoach: vi.fn().mockResolvedValue(false),
  applyPlanCoach: vi.fn().mockResolvedValue(true),
  resolveRecommendation: vi.fn().mockResolvedValue(true),
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
  // Nothing studied today and nothing checkable — the state the whole screen used to be
  // blank in. The daily-check card is expected to stay away; the week is not.
  quizState.current = {
    countDailyCheck: vi.fn().mockResolvedValue({
      studiedToday: 0, checkable: 0, windowDays: 1, blocked: [],
    }),
    buildDailyCheck: vi.fn(),
    startRun: vi.fn(),
  }
})

describe('the week section', () => {
  it('renders on a week the coach has nothing to say about', () => {
    // THE regression. `planCoach` returns null below four plans and `hold` when nothing is
    // wrong, and both used to take the entire section with them.
    renderToday()
    expect(screen.getByTestId('plan-week-strip')).toBeInTheDocument()
  })

  it('draws one cell per day, each carrying what happened on it', () => {
    renderToday()
    const strip = screen.getByTestId('plan-week-strip')
    expect(strip.children).toHaveLength(7)
    // The live shape: four empty days, one finished, two planned-but-untouched.
    expect(screen.getAllByTestId('plan-week-day-none')).toHaveLength(4)
    expect(screen.getAllByTestId('plan-week-day-done')).toHaveLength(1)
    expect(screen.getAllByTestId('plan-week-day-untouched')).toHaveLength(2)
  })

  // These assert the KEY, not the sentence: this harness renders i18n keys verbatim, and the
  // sentences themselves are covered — in all sixteen files — by the locale suites. What is
  // being pinned here is which of the three the component chose.
  it('does not claim an empty week when a day was studied', () => {
    // Measured on the live account: one active day, streak 0. The two lines have to agree —
    // "이번 주는 아직 기록이 없어요" next to "1일 학습" is the screen contradicting itself in
    // consecutive lines, which is exactly what a bare `streak > 0 ? … : streakNone` did.
    renderToday()
    expect(screen.getByTestId('plan-week-summary')).toHaveTextContent('week.streakBroken')
  })

  it('says the week is empty only when it is', () => {
    renderToday({
      planWeek: planWeek({
        by_day: LIVE_WEEK.map((d) => ({ ...d, done: 0, studied: 0 })),
        days: 7, items_planned: 52, items_done: 0,
      }),
    })
    expect(screen.getByTestId('plan-week-summary')).toHaveTextContent('week.streakNone')
  })

  it('counts a live streak when there is one', () => {
    renderToday({
      planWeek: planWeek({
        by_day: LIVE_WEEK.map((d) => ({ ...d, planned: 5, done: 5, studied: 5 })),
        days: 7, items_planned: 35, items_done: 35,
      }),
    })
    expect(screen.getByTestId('plan-week-summary')).toHaveTextContent('week.streak')
    expect(screen.getByTestId('plan-week-summary')).not.toHaveTextContent('week.streakNone')
  })

  it('shows the coach inside the week rather than as its own section', () => {
    renderToday({
      recommendations: [{
        id: 'rec-1', goal_id: 'goal-1', card_id: null, status: 'pending',
        action_type: 'shorten_session', payload: { value: 14 },
      }],
    })
    // One section carrying both. If these ever land in different sections the coach is back
    // to being a card-shaped hole on every week it holds.
    const strip = screen.getByTestId('plan-week-strip')
    const advice = screen.getByTestId('plan-coach-advice')
    // The title itself is `t(…, { defaultValue: '' })`, so it renders empty in this harness —
    // the sixteen locale files are what guarantee it says something, and the locale suites
    // check those. What is pinned here is that the advice and the strip are ONE section. If
    // they ever split, the coach is back to being a card-shaped hole on every week it holds.
    expect(strip.closest('section')).toBe(advice.closest('section'))
    expect(advice).toHaveTextContent('coach.apply')
  })

  it('keeps `hold` off the screen without taking the week with it', () => {
    // `hold` is a real answer — it means nothing is wrong — and it is stored so producers can
    // be compared later. It is not something to put in front of a learner.
    renderToday({
      recommendations: [{
        id: 'rec-1', goal_id: 'goal-1', card_id: null, status: 'pending',
        action_type: 'hold', payload: { value: null },
      }],
    })
    expect(screen.getByTestId('plan-week-strip')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-coach-advice')).not.toBeInTheDocument()
  })

  it('hides itself when the server sent no week at all', () => {
    // A server on 206, or a rollback of 209. An empty strip would read as a week in which
    // the learner did nothing, which is a worse lie than saying nothing.
    renderToday({ planWeek: null })
    expect(screen.queryByTestId('plan-week-strip')).not.toBeInTheDocument()
  })

  it('does not show another goal\'s week', () => {
    renderToday({ planWeekGoalId: 'goal-2' })
    expect(screen.queryByTestId('plan-week-strip')).not.toBeInTheDocument()
  })
})

describe('the daily check, when nothing is checkable', () => {
  it('explains itself instead of vanishing, and links to the fix', async () => {
    // The live account: 29 cards studied in the week, none checkable, because their template
    // marks two back fields as the answer — one of which is the learner's own mistake.
    // Refusing is right. Refusing silently is the bug.
    quizState.current = {
      countDailyCheck: vi.fn().mockResolvedValue({
        studiedToday: 29, checkable: 0, windowDays: 7,
        blocked: [{ template_id: 'tpl-1', name: '영작 오답노트', cards: 29 }],
      }),
      buildDailyCheck: vi.fn(),
      startRun: vi.fn(),
    }
    renderToday()

    const panel = await screen.findByTestId('check-blocked')
    expect(panel).toHaveTextContent('check.blockedTitle')
    // The actionable half: the link has to reach the template that is actually blocking, or
    // the explanation is just a nicer way of doing nothing.
    expect(screen.getByRole('link', { name: 'check.blockedAction' }))
      .toHaveAttribute('href', '/templates/tpl-1/edit')
  })

  it('stays quiet when there was nothing to check in the first place', async () => {
    // No study at all is not a template problem, and telling someone to go fix a template
    // because they have not studied would be advice about the wrong thing entirely.
    quizState.current = {
      countDailyCheck: vi.fn().mockResolvedValue({
        studiedToday: 0, checkable: 0, windowDays: 7, blocked: [],
      }),
      buildDailyCheck: vi.fn(), startRun: vi.fn(),
    }
    renderToday()
    await screen.findByTestId('plan-week-strip')
    expect(screen.queryByTestId('check-blocked')).not.toBeInTheDocument()
  })
})
