/**
 * Learning pages — the product surface over the engine.
 *
 * The assertion that matters most here is the NEGATIVE one: opening the page must not
 * write a plan. `save_daily_plan` is capped at 50 writes per user per day, so a
 * generate-on-mount effect would spend a real quota and then fail for the rest of the
 * day. The rest cover the states a user can actually get stuck in (no goal, no decks,
 * nothing due, quota spent) — each of which has to say something different.
 */
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

type StoreState = Record<string, unknown>

const { storeState, mockConfirm } = vi.hoisted(() => ({
  storeState: { current: {} as StoreState },
  mockConfirm: vi.fn(),
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
    decks: [{ id: 'deck-1', name: 'Deck one' }],
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
  enrichment: null,
  enrichmentPendingCardId: null,
  enrichmentError: null,
  enrichmentSaving: false,
  enrichmentQuote: null,
  requestEnrichment: vi.fn().mockResolvedValue(true),
  loadEnrichmentQuote: vi.fn().mockResolvedValue(undefined),
  resolveEnrichment: vi.fn(),
  dismissEnrichment: vi.fn(),
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

  it('says the day is clear when nothing is due', () => {
    renderToday({ planBlockedReason: 'no_candidates' })

    expect(screen.getByText('today.empty.nothingDue')).toBeInTheDocument()
  })

  it('renders the quota failure with its own message, not a generic one', () => {
    renderToday({ planError: { code: 'LIMIT_EXCEEDED', message: 'limit' } })

    expect(screen.getByRole('alert')).toHaveTextContent('today.error.limitExceeded')
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

  it('will not rebuild a completed plan (the RPC refuses it)', () => {
    renderToday({
      plan: {
        id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
        algorithm_version: 'daily-plan-v1', input_fingerprint: 'fnv1a32:abc', status: 'completed',
        budget_minutes: 20, completed_minutes: 20, completed_items: 1, total_items: 1,
      },
      planItems: [],
    })

    expect(screen.getByRole('button', { name: 'today.regenerate' })).toBeDisabled()
    expect(screen.getByText('today.completedNote')).toBeInTheDocument()
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
  const knowledgeOf = (known: number, unknown: number, unseen: number) => ({
    knowledge: { 'goal-1': { total: known + unknown + unseen, known, unknown, unseen } },
  })

  it('says what `known` measures instead of renaming it 확실', () => {
    renderToday(knowledgeOf(1, 18, 10))

    // The denominator is what has been STUDIED (19), not the whole goal (29).
    expect(screen.getByText(/progress\.withinWindow/)).toBeInTheDocument()
    expect(screen.queryByText(/progress\.knownNow/)).not.toBeInTheDocument()
    expect(screen.queryByText(/progress\.breakdown/)).not.toBeInTheDocument()
  })

  it('puts the overdue work first and drops halves that are empty', () => {
    renderToday(knowledgeOf(1, 18, 10))
    expect(screen.getByTestId('progress-detail')).toHaveTextContent('progress.overdue')

    cleanup()
    // Caught up, with cards still to start: no "복습 밀림 0장", which is a sentence about nothing.
    renderToday(knowledgeOf(19, 0, 10))
    const detail = screen.getByTestId('progress-detail')
    expect(detail).toHaveTextContent('progress.unstudied')
    expect(detail).not.toHaveTextContent('progress.overdue')
  })

  it('reports "not started" rather than a confident 0%', () => {
    renderToday(knowledgeOf(0, 0, 29))

    expect(screen.getByText(/progress\.notStarted/)).toBeInTheDocument()
    // Nothing overdue and nothing studied — the detail line has nothing to say but the count of
    // untouched cards, which the headline already gave.
    expect(screen.getByTestId('progress-detail')).toHaveTextContent('progress.unstudied')
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

  it('shows the learner exactly what was stored as their answer', () => {
    // The honesty check on typed answers: a later paid `compare` is grounded in this string, so
    // it has to be on screen before anyone can pay for an answer about it.
    renderToday({
      attempts: [
        { id: 'a1', goal_id: 'goal-1', card_id: 'card-1', activity_id: null, plan_item_id: 'item-1',
          activity_type: 'recall', response_type: 'text', evaluator_type: 'self_rate',
          response: { self_rated: 0, text: 'apfel' }, normalized_score: 0,
          duration_ms: 0, created_at: attemptAt('01') },
      ],
    })

    expect(screen.getByText('history.youWrote')).toBeInTheDocument()
  })

  it('says nothing about an answer on an attempt that has none', () => {
    renderToday({
      attempts: [
        { id: 'a1', goal_id: 'goal-1', card_id: 'card-1', activity_id: null, plan_item_id: 'item-1',
          activity_type: 'recall', response_type: 'self_rate', evaluator_type: 'self_rate',
          response: { self_rated: 0 }, normalized_score: 0,
          duration_ms: 0, created_at: attemptAt('01') },
      ],
    })

    expect(screen.queryByText('history.youWrote')).not.toBeInTheDocument()
  })

  // ── attempt-grounded remediation (paid) ──────────────────────────────────
  //
  // The point of grounding is that the answer is about ONE failure, so these assert the
  // attempt id travels with the request — a card id alone would produce the generic
  // explanation the plan row already offers, at the same price.
  const missed = {
    id: 'a-missed', goal_id: 'goal-1', card_id: 'card-1', activity_id: null,
    plan_item_id: 'item-1', activity_type: 'recall', evaluator_type: 'self_rate',
    normalized_score: 0, duration_ms: 0, created_at: attemptAt('03'),
  }
  const partial = { ...missed, id: 'a-partial', card_id: 'card-2', normalized_score: 0.5 }
  const known = { ...missed, id: 'a-known', card_id: 'card-3', normalized_score: 1 }
  const unscored = { ...missed, id: 'a-unscored', card_id: 'card-4', normalized_score: null }
  const cardless = { ...missed, id: 'a-cardless', card_id: null }

  it('offers remediation only on attempts the learner did not already recall', () => {
    renderToday({ attempts: [missed, partial, known, unscored] })

    // A miss and a partial have a premise; "known" does not, and an unscored attempt is not
    // evidence of a miss — paying to explain either would be selling an answer to a question
    // the learner never asked.
    expect(screen.getAllByRole('button', { name: /^enrichment\.action\.explain/ })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^enrichment\.action\.hint/ })).toHaveLength(2)
  })

  it('does not offer it on an attempt with no card', () => {
    renderToday({ attempts: [cardless] })

    expect(screen.queryByRole('button', { name: /^enrichment\.action\.explain/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^enrichment\.action\.hint/ })).not.toBeInTheDocument()
  })

  it('grounds the request in THAT attempt, not just its card', async () => {
    const state = renderToday({ attempts: [missed] })

    await userEvent.click(screen.getByRole('button', { name: /^enrichment\.action\.explain/ }))

    expect(state.requestEnrichment).toHaveBeenCalledWith({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', attemptId: 'a-missed',
      uiLang: expect.any(String),
    })
  })

  it('sends the hint action from the same row, with the same grounding', async () => {
    const state = renderToday({ attempts: [partial] })

    await userEvent.click(screen.getByRole('button', { name: /^enrichment\.action\.hint/ }))

    expect(state.requestEnrichment).toHaveBeenCalledWith({
      action: 'hint', goalId: 'goal-1', cardId: 'card-2', attemptId: 'a-partial',
      uiLang: expect.any(String),
    })
  })

  it('says the answer is about this attempt, not the card in general', () => {
    renderToday({ attempts: [missed] })

    // VISIBLE text, not a `title` tooltip: a tooltip never appears on keyboard focus or on
    // touch, so the sentence explaining what the charge buys would reach nobody on a phone.
    expect(screen.getByText(/enrichment\.groundedHint/)).toBeInTheDocument()
  })

  it('names the item each paid button belongs to', () => {
    // Every row offers the same two labels. Without the row in the accessible name, a screen
    // reader user hears twenty buttons with two names between them and cannot tell which one
    // spends credits on which item.
    renderToday({ attempts: [missed] })

    expect(screen.getByRole('button', { name: /^enrichment\.action\.explain — / })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^enrichment\.action\.hint — / })).toBeInTheDocument()
  })

  it('shows only THIS goal\'s attempts, because a stale row would spend credits', () => {
    // `fetchAttempts` does not clear `attempts` — it only flips `attemptsLoading` — so after a
    // goal switch the previous goal's rows stay painted until the new read lands. Those rows
    // carry real card and attempt ids, so a click would buy an explanation of a card from the
    // goal the learner just left.
    const otherGoal = { ...missed, id: 'a-other', goal_id: 'goal-2', card_id: 'card-9' }
    renderToday({ attempts: [otherGoal] })

    expect(screen.queryByText('history.title')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^enrichment\.action\.explain/ })).not.toBeInTheDocument()
  })

  it('states the price before the click when the wallet could be read', () => {
    const state = renderToday({
      attempts: [missed],
      enrichmentQuote: { estPriceMicro: 3880, balanceMicro: 1480000 },
    })

    expect(state.loadEnrichmentQuote).toHaveBeenCalledTimes(1)
    // Regex, not an exact string: the price shares its paragraph with the grounding sentence.
    expect(screen.getByText(/enrichment\.quote/)).toBeInTheDocument()
  })

  it('renders NO number at all when the wallet could not be read', () => {
    renderToday({ attempts: [missed], enrichmentQuote: null })

    // Not "$0.00": a free-looking price on something that charges is the one wrong answer.
    expect(screen.queryByText(/enrichment\.quote/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    // …and the feature still works, because a failed quote must not gate a paid action the
    // learner has credits for.
    expect(screen.getByRole('button', { name: /^enrichment\.action\.explain/ })).toBeEnabled()
  })

  it('does not read the wallet for a learner who is never offered remediation', () => {
    const state = renderToday({ attempts: [known, unscored] })

    expect(state.loadEnrichmentQuote).not.toHaveBeenCalled()
  })

  it('disables every row while one request is in flight', () => {
    // The store's guard is global — a second click anywhere is dropped and returns false — so
    // no row may look clickable while a request runs.
    renderToday({ attempts: [missed, partial], enrichmentPendingCardId: 'card-2' })

    for (const button of screen.getAllByRole('button', { name: /^enrichment\.action\./ })) {
      expect(button).toBeDisabled()
    }
  })

  it('marks the row that is waiting, not every row that shares its card', async () => {
    // Two misses on the SAME card — precisely the learner this feature exists for. The store
    // tracks only the pending CARD, so keying the note on it would make both rows claim to be
    // the one request in flight.
    const sameCardAgain = { ...missed, id: 'a-missed-2', created_at: '2026-07-30T03:00:00.000Z' }
    let settle: (ok: boolean) => void = () => {}
    const inFlight = new Promise<boolean>((resolve) => { settle = resolve })

    renderToday({
      attempts: [missed, sameCardAgain],
      requestEnrichment: vi.fn().mockReturnValue(inFlight),
    })

    await userEvent.click(screen.getAllByRole('button', { name: /^enrichment\.action\.explain/ })[0])

    expect(screen.getAllByText('enrichment.requesting')).toHaveLength(1)
    settle(true)
  })
})

// ── enrichment UI (Phase 3, paid) ──────────────────────────────────────────
describe('enrichment', () => {
  const planItem = {
    id: 'item-1', plan_id: 'plan-1', position: 0, activity_id: null, card_id: 'card-1',
    concept_id: null, activity_type: 'recall', stimulus_type: 'text',
    response_type: 'self_rate', evaluator_type: 'self_rate', reason_code: 'due',
    priority: 0.7, estimated_minutes: 0.5, status: 'pending' as const,
  }
  const planRow = {
    id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
    algorithm_version: 'daily-plan-v1', input_fingerprint: 'f', status: 'pending',
    budget_minutes: 20, completed_minutes: 0, completed_items: 0, total_items: 1,
  }
  const withPlan = (over: StoreState = {}) => renderToday({
    plan: planRow, planItems: [planItem],
    planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } },
    ...over,
  })
  /** A miss on card-1 — the premise the paid actions are offered against. */
  const attemptOnCard1 = {
    id: 'a-1', goal_id: 'goal-1', card_id: 'card-1', activity_id: null,
    plan_item_id: 'item-1', activity_type: 'recall', evaluator_type: 'self_rate',
    normalized_score: 0, duration_ms: 0,
    // The section is scoped to the plan's own day now, so a fixture frozen in July renders
    // nothing at all. Built from a LOCAL wall-clock string so it holds in any timezone.
    created_at: new Date(`${todayKey()}T03:00:00`).toISOString(),
  }

  /**
   * The plan list carries NO paid button any more.
   *
   * It used to offer one per row, card-scoped, and design §6 then required it to become
   * attempt-grounded once the item had an attempt — a rule that could be got wrong (and was:
   * a stale row from another goal would ground the request in the wrong attempt, which the
   * server cannot catch, because mig 178's pair check only asks that attempt and enrichment
   * name the same CARD). Offering it only from the attempt list removes the class of bug: an
   * attempt row cannot be grounded in anything but its own attempt.
   */
  it('offers no paid button from the plan list', () => {
    withPlan()

    expect(screen.queryByRole('button', { name: 'enrichment.explainCta' })).not.toBeInTheDocument()
  })

  it('offers one from the attempt it is grounded in, with the price stated first', async () => {
    const state = withPlan({
      attempts: [attemptOnCard1],
      enrichmentQuote: { estPriceMicro: 1200, balanceMicro: 500000 },
    })

    expect(screen.getByText('enrichment.groundedHint', { exact: false })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /enrichment\.action\.explain/ }))

    expect(state.requestEnrichment).toHaveBeenCalledWith({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', attemptId: 'a-1',
      uiLang: expect.any(String),
    })
  })

  it('renders each failure with its own message', () => {
    for (const code of ['INSUFFICIENT_CREDITS', 'RATE_CAP', 'GROUNDING_REQUIRED']) {
      const { unmount } = render(<div />)
      unmount()
      withPlan({ enrichmentError: code })
      expect(screen.getByRole('alert')).toHaveTextContent(`enrichment.error.${code}`)
      cleanup()
    }
  })

  it('shows the result with its citations and says the charge already happened', () => {
    withPlan({
      enrichment: {
        enrichmentId: 'enr-1', action: 'explain', balance: 1000,
        content: { explanation: '연장근로 가산수당', key_points: ['50% 가산'] },
        sources: [{ title: '근로기준법', clause: '제56조' }],
      },
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('연장근로 가산수당')).toBeInTheDocument()
    expect(screen.getByText('50% 가산')).toBeInTheDocument()
    expect(screen.getByText('근로기준법')).toBeInTheDocument()
    // Rejecting is not a refund — the copy has to say so.
    expect(screen.getByText('enrichment.chargedNote')).toBeInTheDocument()
  })

  it('says an answer is not source-based instead of leaving citations blank', () => {
    withPlan({
      enrichment: {
        enrichmentId: 'enr-1', action: 'explain', balance: null,
        content: { explanation: 'x' }, sources: [],
      },
    })

    expect(screen.getByText('enrichment.noSources')).toBeInTheDocument()
  })

  it('keeps or discards through the store, and can defer the decision', async () => {
    const state = withPlan({
      enrichment: {
        enrichmentId: 'enr-1', action: 'explain', balance: null,
        content: { explanation: 'x' }, sources: [],
      },
    })

    await userEvent.click(screen.getByRole('button', { name: 'enrichment.keep' }))
    expect(state.resolveEnrichment).toHaveBeenCalledWith('accepted')

    await userEvent.click(screen.getByRole('button', { name: 'enrichment.discard' }))
    expect(state.resolveEnrichment).toHaveBeenCalledWith('rejected')

    await userEvent.click(screen.getByRole('button', { name: 'enrichment.later' }))
    expect(state.dismissEnrichment).toHaveBeenCalled()
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
