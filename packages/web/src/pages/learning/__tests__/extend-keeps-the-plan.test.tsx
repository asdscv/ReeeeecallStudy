/**
 * Pressing 더 하기 must not erase the day you just finished.
 *
 * Reported from a real account: the learner finished today's twelve items, pressed 더 하기,
 * and their plan was replaced by
 *
 *     오늘 이 덱들에서 복습할 카드가 없습니다.
 *
 * Two separate wrongs in one line. The plan card — 오늘 끝!, the progress, the per-deck list —
 * was gone, so the day's work no longer existed on screen. And the sentence was false: six
 * cards HAD been due today and they had done all six. What was actually true is that there was
 * nothing left to ADD, because everything due was already in the plan.
 *
 * The cause is a state collision, not a copy mistake. `planBlockedReason` means "this goal
 * cannot produce a day", and the page renders it INSTEAD of the plan — correctly, because when
 * generation is blocked there is no plan to show. `extendPlan` set that same flag to report
 * "nothing more to add", which is a fact about an extension, not about the day.
 *
 * So these assert the boundary: an extension that finds nothing may report itself, and may not
 * touch the plan's own state. The screen already had a line for this outcome —
 * `today.extendNothing` — that no code path could reach.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
import { currentPlanContext } from '../../../lib/learning-plan-date'

const goal = {
  id: 'goal-1', domain_id: 'language', title: '영작 회화 마스터', target_date: null,
  daily_minutes: 20, status: 'active', target: {}, settings: {},
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
  decks: [{ deck_id: 'deck-1', importance: 0.5 }],
}

/** Today, finished: twelve items, twelve done — the state the report came from. */
const finishedPlan = {
  id: 'plan-1', goal_id: 'goal-1', plan_date: currentPlanContext().planDate,
  total_items: 12, completed_items: 12,
}
const finishedItems = Array.from({ length: 12 }, (_, i) => ({
  id: `item-${i}`, plan_id: 'plan-1', card_id: `card-${i}`, deck_id: 'deck-1',
  status: 'completed', activity_type: 'recall', reason_code: 'due', position: i,
}))
/** The cards those items point at. Emptied by one case below to model a deleted card. */
const planCards = Object.fromEntries(
  finishedItems.map((it) => [it.card_id, { id: it.card_id, deck_id: 'deck-1' }]))

const baseState = (over: StoreState = {}): StoreState => ({
  knowledge: {}, knowledgeLoading: false, fetchGoalKnowledge: vi.fn(),
  completeGoalIfEarned: vi.fn().mockResolvedValue(false),
  goals: [goal], goalsLoading: false, goalsError: null,
  plan: finishedPlan, planItems: finishedItems, planCards, planTemplateFields: {},
  planLoading: false, planGenerating: false, planError: null, planBlockedReason: null,
  fetchGoals: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(), archiveGoal: vi.fn(),
  deleteGoal: vi.fn(), archivedGoals: null, archivedGoalsLoading: false,
  fetchArchivedGoals: vi.fn(), restoreGoal: vi.fn(), setGoalDecks: vi.fn(),
  fetchPlan: vi.fn(), generatePlan: vi.fn(), autoGeneratePlan: vi.fn(),
  planAbsentFor: null, autoPlanAttempted: {},
  extendPlan: vi.fn().mockResolvedValue(false),
  planExtending: false, planExtension: null,
  planForecast: {}, planForecastLoading: null, forecastPlan: vi.fn(),
  recordingItemId: null, attempts: [], attemptsLoading: false,
  recordAttempt: vi.fn().mockResolvedValue(true), fetchAttempts: vi.fn(),
  insights: null, weakCardDecks: {}, insightsLoading: false, insightsGoalId: null,
  fetchInsights: vi.fn(),
  enrichment: null, enrichmentPendingCardId: null, enrichmentError: null,
  enrichmentSaving: false, enrichmentQuote: null,
  requestEnrichment: vi.fn().mockResolvedValue(true),
  loadEnrichmentQuote: vi.fn().mockResolvedValue(undefined),
  resolveEnrichment: vi.fn(), dismissEnrichment: vi.fn(),
  planWeek: null, planWeekGoalId: null,
  recommendations: [], fetchRecommendations: vi.fn().mockResolvedValue(undefined),
  regeneratePlanCoach: vi.fn().mockResolvedValue(false),
  applyPlanCoach: vi.fn(), resolveRecommendation: vi.fn(),
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
      studiedToday: 12, checkable: 0, windowDays: 1, blocked: [],
    }),
    buildDailyCheck: vi.fn(), startRun: vi.fn(),
  }
})

/**
 * 오늘 몫을 하다가 중단한 날.
 *
 * The day is not a binary. A learner does five of twelve, closes the app, and comes back —
 * hours later, or tomorrow. Every claim the screen makes has to survive that, and two of them
 * did not: the totals were summed from a grouping that could silently shrink, and the
 * finished-day note promised "내일 또 만나요" while the cards were coming back in minutes.
 */
describe('a day that was interrupted partway', () => {
  const halfDone = {
    plan: { ...finishedPlan, completed_items: 5 },
    planItems: finishedItems.map((it, i) => ({
      ...it, status: i < 5 ? 'completed' : 'pending',
    })),
  }

  it('says what is left, from the plan\'s own counters', () => {
    renderToday(halfDone)
    expect(screen.getByText(/today\.remaining/)).toBeInTheDocument()
    expect(screen.queryByText('today.allDone')).not.toBeInTheDocument()
  })

  it('offers to CONTINUE, not to start over', () => {
    // `이어서 학습` vs `학습 시작`. Reading it off `completed_items` rather than off the
    // resolvable items means a card deleted mid-day cannot make the day look untouched.
    renderToday(halfDone)
    expect(screen.getByRole('link', { name: /today\.continueStudy/ })).toBeInTheDocument()
  })

  it('does not offer 더 하기 before the day is done', () => {
    // "더 하기" means MORE than today's share. Offering it beside unfinished work invites the
    // learner to grow a list they have not started.
    renderToday(halfDone)
    expect(screen.queryByRole('button', { name: 'today.extend' })).not.toBeInTheDocument()
  })

  it('offers it the moment the day IS done', () => {
    renderToday()
    expect(screen.getByRole('button', { name: 'today.extend' })).toBeInTheDocument()
  })
})

describe('더 하기 on a finished day', () => {
  it('offers the button once the day is done', () => {
    renderToday()
    expect(screen.getByRole('button', { name: 'today.extend' })).toBeInTheDocument()
  })

  it('keeps the finished plan on screen when there is nothing to add', () => {
    // The regression, stated as the screen: an extension that found nothing must leave the
    // day's own card alone. `extendNothing` renders BESIDE the plan, not instead of it.
    renderToday({ planExtension: { appended: 0, newCards: 0, reviewsTomorrow: 0 } })

    expect(screen.getByText('today.extendNothing')).toBeInTheDocument()
    // 오늘 끝! — the day is still there.
    expect(screen.getByText('today.allDone')).toBeInTheDocument()
    expect(screen.queryByText('today.empty.nothingDue')).not.toBeInTheDocument()
  })

  it('still hides the plan when GENERATION is what was blocked', () => {
    // The other side of the boundary. When a goal genuinely cannot produce a day there IS no
    // plan to show, and this branch has to keep working — the fix must not have made
    // `planBlockedReason` unreachable, only stopped an extension from setting it.
    renderToday({ plan: null, planItems: [], planBlockedReason: 'no_candidates' })
    expect(screen.getByText('today.empty.allCaughtUp')).toBeInTheDocument()
    expect(screen.queryByText('today.allDone')).not.toBeInTheDocument()
  })

  it('reports what it added when it adds something', () => {
    renderToday({ planExtension: { appended: 3, newCards: 3, reviewsTomorrow: 3 } })
    expect(screen.getByText(/today\.extendAdded/)).toBeInTheDocument()
    expect(screen.getByText('today.allDone')).toBeInTheDocument()
  })

  it('never says the day is finished while the plan says it is not', () => {
    // `deckGroups` drops any item whose card it cannot resolve, and the totals used to be
    // summed from it — so a plan of twelve untouched items could report zero pending and put
    // "오늘 끝!" directly above its own "12개 중 0개 완료". Photographed while verifying this
    // very screen. The totals now come from the plan's own server-maintained counters.
    // Twelve items, none done, and not one of their cards resolvable.
    renderToday({
      plan: { ...finishedPlan, completed_items: 0 },
      planItems: finishedItems.map((it) => ({ ...it, status: 'pending' })),
      planCards: {},
    })

    expect(screen.queryByText('today.allDone')).not.toBeInTheDocument()
    expect(screen.queryByText('today.allDoneNote')).not.toBeInTheDocument()
    expect(screen.getByText(/today\.remaining/)).toBeInTheDocument()
    // And it says WHY there is nothing to press, rather than implying the work is done.
    expect(screen.getByText(/today\.itemsUnavailable/)).toBeInTheDocument()
  })

  it('the store never reports an extension as a blocked plan', () => {
    // The page tests above mock the store, so they can pin the SCREEN but not the action that
    // fills it. This reads `extendPlan` itself: the collision was one `set({ planBlockedReason:
    // … })` inside it, and nothing but reading the function body catches its return.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../../../shared/stores/learning-store.ts'),
      'utf-8')
    const start = src.indexOf('  extendPlan: async (goal, ctx) => {')
    expect(start, 'could not find extendPlan in the store').toBeGreaterThan(0)
    const body = src.slice(start, src.indexOf('\n  resolveRecommendation:', start))
    expect(body.length).toBeGreaterThan(200)

    // Clearing it on entry is right and must stay. Setting it to a REASON is the bug.
    const assignments = [...body.matchAll(/planBlockedReason:\s*([^,\s}]+)/g)].map((m) => m[1])
    expect(assignments.length).toBeGreaterThan(0)
    expect(assignments, 'extendPlan assigns a blocked reason — it will erase the finished plan')
      .toEqual(assignments.map(() => 'null'))
  })

  it('presses through to the store', async () => {
    const state = renderToday()
    await userEvent.click(screen.getByRole('button', { name: 'today.extend' }))
    await waitFor(() => expect(state.extendPlan).toHaveBeenCalled())
  })
})
