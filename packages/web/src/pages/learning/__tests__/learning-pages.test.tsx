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
import { MemoryRouter } from 'react-router-dom'

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
vi.mock('../../../stores/deck-store', () => ({
  useDeckStore: () => ({ decks: [{ id: 'deck-1', name: 'Deck one' }], fetchDecks: vi.fn() }),
}))

import { LearningTodayPage } from '../LearningTodayPage'
import { LearningGoalsPage } from '../LearningGoalsPage'

const goal = {
  id: 'goal-1', domain_id: 'language', title: 'JLPT N2', target_date: null,
  daily_minutes: 20, status: 'active', target: {}, settings: {},
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
  decks: [{ deck_id: 'deck-1', importance: 0.5 }],
}

const baseState = (over: StoreState = {}): StoreState => ({
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

const renderToday = (over: StoreState = {}) => {
  storeState.current = baseState(over)
  render(<MemoryRouter><LearningTodayPage /></MemoryRouter>)
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
  it('never writes a plan just because the page opened', () => {
    const state = renderToday()

    // Reading is automatic…
    expect(state.fetchGoals).toHaveBeenCalled()
    expect(state.fetchPlan).toHaveBeenCalledWith('goal-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    // …writing is not. This is the 50-saves-per-day quota guard.
    expect(state.generatePlan).not.toHaveBeenCalled()
  })

  it('offers to build a plan when none exists, and only then writes', async () => {
    const state = renderToday()

    const button = screen.getByRole('button', { name: 'today.generate' })
    await userEvent.click(button)

    expect(state.generatePlan).toHaveBeenCalledTimes(1)
  })

  it('points a user with no goal at goal creation instead of an empty list', () => {
    renderToday({ goals: [] })

    expect(screen.getByText('today.empty.noGoal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'today.empty.createGoal' }))
      .toHaveAttribute('href', '/learning/goals')
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
