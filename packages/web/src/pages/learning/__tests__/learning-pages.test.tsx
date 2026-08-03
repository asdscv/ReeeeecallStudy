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
  setGoalDecks: vi.fn(),
  fetchPlan: vi.fn(),
  generatePlan: vi.fn(),
  autoGeneratePlan: vi.fn(),
  planAbsentFor: null,
  autoPlanAttempted: {},
  extendPlan: vi.fn(),
  planExtending: false,
  planExtension: null,
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

  it('renders a plan item with its reason and a link into the card\'s deck', () => {
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

    expect(screen.getByText('猫')).toBeInTheDocument()
    expect(screen.getByText('today.reason.recentFailure')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'today.item.study' }))
      .toHaveAttribute('href', '/decks/deck-7/study/setup')
  })

  // ── the memory model, made visible ────────────────────────────────────────
  //
  // Until this shipped, the plan asserted "at risk of forgetting" and showed no number, so the
  // FSRS work behind it was invisible — and an estimate a learner cannot see is one they cannot
  // judge.
  const planWith = (payload: unknown) => ({
    plan: {
      id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
      algorithm_version: 'daily-plan-v2', input_fingerprint: 'fnv1a32:abc', status: 'pending',
      budget_minutes: 20, completed_minutes: 0, completed_items: 0, total_items: 1,
    },
    planItems: [{
      id: 'item-1', plan_id: 'plan-1', position: 0, activity_id: null, card_id: 'card-1',
      concept_id: null, activity_type: 'recall', stimulus_type: 'text',
      response_type: 'self_rate', evaluator_type: 'self_rate', reason_code: 'memory_risk',
      priority: 0.7, estimated_minutes: 0.5, status: 'pending', payload,
    }],
    planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } },
  })

  it('shows the recall probability the planner chose the row on', () => {
    renderToday(planWith({ recall_probability: 0.523 }))

    expect(screen.getByText('today.recallChance')).toBeInTheDocument()
  })

  it('says nothing at all for a card with no forgetting curve', () => {
    // A new card, or a plan saved before the estimate was recorded. "0%" would tell the learner
    // they have certainly forgotten something they may never have studied.
    renderToday(planWith({}))

    expect(screen.queryByText('today.recallChance')).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
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
})

// ── attempt recording (Phase 2) ─────────────────────────────────────────────
describe('recording an attempt', () => {
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

  it('offers three self-ratings on a pending item and records the one clicked', async () => {
    const state = renderToday({ plan: planRow, planItems: [planItem],
      planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } } })

    await userEvent.click(screen.getByRole('button', { name: 'today.rate.partial' }))

    expect(state.recordAttempt).toHaveBeenCalledTimes(1)
    const [input, planDate] = (state.recordAttempt as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(input.score).toBe(0.5)
    expect(input.goalId).toBe('goal-1')
    // The RPC rejects an attempt whose targets do not match the stored plan item (P0007),
    // so the row must hand over the item it rendered — not a re-derived copy.
    expect(input.planItem).toBe(planItem)
    expect(input.clientAttemptId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(planDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('maps the three choices to 0 / 0.5 / 1', async () => {
    const state = renderToday({ plan: planRow, planItems: [planItem] })
    for (const [name, score] of [['today.rate.again', 0], ['today.rate.partial', 0.5], ['today.rate.known', 1]] as const) {
      await userEvent.click(screen.getByRole('button', { name }))
      const calls = (state.recordAttempt as ReturnType<typeof vi.fn>).mock.calls
      expect(calls[calls.length - 1][0].score).toBe(score)
    }
  })

  it('shows a completed item as recorded instead of offering to rate it again', () => {
    renderToday({ plan: planRow, planItems: [{ ...planItem, status: 'completed' as const }] })

    expect(screen.getByText('today.item.recorded')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'today.rate.known' })).not.toBeInTheDocument()
  })

  it('disables the ratings for the row being recorded', () => {
    renderToday({ plan: planRow, planItems: [planItem], recordingItemId: 'item-1' })

    expect(screen.getByRole('button', { name: 'today.rate.known' })).toBeDisabled()
  })

  // ── typed answers (Stage 2) ───────────────────────────────────────────────
  //
  // The input appears only where the plan row says `response_type === 'text'`. That is the same
  // column `record_answer_attempt` compares against, so a box that appeared anywhere else would
  // collect an answer the RPC then refuses to store.
  describe('typed answer', () => {
    const typedItem = { ...planItem, response_type: 'text' }

    it('offers a field to write in when the item asks for one', () => {
      renderToday({ plan: planRow, planItems: [typedItem] })

      const field = screen.getByRole('textbox', { name: 'today.answer.label' })
      expect(field).toBeInTheDocument()
      // The learner has to be told what this text is for. Nothing grades it, and the same three
      // rating buttons are still what records the attempt.
      expect(screen.getByText('today.answer.note')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'today.rate.known' })).toBeInTheDocument()
    })

    it('does not offer one on a self-rating item', () => {
      renderToday({ plan: planRow, planItems: [planItem] })

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('does not offer one on an item already recorded', () => {
      renderToday({ plan: planRow, planItems: [{ ...typedItem, status: 'completed' as const }] })

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('sends what was written together with the rating', async () => {
      const state = renderToday({ plan: planRow, planItems: [typedItem] })

      await userEvent.type(screen.getByRole('textbox', { name: 'today.answer.label' }), '사과')
      await userEvent.click(screen.getByRole('button', { name: 'today.rate.partial' }))

      const [input] = (state.recordAttempt as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(input.text).toBe('사과')
      expect(input.score).toBe(0.5)
    })

    it('keeps each row\'s answer to itself', async () => {
      const second = { ...typedItem, id: 'item-2', position: 1, card_id: 'card-2' }
      const state = renderToday({
        plan: { ...planRow, total_items: 2 }, planItems: [typedItem, second],
      })

      const fields = screen.getAllByRole('textbox', { name: 'today.answer.label' })
      await userEvent.type(fields[0], 'first')
      await userEvent.click(screen.getAllByRole('button', { name: 'today.rate.known' })[1])

      // The second row must not submit the first row's words — that would attribute an answer
      // to a card the learner never wrote it for, and a later paid comparison would be grounded
      // in it.
      const [input] = (state.recordAttempt as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(input.planItem.id).toBe('item-2')
      expect(input.text).toBe('')
    })

    it('stops the input at the cap the server would reject past', async () => {
      renderToday({ plan: planRow, planItems: [typedItem] })

      // maxLength, not a truncation after the fact: the learner sees the field stop rather than
      // discovering later that part of the answer was dropped.
      expect(screen.getByRole('textbox', { name: 'today.answer.label' }))
        .toHaveAttribute('maxLength', '2000')
    })
  })

  it('leaves other rows usable while one is recording', () => {
    const second = { ...planItem, id: 'item-2', position: 1 }
    renderToday({ plan: { ...planRow, total_items: 2 }, planItems: [planItem, second], recordingItemId: 'item-1' })

    const buttons = screen.getAllByRole('button', { name: 'today.rate.known' })
    expect(buttons[0]).toBeDisabled()
    expect(buttons[1]).toBeEnabled()
  })
})

describe('attempt history', () => {
  it('lists recent attempts with a human score label', () => {
    renderToday({
      attempts: [
        { id: 'a1', goal_id: 'goal-1', card_id: 'card-1', activity_id: null, plan_item_id: 'item-1',
          activity_type: 'recall', evaluator_type: 'self_rate', normalized_score: 1,
          duration_ms: 3000, created_at: '2026-07-31T01:00:00.000Z' },
        { id: 'a2', goal_id: 'goal-1', card_id: null, activity_id: null, plan_item_id: null,
          activity_type: 'recall', evaluator_type: 'self_rate', normalized_score: null,
          duration_ms: 0, created_at: '2026-07-31T00:00:00.000Z' },
      ],
      planCards: { 'card-1': { id: 'card-1', deck_id: 'deck-7', field_values: { front: '猫' } } },
    })

    expect(screen.getByText('history.title')).toBeInTheDocument()
    expect(screen.getByText('猫')).toBeInTheDocument()
    expect(screen.getByText('today.rate.known')).toBeInTheDocument()
    // An unscored attempt must say so rather than rendering as "didn't know" (0 vs null).
    expect(screen.getByText('history.score.unknown')).toBeInTheDocument()
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
          duration_ms: 0, created_at: '2026-07-31T01:00:00.000Z' },
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
          duration_ms: 0, created_at: '2026-07-31T01:00:00.000Z' },
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
    normalized_score: 0, duration_ms: 0, created_at: '2026-07-31T03:00:00.000Z',
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

  it('labels the request as costing credits BEFORE it is clicked', () => {
    withPlan()

    // The charge happens server-side before the user sees any result, so the cost cannot
    // be disclosed in an error afterwards.
    const cta = screen.getByRole('button', { name: 'enrichment.explainCta' })
    expect(cta).toBeInTheDocument()
    expect(cta).toHaveAttribute('title', 'enrichment.costHint')
  })

  it('requests an explanation for that card only', async () => {
    const state = withPlan()

    await userEvent.click(screen.getByRole('button', { name: 'enrichment.explainCta' }))

    expect(state.requestEnrichment).toHaveBeenCalledWith({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', uiLang: expect.any(String),
    })
  })

  it('does not offer it on a row with no card', () => {
    renderToday({ plan: planRow, planItems: [{ ...planItem, card_id: null, activity_id: 'act-1' }] })

    expect(screen.queryByRole('button', { name: 'enrichment.explainCta' })).not.toBeInTheDocument()
  })

  // Design §6: the plan-row button stays card-scoped, and becomes attempt-grounded once that
  // item HAS an attempt. Without this the web plan row buys the generic answer at the price
  // the phone charges for a grounded one, and mig 178's `attempt_id` is written NULL.
  const attemptOnCard1 = {
    id: 'a-1', goal_id: 'goal-1', card_id: 'card-1', activity_id: null,
    plan_item_id: 'item-1', activity_type: 'recall', evaluator_type: 'self_rate',
    normalized_score: 0, duration_ms: 0, created_at: '2026-07-31T03:00:00.000Z',
  }

  it('grounds the plan row in this card’s latest attempt once it has one', async () => {
    const state = withPlan({ attempts: [attemptOnCard1] })

    await userEvent.click(screen.getByRole('button', { name: 'enrichment.explainCta' }))

    expect(state.requestEnrichment).toHaveBeenCalledWith({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', attemptId: 'a-1',
      uiLang: expect.any(String),
    })
  })

  it('never grounds it in another goal’s attempt on the same card', async () => {
    // `fetchAttempts` does not clear `attempts` on a goal switch, so the previous goal's rows
    // survive one round trip. A card in both goals' decks would otherwise ground this paid
    // request in the goal the learner just left — and the server cannot catch it, because
    // mig 178's pair check only asks that attempt and enrichment name the same CARD.
    const state = withPlan({ attempts: [{ ...attemptOnCard1, id: 'a-other', goal_id: 'goal-2' }] })

    await userEvent.click(screen.getByRole('button', { name: 'enrichment.explainCta' }))

    // No `attemptId` KEY at all — not `undefined`, which the store would forward as a field.
    expect(state.requestEnrichment).toHaveBeenCalledWith({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', uiLang: expect.any(String),
    })
  })

  it('disables the row being requested', () => {
    withPlan({ enrichmentPendingCardId: 'card-1' })

    expect(screen.getByRole('button', { name: 'enrichment.requesting' })).toBeDisabled()
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
