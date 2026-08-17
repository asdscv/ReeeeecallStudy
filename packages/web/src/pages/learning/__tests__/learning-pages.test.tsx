/**
 * Learning pages — the product surface over the engine.
 *
 * The assertion that matters most here is the NEGATIVE one: opening the page must not
 * write a plan. `save_daily_plan` is capped at 50 writes per user per day, so a
 * generate-on-mount effect would spend a real quota and then fail for the rest of the
 * day. The rest cover the states a user can actually get stuck in (no goal, no decks,
 * nothing due, quota spent) — each of which has to say something different.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

type StoreState = Record<string, unknown>

const { storeState, mockConfirm, deckState } = vi.hoisted(() => ({
  storeState: { current: {} as StoreState },
  mockConfirm: vi.fn(),
  // Mutable so a test can hand the screen more decks than it will name. The goal-deck summary
  // resolves names through this store, so a fixed list could not exercise the "+N more" path.
  deckState: { decks: [{ id: 'deck-1', name: 'Deck one' }] as Array<{ id: string; name: string }> },
}))

vi.mock('../../../stores/learning-store', () => ({
  useLearningStore: () => storeState.current,
}))
vi.mock('../../../stores/confirm-store', () => ({
  useConfirmStore: (selector: (s: { confirm: unknown }) => unknown) =>
    selector({ confirm: mockConfirm }),
}))
vi.mock('../../../stores/auth-store', () => ({ useAuthStore: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../stores/deck-store', () => ({
  // `stats` mirrors the real store's initial state — GoalFormModal reads it to size the plan
  // preview from `get_deck_stats`, and an omitted field here is a mock defect, not a
  // component contract to code defensively around.
  useDeckStore: () => ({
    decks: deckState.decks,
    stats: [{ deck_id: 'deck-1', deck_name: 'Deck one', total_cards: 40, new_cards: 30, review_cards: 8, learning_cards: 2, last_studied: null }],
    fetchDecks: vi.fn(), fetchStats: vi.fn(),
  }),
}))

import { LearningTodayPage } from '../LearningTodayPage'
import { LearningGoalsPage } from '../LearningGoalsPage'
import { currentPlanContext } from '../../../lib/learning-plan-date'

const goal = {
  id: 'goal-1', domain_id: 'language', title: 'JLPT N2', target_date: null,
  daily_minutes: 20, status: 'active', target: {}, settings: {},
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
  decks: [{ deck_id: 'deck-1', importance: 0.5 }],
}

const baseState = (over: StoreState = {}): StoreState => ({
  // Mirrors the real store's initial state. `knowledge` feeds the plan's progress header;
  // omitting it here is a mock defect, not a reason to make the component defensive.
  knowledge: {},
  knowledgeLoading: false,
  fetchGoalKnowledge: vi.fn(),
  // Server-judged completion stamp. A no-op here; its own cases drive it directly.
  completeGoalIfEarned: vi.fn().mockResolvedValue(false),
  goals: [goal],
  goalsLoading: false,
  goalsError: null,
  plan: null,
  planItems: [],
  planCards: {},
  planLoading: false,
  planGenerating: false,
  planError: null,
  planBlockedReason: null,
  fetchGoals: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  archiveGoal: vi.fn(),
  deleteGoal: vi.fn(),
  // `null`, like the real store: "never asked", as distinct from "asked, and empty".
  archivedGoals: null,
  archivedGoalsLoading: false,
  fetchArchivedGoals: vi.fn(),
  restoreGoal: vi.fn(),
  setGoalDecks: vi.fn(),
  fetchPlan: vi.fn(),
  generatePlan: vi.fn(),
  autoGeneratePlan: vi.fn(),
  planAbsentFor: null,
  autoPlanAttempted: {},
  extendPlan: vi.fn(),
  planExtending: false,
  planExtension: null,
  // The day strip's future days. Keyed by plan date, and `{}` means "nothing forecast yet" —
  // which is what every test here is, since none of them switch off today.
  planForecast: {},
  planForecastLoading: null,
  forecastPlan: vi.fn(),
  recordingItemId: null,
  attempts: [],
  attemptsLoading: false,
  // These two return `Promise<boolean>` in the real store and the page chains off both —
  // refetching attempts after a rating, and clearing the row spinner after a request. A bare
  // vi.fn() returns undefined, so the mock has to keep the promise or the page throws on a
  // path that works in production.
  recordAttempt: vi.fn().mockResolvedValue(true),
  fetchAttempts: vi.fn(),
  // The diagnostics panel. `insights: null` is the real store's initial state — the panel
  // renders nothing until a read lands, which is what most of these tests exercise.
  insights: null,
  weakCardDecks: {},
  insightsLoading: false,
  insightsGoalId: null,
  fetchInsights: vi.fn(),
  // The diagnosis panel, added beside the accuracy line. `null` is the real store's initial
  // state — the panel renders nothing until a read lands, which is what every test here is.
  diagnosisEvidence: null,
  diagnosisEvidenceGoalId: null,
  diagnosisEvidenceLoading: false,
  diagnosis: {},
  diagnosisBusyGoalId: null,
  diagnosisError: null,
  fetchDiagnosisEvidence: vi.fn(),
  requestDiagnosis: vi.fn().mockResolvedValue(true),
  ...over,
})

/**
 * The plan date the page computes for itself.
 *
 * Derived from the same function the page uses rather than hardcoded: the key is a LOCAL
 * calendar date, so a fixed string passes in Seoul and fails in CI's UTC — the kind of test that
 * only goes red on someone else's machine.
 */
const todayKey = () => currentPlanContext().planDate

const renderToday = (over: StoreState = {}) => {
  storeState.current = baseState(over)
  // The plan is addressed by URL now — `/learning/:goalId` — instead of being chosen from a
  // dropdown repeated on three sibling screens.
  render(
    <MemoryRouter initialEntries={['/learning/goal-1']}>
      <Routes><Route path="/learning/:goalId" element={<LearningTodayPage />} /></Routes>
    </MemoryRouter>,
  )
  return storeState.current
}

const renderGoals = (over: StoreState = {}) => {
  storeState.current = baseState(over)
  render(<MemoryRouter><LearningGoalsPage /></MemoryRouter>)
  return storeState.current
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfirm.mockResolvedValue(true)
  deckState.decks = [{ id: 'deck-1', name: 'Deck one' }]
})

describe('LearningTodayPage', () => {
  it('reads on open, and asks the store whether a plan should be built', () => {
    // REVERSED, deliberately. This used to assert that opening the page never writes a plan,
    // guarding the 50-saves-per-day cap against a mount effect that fired on `plan === null` —
    // a value that also means "not read yet" and "the read failed".
    //
    // The guard now lives where it can actually be correct: `autoGeneratePlan` acts only on
    // `planAbsentFor`, which only a SUCCESSFUL read sets, and attempts once per goal per day.
    // The page therefore always asks, and the store decides. What the page must NOT do is call
    // `generatePlan` directly on mount, which is what the next assertion pins.
    const state = renderToday()

    expect(state.fetchGoals).toHaveBeenCalled()
    expect(state.fetchPlan).toHaveBeenCalledWith('goal-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(state.autoGeneratePlan).toHaveBeenCalled()
    // Still never the unguarded write.
    expect(state.generatePlan).not.toHaveBeenCalled()
  })

  it('says it is building rather than offering a button, while automation still has its turn', async () => {
    // The state right after an empty read: the effect is about to write. Showing a button here
    // would flash for a frame and then vanish under the learner's finger.
    renderToday({ planAbsentFor: 'goal-1|' + todayKey(), autoPlanAttempted: {} })

    expect(screen.queryByRole('button', { name: 'today.generate' })).not.toBeInTheDocument()
    expect(screen.getByText('today.generating')).toBeInTheDocument()
  })

  it('falls back to a button once automation has had its turn and produced nothing', async () => {
    // The reachable failure path: the one automatic attempt was spent and no plan came back.
    // Without this the learner has no way to plan for the rest of the day.
    const state = renderToday({
      planAbsentFor: 'goal-1|' + todayKey(),
      autoPlanAttempted: { ['goal-1|' + todayKey()]: true },
    })

    await userEvent.click(screen.getByRole('button', { name: 'today.generate' }))

    expect(state.generatePlan).toHaveBeenCalledTimes(1)
  })

  it('sends a URL that names no plannable goal back to the list', () => {
    // Archived, deleted, or someone else's id. Falling back to "the first goal" would serve a
    // different plan under this URL, which is worse than an empty state.
    renderToday({ goals: [] })

    expect(screen.getByText('today.empty.noGoal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'today.backToPlans' }))
      .toHaveAttribute('href', '/learning')
    expect(screen.queryByRole('button', { name: 'today.generate' })).not.toBeInTheDocument()
  })

  it('explains a goal with no decks rather than showing a failure', () => {
    renderToday({ planBlockedReason: 'no_decks' })

    expect(screen.getByText('today.empty.noDecks')).toBeInTheDocument()
  })

  it('does not promise tomorrow when the cards come back in minutes', () => {
    // Photographed on production saying "오늘 할 건 다 했어요. 내일 또 만나요." with the next
    // review SEVEN MINUTES away. After a session that is the normal case, not an edge one:
    // anything rated 몰랐음 returns in one to ten minutes.
    renderToday({
      plan: { id: 'p1', goal_id: 'goal-1', plan_date: currentPlanContext().planDate,
        total_items: 6, completed_items: 6 },
      planItems: [],
      knowledge: {
        'goal-1': {
          total: 6, known: 0, unknown: 6, unseen: 0, overdue: 0, dueNow: 0,
          mature: 0, rung1: 6, rung3: 0, rung8: 0,
          nextDueAt: new Date(Date.now() + 7 * 60_000).toISOString(),
        },
      },
    })

    expect(screen.getByText(/today\.backSoonNote/)).toBeInTheDocument()
    expect(screen.queryByText('today.allDoneNote')).not.toBeInTheDocument()
  })

  it('does promise tomorrow when tomorrow is when they come back', () => {
    renderToday({
      plan: { id: 'p1', goal_id: 'goal-1', plan_date: currentPlanContext().planDate,
        total_items: 6, completed_items: 6 },
      planItems: [],
      knowledge: {
        'goal-1': {
          total: 6, known: 6, unknown: 0, unseen: 0, overdue: 0, dueNow: 0,
          mature: 0, rung1: 0, rung3: 6, rung8: 0,
          nextDueAt: new Date(Date.now() + 20 * 3600_000).toISOString(),
        },
      },
    })

    expect(screen.getByText('today.allDoneNote')).toBeInTheDocument()
  })

  describe('nothing due', () => {
    // "오늘 이 덱들에서 복습할 카드가 없습니다" read as a failure — as though the cards had gone
    // somewhere. In the reported state the opposite was true: the learner had just finished
    // today's twelve items and twelve cards were coming back inside ten minutes. "Nothing due"
    // is three situations, and only the last needs the learner to do anything.
    const withNextDue = (nextDueAt: string | null) => ({
      planBlockedReason: 'no_candidates',
      knowledge: {
        'goal-1': {
          total: 29, known: 17, unknown: 12, unseen: 0, overdue: 0, dueNow: 0,
          mature: 14, rung1: 12, rung3: 0, rung8: 3, nextDueAt,
        },
      },
    })

    it('leads with the good news, whichever case it is', () => {
      renderToday(withNextDue(null))
      expect(screen.getByText('today.empty.allCaughtUp')).toBeInTheDocument()
    })

    it('says the cards are coming back when they are minutes away', () => {
      renderToday(withNextDue(new Date(Date.now() + 8 * 60_000).toISOString()))
      expect(screen.getByText(/today\.empty\.backSoon/)).toBeInTheDocument()
    })

    it('names the time when the next review is not soon', () => {
      renderToday(withNextDue(new Date(Date.now() + 26 * 3600_000).toISOString()))
      expect(screen.getByText(/today\.empty\.nextReview/)).toBeInTheDocument()
    })

    it('says the goal has run out only when nothing is scheduled at all', () => {
      // The one case that is genuinely bad news, and the only one that should ask the learner
      // for something.
      renderToday(withNextDue(null))
      expect(screen.getByText('today.empty.nothingScheduled')).toBeInTheDocument()
    })
  })

  it('renders the quota failure with its own message, not a generic one', () => {
    renderToday({ planError: { code: 'LIMIT_EXCEEDED', message: 'limit' } })

    expect(screen.getByRole('alert')).toHaveTextContent('today.error.limitExceeded')
  })

  it('names the decks the plan draws from', () => {
    // Asked for: "화면들어가면 어떤 덱 선택되어 있는지 표시". Read from `goal.decks` — the
    // goal's own link table, i.e. what the PLANNER draws from — not from the decks that
    // happen to appear in today's plan, which would hide one that contributed nothing today.
    renderToday()

    expect(screen.getByText('Deck one')).toBeInTheDocument()
  })

  it('counts the rest once there are too many to name', () => {
    // "수십 개 선택할 수도 있으니까 적당히 잘 표시할 수 잇또록". Three names then a count,
    // rather than a paragraph of deck names above the number the learner opened the screen for.
    deckState.decks = Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, name: `Deck ${i}` }))
    renderToday({
      goals: [{
        ...goal,
        decks: deckState.decks.map((deck) => ({ deck_id: deck.id, importance: 0.5 })),
      }],
    })

    expect(screen.getByText(/today\.deckListMore/)).toBeInTheDocument()
  })

  it('drops a deck it cannot name rather than printing an id', () => {
    // A deck deleted or no longer visible. An id on screen is worse than a shorter list.
    deckState.decks = [{ id: 'deck-1', name: 'Deck one' }]
    renderToday({
      goals: [{
        ...goal,
        decks: [{ deck_id: 'deck-1', importance: 0.5 }, { deck_id: 'GONE', importance: 0.5 }],
      }],
    })

    expect(screen.getByText('Deck one')).toBeInTheDocument()
    expect(screen.queryByText(/GONE/)).not.toBeInTheDocument()
  })

  it('sends the day into the real study session, carrying the plan with it', () => {
    renderToday({
      plan: {
        id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
        algorithm_version: 'daily-plan-v1', input_fingerprint: 'fnv1a32:abc', status: 'pending',
        budget_minutes: 20, completed_minutes: 0, completed_items: 0, total_items: 1,
      },
      planItems: [{
        id: 'item-1', plan_id: 'plan-1', position: 0, activity_id: null, card_id: 'card-1',
        concept_id: null, activity_type: 'recall', stimulus_type: 'text',
        response_type: 'self_rate', evaluator_type: 'self_rate', reason_code: 'recent_failure',
        priority: 0.7, estimated_minutes: 0.5, status: 'pending',
      }],
      planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } },
    })

    // It used to be `/decks/:id/study/setup` — the whole deck, no plan context — so the plan and
    // the session each did their own thing and neither knew about the other.
    expect(screen.getByRole('link', { name: /today\.startStudy/ }))
      .toHaveAttribute('href', `/decks/deck-7/study?mode=srs&goalId=goal-1&planDate=${todayKey()}`)
  })

  // ── what the day is made of ───────────────────────────────────────────────
  //
  // This replaced a per-card list: one row per item, each with its planner reason, its recall
  // estimate and its minute cost. Thirty rows of scroll, nothing on them to tap, every row
  // reading the same phrase, and the numbers frozen at the moment the planner ran. The question
  // it was actually answering — "what am I in for?" — is reviews versus cards never seen.
  const item = (id: string, payload: unknown, status = 'pending') => ({
    id, plan_id: 'plan-1', position: 0, activity_id: null, card_id: `card-${id}`,
    concept_id: null, activity_type: 'recall', stimulus_type: 'text',
    response_type: 'self_rate', evaluator_type: 'self_rate', reason_code: 'memory_risk',
    priority: 0.7, estimated_minutes: 0.5, status, payload,
  })
  const mixedPlan = (planItems: unknown[]) => ({
    plan: {
      id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
      algorithm_version: 'daily-plan-v2', input_fingerprint: 'fnv1a32:abc', status: 'pending',
      budget_minutes: 20, completed_minutes: 0, completed_items: 0, total_items: planItems.length,
    },
    planItems,
    planCards: Object.fromEntries((planItems as { card_id: string }[]).map((row) => [
      row.card_id, { id: row.card_id, deck_id: 'deck-7', field_values: { front: '猫' } },
    ])),
  })

  it('splits the remaining work into reviews and cards never seen', () => {
    renderToday(mixedPlan([
      item('a', { recall_probability: 0.523 }),
      item('b', { recall_probability: 0.1 }),
      item('c', {}),
    ]))

    const line = screen.getByTestId('today-composition')
    expect(line).toHaveTextContent('today.composition.review')
    expect(line).toHaveTextContent('today.composition.fresh')
    // No per-card rows: the card's own text appears nowhere on the plan screen.
    expect(screen.queryByText('猫')).not.toBeInTheDocument()
  })

  it('leaves out a half with nothing in it rather than printing a zero', () => {
    renderToday(mixedPlan([item('a', { recall_probability: 0.523 })]))

    const line = screen.getByTestId('today-composition')
    expect(line).toHaveTextContent('today.composition.review')
    expect(line).not.toHaveTextContent('today.composition.fresh')
  })

  it('counts what is left, not what the morning held', () => {
    // A finished item stops being something the learner is "in for". Counting it would leave the
    // line describing a day that has already partly happened, beside a number that does not.
    renderToday(mixedPlan([
      item('a', { recall_probability: 0.523 }, 'completed'),
      item('b', {}),
    ]))

    const line = screen.getByTestId('today-composition')
    expect(line).toHaveTextContent('today.composition.fresh')
    expect(line).not.toHaveTextContent('today.composition.review')
  })

  it('treats a recall estimate of zero as a review, not a new card', () => {
    // `0` is a card that has been studied and forgotten; a new card has no estimate at all. A
    // truthiness check here would file every forgotten card under "new".
    renderToday(mixedPlan([item('a', { recall_probability: 0 })]))

    const line = screen.getByTestId('today-composition')
    expect(line).toHaveTextContent('today.composition.review')
    expect(line).not.toHaveTextContent('today.composition.fresh')
  })

  it('offers no way to rebuild the day', () => {
    // "플랜 다시 만들기" DELETED every item and zeroed the day's progress, sitting one tap from
    // a learner halfway through. `extendPlan` (mig 185) covers the only case anyone wanted it
    // for — more work — without throwing away what is already done.
    renderToday({
      plan: {
        id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
        algorithm_version: 'daily-plan-v1', input_fingerprint: 'fnv1a32:abc', status: 'completed',
        budget_minutes: 20, completed_minutes: 20, completed_items: 1, total_items: 1,
      },
      planItems: [],
    })

    expect(screen.queryByRole('button', { name: 'today.regenerate' })).not.toBeInTheDocument()
  })

  // ── "더 하기" ────────────────────────────────────────────────────────────
  const completedPlan = {
    plan: {
      id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
      algorithm_version: 'daily-plan-v1', input_fingerprint: 'fnv1a32:abc', status: 'completed',
      budget_minutes: 20, completed_minutes: 20, completed_items: 1, total_items: 1,
    },
    planItems: [],
  }

  it('offers more work on a finished day, when rebuilding is refused', async () => {
    // The day a learner is doing BEST is the day the product had nothing to offer: the plan is
    // complete, so `save_daily_plan` refuses it, and there was no other way to add work.
    const state = renderToday(completedPlan)

    const button = screen.getByRole('button', { name: 'today.extend' })
    expect(button).toBeEnabled()

    await userEvent.click(button)
    expect(state.extendPlan).toHaveBeenCalledTimes(1)
    // Never the destructive one.
    expect(state.generatePlan).not.toHaveBeenCalled()
  })

  it('does not offer more work on a day that has not been done', async () => {
    // It sat under "28장 남음" and invited a learner to grow a list they had not started. Every
    // card added today comes back tomorrow, so the button's real cost lands on a day they have
    // not seen — it is an "I want more", not an "instead of this".
    renderToday({
      plan: {
        id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
        algorithm_version: 'daily-plan-v1', input_fingerprint: 'fnv1a32:abc', status: 'pending',
        budget_minutes: 20, completed_minutes: 0, completed_items: 0, total_items: 2,
      },
      planItems: [
        { id: 'i1', plan_id: 'plan-1', position: 0, activity_id: null, card_id: 'card-1',
          concept_id: null, activity_type: 'recall', stimulus_type: 'text',
          response_type: 'self_rate', evaluator_type: 'self_rate', reason_code: 'due',
          priority: 0.7, estimated_minutes: 0.5, status: 'pending' },
      ],
      planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } },
    })

    expect(screen.queryByRole('button', { name: 'today.extend' })).not.toBeInTheDocument()
  })

  it('says how much tomorrow grows', async () => {
    // The one cost of "더 하기" the learner cannot see today. Left unsaid, a learner presses it
    // four times tonight and meets a tripled list tomorrow with no idea why.
    renderToday({
      ...completedPlan,
      planExtension: { appended: 12, newCards: 5, reviewsTomorrow: 5 },
    })

    expect(screen.getByText(/today\.extendAdded/)).toBeInTheDocument()
    expect(screen.getByText(/today\.extendTomorrow/)).toBeInTheDocument()
  })

  it('stays quiet about tomorrow when the extra work is all review', async () => {
    // Reviews were coming back on their own schedule anyway. Claiming they add load would make
    // the one sentence that matters into noise the learner learns to skip.
    renderToday({
      ...completedPlan,
      planExtension: { appended: 12, newCards: 0, reviewsTomorrow: 0 },
    })

    expect(screen.getByText(/today\.extendAdded/)).toBeInTheDocument()
    expect(screen.queryByText(/today\.extendTomorrow/)).not.toBeInTheDocument()
  })

  it('says so plainly when there was nothing left to add', async () => {
    // Otherwise a press that appended zero items looks identical to one that worked.
    renderToday({
      ...completedPlan,
      planExtension: { appended: 0, newCards: 0, reviewsTomorrow: 0 },
    })

    expect(screen.getByText('today.extendNothing')).toBeInTheDocument()
  })

  // ── where the goal stands ─────────────────────────────────────────────────
  //
  // Reported after studying a single card: "확실 1, 흔들림 18, 미시작 10 뭐지?". Every number was
  // right. `known` means "not past due", so one rating on an overdue card moves a card there —
  // but the screen called it 확실 and headlined "29장 중 1장 기억", which reads as having
  // forgotten 28 cards. The RPC never made that claim.
  /**
   * `overdue` defaults to `unknown` here only because these cases predate it and mean
   * "everything out of window is genuinely late". It is a SEPARATE input now: `unknown`
   * includes cards in a 1-minute learning step, and reading the backlog off it is what told a
   * learner who had just finished today that they were twelve reviews behind.
   */
  const knowledgeOf = (known: number, unknown: number, unseen: number, overdue = unknown) => ({
    knowledge: {
      'goal-1': {
        total: known + unknown + unseen, known, unknown, unseen,
        overdue, dueNow: overdue,
      },
    },
  })

  // ── the finish line ───────────────────────────────────────────────────────
  //
  // "로직으로 저 학습플랜 완료하는건 언제야?" — there was no answer anywhere. The status value,
  // the transition and the `target` column all existed; nothing ever decided.
  const withMastery = (over: Record<string, number>) => ({
    knowledge: {
      'goal-1': {
        total: 10, unseen: 0, known: 10, unknown: 0,
        mature: 0, rung1: 0, rung3: 0, rung8: 0, ...over,
      },
    },
    insightsGoalId: 'goal-1',
  })

  it('asks the server whether the goal has earned its stamp', () => {
    // The client says WHICH goal, never whether. `complete_goal_if_earned` re-checks — the
    // rule lives in one place rather than in whichever client implemented it.
    const state = renderToday()

    expect(state.completeGoalIfEarned).toHaveBeenCalledWith('goal-1')
  })

  it('says how far the goal is from its finish line, and when', () => {
    // 10 cards, needs 8 mature, has 6, and two are one review from maturing.
    renderToday(withMastery({ mature: 6, rung8: 2, rung1: 2 }))

    const line = screen.getByTestId('goal-completion')
    expect(line).toHaveTextContent('completion.progress')
    expect(line).toHaveTextContent('completion.eta')
  })

  it('gives no date when there is no honest one', () => {
    // Unseen cards with no intake cap: "start them all at once" has no day count. The line
    // still says how far off the goal is — a missing date is not a missing sentence.
    renderToday({
      ...withMastery({ mature: 0, unseen: 10, known: 0 }),
      goals: [{ ...goal, settings: {} }],
    })

    const line = screen.getByTestId('goal-completion')
    expect(line).toHaveTextContent('completion.progress')
  })

  it('keeps a completed goal open rather than making it vanish', () => {
    // Found while writing the test above: `plannableGoals` filtered on status === 'active', so
    // stamping a goal completed removed it from this screen entirely — the learner would reach
    // the milestone and be shown "no goal". `save_daily_plan` rejects only ARCHIVED goals, so
    // the server was always willing; the client was not.
    renderToday({ goals: [{ ...goal, status: 'completed' }] })

    expect(screen.queryByText('today.empty.noGoal')).not.toBeInTheDocument()
    expect(screen.getByText('JLPT N2')).toBeInTheDocument()
  })

  it('shows the stamp rather than recomputing the ratio', () => {
    // Completion is a RECORD. `again_days = 0` drops a lapsed card out of mature, so a live
    // reading would un-complete a finished goal on one wrong answer — 100% to 50% on a
    // two-card goal. The goal below is stamped while its current ratio is 0%.
    renderToday({
      ...withMastery({ mature: 0, rung1: 10 }),
      goals: [{ ...goal, status: 'completed' }],
    })

    expect(screen.getByTestId('goal-complete')).toHaveTextContent('completion.done')
    expect(screen.queryByTestId('goal-completion')).not.toBeInTheDocument()
  })

  it('leads with the backlog when the learner is behind', () => {
    renderToday(knowledgeOf(1, 18, 10))

    expect(screen.getByTestId('progress-headline')).toHaveTextContent('progress.behind')
    // The detail line no longer swaps populations with the headline. It used to print a bare
    // "배운 29장" in this state — a count with no denominator, one line under a different count
    // with a different one — and every number on the card is now a named part of `total`.
    expect(screen.getByTestId('progress-detail')).toHaveTextContent('progress.detailWithinWindow')
    expect(screen.getByTestId('progress-detail')).not.toHaveTextContent('progress.detailStudied')
  })

  it('does not call a just-finished day a backlog', () => {
    // The report: twelve items done, their cards now in learning steps, nothing actually
    // late. `unknown` is 12 and `overdue` is 0 — the headline follows `overdue`.
    renderToday(knowledgeOf(17, 12, 0, 0))

    expect(screen.getByTestId('progress-headline')).not.toHaveTextContent('progress.behind')
  })

  it('names the goal total once nothing is overdue', () => {
    // Reported as "17장은 뭐고 12장은 뭐야": with no backlog the old sentence became "17장 중
    // 17장이 복습 주기 안에" — true, vacuous, and never naming the 29 cards those numbers are
    // parts of, above a plan card offering the 12 it did not mention.
    renderToday(knowledgeOf(17, 0, 12))

    // This file's `t` mock echoes the KEY only, so which sentence rendered is what can be
    // asserted here. The numbers inside it are pinned by goal-knowledge-summary.test.ts and by
    // the bar below, which reads the same `percent`.
    expect(screen.getByTestId('progress-headline')).toHaveTextContent('progress.studied')

    const detail = screen.getByTestId('progress-detail')
    expect(detail).toHaveTextContent('progress.detailWithinWindow')
    // The number that ties this card to the plan card below it: those 12 ARE today's work.
    expect(detail).toHaveTextContent('progress.unstudied')
  })

  it('draws the bar against the finish line the card itself names', () => {
    // The bar is 정착 / 목표 — the same statement as the line under it. It used to be
    // `attempted / total`, cards opened at least once, which fills as soon as every card has
    // been seen: a learner photographed a 100% bar sitting directly above "복습이 12장
    // 밀렸어요" and "완료까지 약 25일". Three lines, three different questions, none named.
    //
    // 29 cards → ceil(29 × 0.8) = 24 must mature. Six are. 6/24 = 25%.
    renderToday({
      knowledge: {
        'goal-1': {
          total: 29, known: 17, unknown: 0, unseen: 12, overdue: 0, dueNow: 0,
          mature: 6, rung1: 0, rung3: 0, rung8: 11,
        },
      },
    })

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  })

  it('drops the review half when every card is mid-learning-step', () => {
    // A learner who just answered everything has `known: 0` — every card is in a 1- or
    // 10-minute step. "복습 주기 안 0장" is a sentence about nothing, and this is the ordinary
    // state right after a session, not an edge case. Found on a live account.
    renderToday(knowledgeOf(0, 6, 0, 0))

    // Both halves are empty, so the line does not render at all — rather than rendering as
    // "복습 주기 안 0장".
    expect(screen.queryByTestId('progress-detail')).not.toBeInTheDocument()
  })

  it('still names the review half when there is one', () => {
    renderToday(knowledgeOf(17, 12, 0, 0))
    expect(screen.getByTestId('progress-detail')).toHaveTextContent('detailWithinWindow')
  })

  it('drops a half of the detail line that has nothing in it', () => {
    // Every card opened, nothing overdue: no "아직 안 배움 0장", which is a sentence about nothing.
    renderToday(knowledgeOf(29, 0, 0))

    const detail = screen.getByTestId('progress-detail')
    expect(detail).toHaveTextContent('progress.detailWithinWindow')
    expect(detail).not.toHaveTextContent('progress.unstudied')
  })

  it('reports "not started" rather than a confident 0%', () => {
    renderToday(knowledgeOf(0, 0, 29))

    expect(screen.getByTestId('progress-headline')).toHaveTextContent('progress.notStarted')
    // The headline already gave the total, so there is nothing left for a detail line to add.
    expect(screen.queryByTestId('progress-detail')).not.toBeInTheDocument()
  })
})

// ── the diagnostics panel ──────────────────────────────────────────────────
//
// "차라리 ai를 통해서 학습한 것들 전체적으로 분석해서 뭐가 잘되고 뭐가 잘 안되는지 확인한다든지
// 이런게 낫지 않나 / 개별 카드 설명이 뭐가 도움이 되겠어" — right, and the engine for it
// (`summarizeLearning`) had been in the repo the whole time with nothing rendering it.
describe('learning diagnostics', () => {
  const insightsOf = (over: Record<string, unknown> = {}) => ({
    insightsGoalId: 'goal-1',
    insights: {
      attemptCount: 40, scoredCount: 38, accuracy: 0.75, medianDurationMs: 6200,
      weakCards: [], adherence: [], overallAdherence: 0.9, ...over,
    },
  })

  it('says nothing at all before anything has been studied', () => {
    // Not an empty state to decorate. There is no diagnosis to give.
    renderToday(insightsOf({ attemptCount: 0, scoredCount: 0, accuracy: null }))

    expect(screen.queryByTestId('insights-stats')).not.toBeInTheDocument()
  })

  it('will not show one goal\'s diagnosis under another goal\'s heading', () => {
    // `fetchInsights` leaves the previous goal's numbers in the store until the new read
    // lands. Rendering them meanwhile would attribute one goal's accuracy to another.
    renderToday({ ...insightsOf(), insightsGoalId: 'goal-OTHER' })

    expect(screen.queryByTestId('insights-stats')).not.toBeInTheDocument()
  })

  it('reports ONE number, and says what window it is over', () => {
    // This line was "정답률 78% · 보통 1초 · 플랜 49% 이행" and a learner asked, verbatim,
    // "플랜 49% 이행은 뭐야? 유저가 알기가 너무 힘들다."
    //
    //   - the three numbers spanned two windows (30 days, 30 days, 14 days) and printed
    //     neither, while "알았음 6 · 몰랐음 6" — 50%, today — sat two inches above;
    //   - 보통 1초 was the median dwell on a card INCLUDING reading the answer: how fast you
    //     tap a button already showing you the answer, not how fast you recall;
    //   - 플랜 이행 named no window, numerator or denominator, and no action taken today could
    //     move it.
    renderToday(insightsOf())

    const stats = screen.getByTestId('insights-stats')
    expect(stats).toHaveTextContent('insights.accuracyValue')
    expect(stats).not.toHaveTextContent('insights.typicalValue')
    expect(stats).not.toHaveTextContent('insights.adherenceValue')
  })

  it('does not explain which rows it read', () => {
    // `scopeNote` answered "이 목표의 시도와 플랜을 기준으로 계산합니다" — which rows were
    // queried. That is the one question no learner has ever asked about this screen.
    renderToday(insightsOf())
    expect(screen.queryByText('insights.scopeNote')).not.toBeInTheDocument()
  })

  it('says "not scored yet" instead of claiming 0% accuracy', () => {
    // `accuracy === null` means no attempt carried a score. That is a different statement
    // from "you got everything wrong", and the second one would be a lie.
    renderToday(insightsOf({ accuracy: null }))

    expect(screen.getByTestId('insights-stats')).toHaveTextContent('insights.notScoredYet')
  })

  it('offers weak cards as a button, never as a list of words', () => {
    // The failure mode this screen has been cleaned of twice: naming cards the learner got
    // wrong with nothing to do about them. The link studies exactly those cards — the
    // ordinary SRS queue would never serve them, because a card you keep failing is not due.
    renderToday({
      ...insightsOf({
        weakCards: [
          { cardId: 'card-1', attempts: 3, meanScore: 0.2 },
          { cardId: 'card-2', attempts: 2, meanScore: 0.5 },
        ],
      }),
      weakCardDecks: { 'card-1': 'deck-7', 'card-2': 'deck-7' },
      planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } },
    })

    // `goalId` is not decoration: the session carries it to `apply_study_rating`, which records
    // the rating as evidence for this goal (mig 244). Without it the panel that CHOSE these
    // cards never sees that they were studied and hands back the same list forever.
    expect(screen.getByRole('link', { name: /insights\.weakStudy/ }))
      .toHaveAttribute('href', '/decks/deck-7/study?mode=srs&cards=card-1,card-2&goalId=goal-1')
    // The card's own text never appears.
    expect(screen.queryByText('猫')).not.toBeInTheDocument()
  })

  it('splits weak cards by deck, because a session cannot span decks', () => {
    // `finalize_study_session` takes one p_deck_id and refuses events covering more.
    renderToday({
      ...insightsOf({
        weakCards: [
          { cardId: 'card-1', attempts: 3, meanScore: 0.2 },
          { cardId: 'card-9', attempts: 3, meanScore: 0.3 },
        ],
      }),
      weakCardDecks: { 'card-1': 'deck-7', 'card-9': 'deck-9' },
    })

    const links = screen.getAllByRole('link', { name: /insights\.weakCount/ })
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/decks/deck-7/study?mode=srs&cards=card-1&goalId=goal-1',
      '/decks/deck-9/study?mode=srs&cards=card-9&goalId=goal-1',
    ])
  })

  it('drops a weak card whose deck could not be resolved', () => {
    // Deleted since the diagnostics were computed. A button that starts a session over a card
    // the deck no longer has would open an empty queue.
    renderToday({
      ...insightsOf({ weakCards: [{ cardId: 'gone', attempts: 3, meanScore: 0.1 }] }),
      weakCardDecks: {},
    })

    expect(screen.queryByTestId('insights-weak')).not.toBeInTheDocument()
    // The stats line still renders — one unresolvable card is not a reason to hide everything.
    expect(screen.getByTestId('insights-stats')).toBeInTheDocument()
  })
})

// ── attempt recording (Phase 2) ─────────────────────────────────────────────
describe('starting the day', () => {
  const planItem = {
    id: 'item-1', plan_id: 'plan-1', position: 0, activity_id: null, card_id: 'card-1',
    concept_id: null, activity_type: 'recall', stimulus_type: 'text',
    response_type: 'self_rate', evaluator_type: 'self_rate', reason_code: 'due',
    priority: 0.7, estimated_minutes: 0.5, status: 'pending' as const,
  }
  const planRow = {
    id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
    algorithm_version: 'daily-plan-v1', input_fingerprint: 'fnv1a32:abc', status: 'pending',
    budget_minutes: 20, completed_minutes: 0, completed_items: 0, total_items: 1,
  }
  const cards = { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '\u732b' } } }

  /**
   * The negative that defines this screen now.
   *
   * It used to render every plan item as a row with a textarea and three self-rating buttons.
   * That surface recorded an attempt and rescheduled NOTHING — its own small print said so —
   * so a learner who did their whole plan there moved no card's due date and got the same plan
   * back tomorrow. Studying belongs to the study session, which is one link away.
   */
  it('offers no rating surface of its own', () => {
    renderToday({ plan: planRow, planItems: [planItem], planCards: cards })

    expect(screen.queryByRole('button', { name: 'today.rate.known' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'today.rate.partial' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'today.rate.again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('carries the plan into the study session, so one rating does both halves', () => {
    renderToday({ plan: planRow, planItems: [planItem], planCards: cards })

    const cta = screen.getByRole('link', { name: /today\.startStudy/ })
    // goalId + planDate are what make this a PLAN session: the session page reads them, loads
    // the day's items, and rates through `apply_plan_study_rating` — one transaction that
    // reschedules the card and completes the plan item together.
    expect(cta).toHaveAttribute(
      'href', `/decks/deck-7/study?mode=srs&goalId=goal-1&planDate=${todayKey()}`,
    )
  })

  it('says "keep going" once part of the day is already done', () => {
    renderToday({
      plan: { ...planRow, total_items: 2, completed_items: 1 },
      planItems: [{ ...planItem, status: 'completed' as const },
        { ...planItem, id: 'item-2', position: 1, card_id: 'card-2' }],
      planCards: { ...cards, 'card-2': { id: 'card-2', deck_id: 'deck-7', field_values: { front: '\u72ac' } } },
    })

    expect(screen.getByRole('link', { name: /today\.continueStudy/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /today\.startStudy/ })).not.toBeInTheDocument()
  })

  it('says the day is finished instead of offering a start button', () => {
    renderToday({
      plan: { ...planRow, completed_items: 1 },
      planItems: [{ ...planItem, status: 'completed' as const }],
      planCards: cards,
    })

    expect(screen.getByText('today.allDoneNote')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /today\.startStudy/ })).not.toBeInTheDocument()
  })

  /**
   * `finalize_study_session` takes ONE deck id and refuses a session whose rating events span
   * decks, so a plan over two decks is two sessions. Showing them is the alternative to a
   * single button that would silently study only the first.
   */
  it('lists each deck separately, because a session cannot span decks', () => {
    renderToday({
      plan: { ...planRow, total_items: 2 },
      planItems: [planItem, { ...planItem, id: 'item-2', position: 1, card_id: 'card-2' }],
      planCards: {
        ...cards,
        'card-2': { id: 'card-2', deck_id: 'deck-9', field_values: { front: '\u72ac' } },
      },
    })

    // Both decks, each with its own way in. The primary CTA starts whichever the planner put
    // first; the list is the complete picture, so the second deck is never stranded.
    const links = screen.getAllByRole('link', { name: 'today.item.study' })
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/decks/deck-7/study?mode=srs&goalId=goal-1&planDate=${todayKey()}`,
      `/decks/deck-9/study?mode=srs&goalId=goal-1&planDate=${todayKey()}`,
    ])
  })

  it('marks a deck whose items are all finished as done, with no way back in', () => {
    renderToday({
      plan: { ...planRow, completed_items: 1 },
      planItems: [{ ...planItem, status: 'completed' as const }],
      planCards: cards,
    })

    // A 학습 link on a finished deck would spend a rating to earn a P0007 —
    // `record_answer_attempt` refuses to complete an item twice.
    expect(screen.queryByRole('link', { name: 'today.item.study' })).not.toBeInTheDocument()
    expect(screen.getByText('today.allDone')).toBeInTheDocument()
  })
})

describe('attempt history', () => {
  // Attempts are read for the PLAN'S DAY now, not "the last 50 rows" — a learner returning after
  // a week used to see last week's words under a heading about today. Fixtures therefore have to
  // land on the day the screen is showing.
  // Built from a LOCAL wall-clock string so it survives the local-date filter in any timezone —
  // a fixed UTC instant lands on the previous day west of Greenwich.
  const attemptAt = (hour: string) => new Date(`${todayKey()}T${hour}:00:00`).toISOString()

  it('says how the day went instead of listing the words that were in it', () => {
    // The old section printed one row per attempt: card prompt, rating word, timestamp. A column
    // of vocabulary in the one place a learner has just finished something and wants to know how
    // it went. Three numbers answer that; twenty rows do not.
    renderToday({
      attempts: [
        { id: 'a1', goal_id: 'goal-1', card_id: 'card-1', activity_id: null, plan_item_id: 'item-1',
          activity_type: 'recall', evaluator_type: 'self_rate', normalized_score: 1,
          duration_ms: 3000, created_at: attemptAt('01') },
        { id: 'a2', goal_id: 'goal-1', card_id: null, activity_id: null, plan_item_id: null,
          activity_type: 'recall', evaluator_type: 'self_rate', normalized_score: null,
          duration_ms: 0, created_at: attemptAt('00') },
      ],
      planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } },
    })

    expect(screen.getByText('history.title')).toBeInTheDocument()
    expect(screen.getByTestId('study-recap')).toHaveTextContent('history.recap')
    // A card the learner KNEW is counted, not printed — there is nothing to ask about it.
    expect(screen.getByTestId('study-recap')).toHaveTextContent('history.band.known')
    expect(screen.queryByText('猫')).not.toBeInTheDocument()
  })

  it('leaves out a band with nothing in it', () => {
    // "몰랐음 0" is a sentence about nothing, and a clean session should read as one word.
    renderToday({
      attempts: [
        { id: 'a1', goal_id: 'goal-1', card_id: 'card-1', activity_id: null, plan_item_id: 'item-1',
          activity_type: 'recall', evaluator_type: 'self_rate', normalized_score: 1,
          duration_ms: 3000, created_at: attemptAt('01') },
      ],
    })

    const recap = screen.getByTestId('study-recap')
    expect(recap).toHaveTextContent('history.band.known')
    expect(recap).not.toHaveTextContent('history.band.missed')
    expect(recap).not.toHaveTextContent('history.band.partial')
  })

  it('counts the day the screen is showing, not the last 50 rows the store holds', () => {
    // `fetchAttempts` reads 50 for the goal with no date bound, and the old list took the first
    // ten of them — so someone returning after a week read last week's work under a heading
    // about now.
    renderToday({
      attempts: [
        { id: 'old', goal_id: 'goal-1', card_id: 'card-1', activity_id: null, plan_item_id: null,
          activity_type: 'recall', evaluator_type: 'self_rate', normalized_score: 0,
          duration_ms: 1000, created_at: '2026-01-02T03:00:00.000Z' },
      ],
    })

    expect(screen.queryByText('history.title')).not.toBeInTheDocument()
  })

  it('renders nothing when there are no attempts yet', () => {
    renderToday({ attempts: [] })

    expect(screen.queryByText('history.title')).not.toBeInTheDocument()
  })

})

describe('LearningGoalsPage', () => {
  it('lists a goal with its deck count', () => {
    renderGoals()

    expect(screen.getByText('JLPT N2')).toBeInTheDocument()
    expect(screen.getByText('goals.deckCount')).toBeInTheDocument()
    expect(screen.queryByText('goals.noDecksWarning')).not.toBeInTheDocument()
  })

  it('warns when a goal has no decks, because it cannot be planned', () => {
    renderGoals({ goals: [{ ...goal, decks: [] }] })

    expect(screen.getByText('goals.noDecksWarning')).toBeInTheDocument()
  })

  it('asks for confirmation before archiving, and archives only on yes', async () => {
    const state = renderGoals()

    await userEvent.click(screen.getByRole('button', { name: 'goals.archive' }))

    expect(mockConfirm).toHaveBeenCalled()
    expect(state.archiveGoal).toHaveBeenCalledWith('goal-1')
  })

  it('does not archive when the confirmation is declined', async () => {
    mockConfirm.mockResolvedValue(false)
    const state = renderGoals()

    await userEvent.click(screen.getByRole('button', { name: 'goals.archive' }))

    expect(state.archiveGoal).not.toHaveBeenCalled()
  })

  // ── the archive drawer ────────────────────────────────────────────────────
  //
  // 보관 used to be a one-way trip: the status flip was real, but `fetchGoals` filtered the row
  // out and nothing anywhere read it back, so the goal and every plan it produced sat in the
  // database unreachable. `update_learning_goal` had allowed archived → active since mig 167 and
  // no client had ever called it.
  const archivedGoal = {
    ...goal, id: 'goal-9', title: 'JLPT N3', status: 'archived',
    decks: [{ deck_id: 'deck-3', importance: 0.5 }],
  }

  it('keeps the archive closed, and unread, until it is asked for', () => {
    const state = renderGoals()

    expect(screen.queryByTestId('learning-archive')).not.toBeInTheDocument()
    expect(state.fetchArchivedGoals).not.toHaveBeenCalled()
  })

  it('reads the archive on the press that opens it', async () => {
    const state = renderGoals()

    await userEvent.click(screen.getByRole('button', { name: 'goals.archived.show' }))

    expect(state.fetchArchivedGoals).toHaveBeenCalledTimes(1)
  })

  it('does not re-read an archive it already holds', async () => {
    // `null` is the only value that means "never asked" — `[]` is a real answer. Re-fetching on
    // every open would spend a round trip to learn what the store already knows.
    const state = renderGoals({ archivedGoals: [] })

    await userEvent.click(screen.getByRole('button', { name: 'goals.archived.show' }))

    expect(state.fetchArchivedGoals).not.toHaveBeenCalled()
  })

  it('lists an archived goal and reactivates it', async () => {
    const state = renderGoals({ archivedGoals: [archivedGoal] })

    await userEvent.click(screen.getByRole('button', { name: 'goals.archived.show' }))
    expect(screen.getByText('JLPT N3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'goals.archived.restore' }))
    expect(state.restoreGoal).toHaveBeenCalledWith('goal-9')
    // Nothing is destroyed and 보관 is right there to undo it, so no modal.
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('offers no way to open an archived plan', async () => {
    // `save_daily_plan` rejects an archived goal, so a link into the plan screen would be a tap
    // that can only produce an error. Reactivate first.
    renderGoals({ archivedGoals: [archivedGoal] })

    await userEvent.click(screen.getByRole('button', { name: 'goals.archived.show' }))

    expect(screen.queryByRole('link', { name: 'JLPT N3' })).not.toBeInTheDocument()
  })

  it('still offers delete inside the archive', async () => {
    // Otherwise the only way to be rid of an archived goal for good would be to reactivate it.
    const state = renderGoals({ goals: [], archivedGoals: [archivedGoal] })

    await userEvent.click(screen.getByRole('button', { name: 'goals.archived.show' }))
    await userEvent.click(screen.getByRole('button', { name: 'goals.delete' }))

    expect(mockConfirm).toHaveBeenCalled()
    expect(state.deleteGoal).toHaveBeenCalledWith('goal-9')
  })

  it('says the archive is empty only after it has looked', async () => {
    renderGoals({ archivedGoals: [] })

    await userEvent.click(screen.getByRole('button', { name: 'goals.archived.show' }))

    expect(screen.getByText('goals.archived.empty')).toBeInTheDocument()
  })

  it('shows an empty state instead of a bare list', () => {
    renderGoals({ goals: [] })

    expect(screen.getByText('goals.empty.title')).toBeInTheDocument()
  })

  it('opens the create form with the deck picker', async () => {
    renderGoals({ goals: [] })

    await userEvent.click(screen.getByRole('button', { name: 'goals.create' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Deck one')).toBeInTheDocument()
  })
})
