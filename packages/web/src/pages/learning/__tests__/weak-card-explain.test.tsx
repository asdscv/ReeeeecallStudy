/**
 * 뭐가 AI란 말이야 — the learning plan's one paid model call.
 *
 * Everything else on that screen runs on the device: the plan is a deterministic ranker, the
 * week strip is a SQL digest, the coach is an ordered rule chain over eight integers, and
 * 오늘의 확인 asks the card's own question with a string comparison. So the answer to the
 * owner's question was, honestly, "nothing" — while the entire server half of a paid
 * explanation sat deployed with no caller: `kind: 'remediation'` reserves against the wallet,
 * loads the grounding, prompts, validates, persists, and releases the hold when the model
 * fails.
 *
 * What these pin is the thing that makes it sellable rather than merely billable: it is offered
 * ONLY when there is a real miss to explain. `ai-remediation.ts` records what happens otherwise
 * — a `compare` was once billed for a comparison against an answer the learner had never given.
 */
import { render, screen, waitFor } from '@testing-library/react'
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
    decks: [{ id: 'deck-1', name: 'Deck one' }], stats: [],
    fetchDecks: vi.fn(), fetchStats: vi.fn(),
  }),
}))

import { LearningTodayPage } from '../LearningTodayPage'

const goal = {
  id: 'goal-1', domain_id: 'language', title: 'JLPT N2', target_date: null,
  daily_minutes: 20, status: 'active', target: {}, settings: {},
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
  decks: [{ deck_id: 'deck-1', importance: 0.5 }],
}

/** An attempt row, as `fetchAttempts` returns them. */
const attempt = (over: Record<string, unknown> = {}) => ({
  id: 'att-1', goal_id: 'goal-1', card_id: 'card-weak', activity_id: null, plan_item_id: null,
  activity_type: 'recall', response_type: 'self_rate', evaluator_type: 'self_rate',
  response: null, normalized_score: 0.0, duration_ms: 1000,
  created_at: '2026-08-11T05:00:00.000Z',
  ...over,
})

/** Insights with one weak card, which is what makes the section render at all. */
const withWeakCard = (over: StoreState = {}): StoreState => ({
  insights: {
    attemptCount: 12, scoredCount: 12, accuracy: 0.5,
    medianDurationMs: 1000, overallAdherence: 0.5,
    weakCards: [{ cardId: 'card-weak', attempts: 3, mean: 0.2 }],
  },
  weakCardDecks: { 'card-weak': 'deck-1' },
  insightsGoalId: 'goal-1',
  attempts: [attempt()],
  ...over,
})

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

describe('the paid explanation', () => {
  it('is offered on a card the learner actually missed', () => {
    renderToday(withWeakCard())
    expect(screen.getByTestId('weak-explain-ask')).toBeInTheDocument()
  })

  it('says it costs credits before it is pressed', () => {
    // The one thing a learner must know in advance. Not an amount — amounts were removed from
    // the flow — but that a press spends something.
    renderToday(withWeakCard())
    expect(screen.getByText('explain.note')).toBeInTheDocument()
  })

  it('sends the ATTEMPT, not just the card', () => {
    // The server refuses an ungrounded request, and `learning-attempt-selection.ts` exists so
    // both platforms choose the same attempt. A store that guessed one would be how a learner
    // pays for an explanation of something they did not ask about.
    const state = renderToday(withWeakCard())
    return userEvent.click(screen.getByTestId('weak-explain-ask')).then(() =>
      waitFor(() => {
        expect(state.requestRemediation).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'explain', goalId: 'goal-1', attemptId: 'att-1', cardId: 'card-weak',
          }),
        )
      }))
  })

  it('is NOT offered when the last attempt was a success', () => {
    // Selling an explanation of something the learner just said they knew is selling a premise
    // that does not exist — and `explain` on a success has nothing to work with beyond the
    // card, which the study button already covers.
    renderToday(withWeakCard({ attempts: [attempt({ normalized_score: 1 })] }))
    expect(screen.queryByTestId('weak-explain-ask')).not.toBeInTheDocument()
  })

  it('is NOT offered when the attempt was never scored', () => {
    // A null score is not evidence of a miss. Treating it as one would bill on absence of data.
    renderToday(withWeakCard({ attempts: [attempt({ normalized_score: null })] }))
    expect(screen.queryByTestId('weak-explain-ask')).not.toBeInTheDocument()
  })

  it('is NOT offered when there is no attempt at all', () => {
    renderToday(withWeakCard({ attempts: [] }))
    expect(screen.queryByTestId('weak-explain')).not.toBeInTheDocument()
  })

  it('grounds on the MOST RECENT attempt for the card', () => {
    // A learner who missed it last week and got it right an hour ago is not stuck on it.
    const state = renderToday(withWeakCard({
      attempts: [
        attempt({ id: 'old', normalized_score: 0, created_at: '2026-08-01T00:00:00.000Z' }),
        attempt({ id: 'new', normalized_score: 1, created_at: '2026-08-11T09:00:00.000Z' }),
      ],
    }))
    expect(screen.queryByTestId('weak-explain-ask')).not.toBeInTheDocument()
    expect(state.requestRemediation).not.toHaveBeenCalled()
  })

  it('shows the explanation once it arrives', () => {
    renderToday(withWeakCard({
      remediation: {
        attemptId: 'att-1', action: 'explain',
        summary: '조사 선택이 문제예요', blocks: [{ type: 'text', content: '에/에서 구분' }],
        warnings: [],
      },
    }))
    expect(screen.getByText('조사 선택이 문제예요')).toBeInTheDocument()
    expect(screen.getByText('에/에서 구분')).toBeInTheDocument()
    expect(screen.queryByTestId('weak-explain-ask')).not.toBeInTheDocument()
  })

  it('does not show one attempt\'s explanation under another attempt', () => {
    // Every other goal-scoped read on this screen has this guard, for the same reason.
    renderToday(withWeakCard({
      remediation: {
        attemptId: 'a-different-one', action: 'explain',
        summary: '다른 카드 설명', blocks: [], warnings: [],
      },
    }))
    expect(screen.queryByText('다른 카드 설명')).not.toBeInTheDocument()
    expect(screen.getByTestId('weak-explain-ask')).toBeInTheDocument()
  })

  it('keeps the model\'s own reservations', () => {
    // Dropping the warnings would present a hedged answer as a confident one.
    renderToday(withWeakCard({
      remediation: {
        attemptId: 'att-1', action: 'explain', summary: '요약', blocks: [],
        warnings: ['이 카드에는 예문이 없어 추측이 섞였어요'],
      },
    }))
    expect(screen.getByText('이 카드에는 예문이 없어 추측이 섞였어요')).toBeInTheDocument()
  })

  it('names an empty wallet as the reason, not a generic failure', () => {
    // The one failure the learner can do something about.
    renderToday(withWeakCard({ remediationError: { code: 'AI_INSUFFICIENT_CREDITS' } }))
    expect(screen.getByRole('alert')).toHaveTextContent('explain.needsCredits')
  })

  it('reports any other failure as a failure', () => {
    renderToday(withWeakCard({ remediationError: { code: 'AI_PROVIDER_ERROR' } }))
    expect(screen.getByRole('alert')).toHaveTextContent('explain.failed')
  })

  it('offers a way to add credits when that is the problem', () => {
    // `AiCreditNotice` carries the 충전 link on every other AI screen, but it is placed by
    // feature id and the learning plan is registered `poweredBy: 'device'` — correctly, since
    // almost all of it runs on the device. The consequence was that the app's newest paid
    // button was the only one that could say "you have no credits" and then stop, leaving a
    // learner who wants to pay with nowhere to do it.
    renderToday(withWeakCard({ remediationError: { code: 'AI_INSUFFICIENT_CREDITS' } }))
    const link = screen.getByRole('link', { name: 'wallet.topUp' })
    expect(link).toHaveAttribute('href', '/settings')
  })

  it('does not advertise a top-up for an unrelated failure', () => {
    renderToday(withWeakCard({ remediationError: { code: 'AI_PROVIDER_ERROR' } }))
    expect(screen.queryByRole('link', { name: 'wallet.topUp' })).not.toBeInTheDocument()
  })

  it('says "still working", not "failed", while the first request is in flight', () => {
    // A second press whose first request has not returned (mig 212's 409). Calling that a
    // failure would be false, and it is the one condition whose answer is "wait" — a learner
    // told it failed presses again, which is the behaviour the whole change exists to stop.
    renderToday(withWeakCard({ remediationError: { code: 'AI_REMEDIATION_IN_FLIGHT' } }))
    expect(screen.getByRole('alert')).toHaveTextContent('explain.inFlight')
  })
})

/**
 * Bought once.
 *
 * The explanation lived only in the store, so 닫기 — a button that says "close" — destroyed an
 * artifact the learner had been charged for, and the paid button was the only way back to it.
 * Every press was a fresh generation from byte-identical grounding, at full price. The server
 * now replays (mig 212) and the client reads what it already owns; these pin the half a learner
 * can see, which is that the paid button is not what they are offered for something paid for.
 */
describe('an explanation already paid for', () => {
  const owned = {
    attemptId: 'att-1', action: 'explain' as const,
    summary: '조사 선택이 문제예요', blocks: [], warnings: [],
  }

  it('is looked up without spending anything', () => {
    const state = renderToday(withWeakCard())
    // A free read of `user_enrichments`, whose owner-read policy had existed since the table
    // did with nothing ever using it.
    expect(state.loadRemediation).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: 'att-1', action: 'explain' }),
    )
    expect(state.requestRemediation).not.toHaveBeenCalled()
  })

  it('is reopened by a FREE button, never the paid one', () => {
    renderToday(withWeakCard({ remediationOwned: { 'att-1': owned } }))
    expect(screen.getByTestId('weak-explain-reopen')).toBeInTheDocument()
    // The exact regression: offering "왜 자꾸 틀리는지 설명 받기" over something already bought.
    expect(screen.queryByTestId('weak-explain-ask')).not.toBeInTheDocument()
  })

  it('does not repeat the price warning over something already paid for', () => {
    renderToday(withWeakCard({ remediationOwned: { 'att-1': owned } }))
    expect(screen.queryByText('explain.note')).not.toBeInTheDocument()
  })

  it('reopens from memory, with no server call', () => {
    const state = renderToday(withWeakCard({ remediationOwned: { 'att-1': owned } }))
    return userEvent.click(screen.getByTestId('weak-explain-reopen')).then(() => {
      expect(state.showOwnedRemediation).toHaveBeenCalledWith('att-1')
      expect(state.requestRemediation).not.toHaveBeenCalled()
    })
  })

  it('does not treat another attempt\'s purchase as this one\'s', () => {
    // Same guard as the display path. Without it a learner would be shown a free reopen for a
    // card they have not bought anything for, and get someone else's paragraph.
    renderToday(withWeakCard({ remediationOwned: { 'a-different-attempt': owned } }))
    expect(screen.getByTestId('weak-explain-ask')).toBeInTheDocument()
    expect(screen.queryByTestId('weak-explain-reopen')).not.toBeInTheDocument()
  })

  it('still shows the answer itself when it is open', () => {
    renderToday(withWeakCard({
      remediationOwned: { 'att-1': owned },
      remediation: { ...owned, summary: '조사 선택이 문제예요' },
    }))
    expect(screen.getByText('조사 선택이 문제예요')).toBeInTheDocument()
    expect(screen.queryByTestId('weak-explain-reopen')).not.toBeInTheDocument()
  })
})
