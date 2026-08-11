/**
 * learning-store — the first product surface over the learning engine.
 *
 * What these assertions protect, in order of how much damage the bug would do:
 *   1. plan generation is never fired blindly — `save_daily_plan` is capped at 50
 *      calls per user per day, so a regenerate-on-render loop would burn a real
 *      quota and then hard-fail for the rest of the day;
 *   2. a goal with no attached decks is a clear empty state, not a server error;
 *   3. the RPC's distinct P000x failures stay distinguishable in the UI;
 *   4. an edit sends only the fields that changed (every RPC arg is COALESCE'd, so a
 *      stray null silently keeps the old value and looks like a failed save).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCallServerAI, mockGetAiWallet } = vi.hoisted(() => ({
  mockCallServerAI: vi.fn(), mockGetAiWallet: vi.fn(),
}))
vi.mock('@reeeeecall/shared/lib/ai/server-client', () => ({
  callServerAI: mockCallServerAI, getAiWallet: mockGetAiWallet,
}))

const { mockFrom, mockRpc, mockGetUser, mockSupabase } = vi.hoisted(() => {
  const from = vi.fn()
  const rpc = vi.fn()
  const getUser = vi.fn()
  return {
    mockFrom: from,
    mockRpc: rpc,
    mockGetUser: getUser,
    mockSupabase: {
      from: (...args: unknown[]) => from(...args),
      rpc: (...args: unknown[]) => rpc(...args),
      auth: { getUser: () => getUser() },
    },
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))
vi.mock('@reeeeecall/shared/lib/supabase', () => ({ supabase: mockSupabase }))

import { useLearningStore, type LearningGoalWithDecks } from '../learning-store'
import { DEFAULT_NEW_CARDS_PER_DAY } from '@reeeeecall/shared/learning/application/cadence'

/** A thenable PostgREST-builder stub: every filter returns itself, awaiting resolves. */
function q(result: unknown) {
  const settled = Promise.resolve(result)
  const builder: Record<string, unknown> = {}
  for (const method of ['eq', 'neq', 'in', 'or', 'not', 'is', 'gte', 'lte', 'order', 'limit', 'returns']) {
    builder[method] = () => builder
  }
  // Recorded, not just returned: the column list is the contract with PostgREST, and a column
  // left out of it is silently absent from the row rather than a type error. A mock that
  // fabricates the row cannot notice — so the select string itself has to be assertable.
  builder.select = (columns?: unknown) => {
    selectedColumns.push(typeof columns === 'string' ? columns : '')
    return builder
  }
  builder.maybeSingle = () => settled
  builder.then = (onOk: unknown, onErr: unknown) =>
    settled.then(onOk as never, onErr as never)
  return builder
}

/** Every `select(...)` argument this test's supabase stub was handed, in call order. */
let selectedColumns: string[] = []

/** Per-table FIFO queue of results, so one action can read several tables in order. */
let tableResults: Record<string, unknown[]> = {}

function queue(table: string, result: unknown) {
  tableResults[table] = [...(tableResults[table] ?? []), result]
}

const NOW = '2026-07-31T03:00:00.000Z'
const CTX = { timezone: 'Asia/Seoul', planDate: '2026-07-31', now: NOW }

const goalRow = {
  id: 'goal-1', domain_id: 'language', title: 'JLPT N2', target_date: null,
  daily_minutes: 20, status: 'active' as const, target: {}, settings: {},
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
}

const goalWithDecks = (decks: Array<{ deck_id: string; importance: number }>): LearningGoalWithDecks =>
  ({ ...goalRow, decks })

function cardRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, deck_id: 'deck-1', user_id: 'user-1', template_id: 'tpl-1',
    field_values: { front: 'q', back: 'a' }, tags: [], sort_position: 1,
    srs_status: 'review', ease_factor: 2.5, interval_days: 3, repetitions: 2,
    next_review_at: '2026-07-30T00:00:00.000Z', last_reviewed_at: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** A deck row as `generatePlan` reads it, to decide where the SRS state lives. */
const deckRow = (over: Record<string, unknown> = {}) =>
  ({ id: 'deck-1', user_id: 'user-1', share_mode: null, source_owner_id: null, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  tableResults = {}
  selectedColumns = []
  mockFrom.mockImplementation((table: string) => {
    const pending = tableResults[table]
    const next = pending && pending.length > 0 ? pending.shift() : { data: [], error: null }
    return q(next)
  })
  // `generatePlan` reads `decks` to decide whether a card's schedule is embedded or lives in
  // `user_card_progress`. Default to an OWNED deck so the tests below — which are about save
  // limits, conflicts and concurrency, not about SRS sourcing — keep reading as they did.
  // The sourcing behaviour has its own tests, which queue this explicitly.
  queue('decks', { data: [deckRow()], error: null })
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  useLearningStore.getState().reset()
})

// ── fetchGoals ─────────────────────────────────────────────────────────────
describe('fetchGoals', () => {
  it('attaches each goal its deck links', async () => {
    queue('learning_goals', { data: [goalRow], error: null })
    queue('learning_goal_decks', {
      data: [{ goal_id: 'goal-1', deck_id: 'deck-1', importance: '0.9' }], error: null,
    })

    await useLearningStore.getState().fetchGoals()

    const [goal] = useLearningStore.getState().goals
    expect(goal.id).toBe('goal-1')
    // PostgREST returns numeric as a string; the store must not leak that into the
    // planner, where a string importance would poison the score arithmetic.
    expect(goal.decks).toEqual([{ deck_id: 'deck-1', importance: 0.9 }])
    expect(useLearningStore.getState().goalsError).toBeNull()
  })

  it('skips the link query entirely when there are no goals', async () => {
    queue('learning_goals', { data: [], error: null })

    await useLearningStore.getState().fetchGoals()

    expect(mockFrom).toHaveBeenCalledTimes(1)
    expect(useLearningStore.getState().goals).toEqual([])
  })

  it('maps a permission failure to FORBIDDEN', async () => {
    queue('learning_goals', { data: null, error: { code: '42501', message: 'permission denied' } })

    await useLearningStore.getState().fetchGoals()

    expect(useLearningStore.getState().goalsError?.code).toBe('FORBIDDEN')
  })
})

// ── generatePlan ───────────────────────────────────────────────────────────
describe('generatePlan', () => {
  it('refuses without touching the server when the goal has no decks', async () => {
    const ok = await useLearningStore.getState().generatePlan(goalWithDecks([]), CTX)

    expect(ok).toBe(false)
    expect(useLearningStore.getState().planBlockedReason).toBe('no_decks')
    // The quota matters: an empty item list would be rejected server-side AND consume
    // one of the 50 daily saves.
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('reports an empty due set as a blocked reason, not an error', async () => {
    queue('cards', { data: [], error: null })

    const ok = await useLearningStore.getState().generatePlan(
      goalWithDecks([{ deck_id: 'deck-1', importance: 0.5 }]), CTX)

    expect(ok).toBe(false)
    expect(useLearningStore.getState().planBlockedReason).toBe('no_candidates')
    expect(useLearningStore.getState().planError).toBeNull()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('caps new-card intake at the number the form has always shown', async () => {
    // Reported: a 29-card goal whose FIRST plan was all 29 cards, so from day two there were
    // no new cards left and every plan was pure review.
    //
    // The goal's settings were `{}`. `parseNewCardsPerDay({})` returns undefined, and the
    // planner read `undefined ?? Infinity` — uncapped. That was a deliberate compatibility
    // choice ("an existing goal plans exactly as it did"), but the behaviour it preserved is
    // the entire deck on day one, and `GoalFormModal` had always DISPLAYED 20 for exactly
    // these goals. On a 4,000-card deck the same path commits a year of reviews in one sitting.
    const unseen = Array.from({ length: 40 }, (_, i) =>
      cardRow('new-' + i, {
        srs_status: 'new', interval_days: 0, repetitions: 0,
        last_reviewed_at: null, next_review_at: null,
      }))
    queue('cards', { data: unseen, error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    queue('daily_plans', { data: null, error: null })
    queue('daily_plan_items', { data: [], error: null })

    // settings `{}` — the shape every goal saved before the form started persisting them has.
    await useLearningStore.getState().generatePlan(
      { ...goalWithDecks([{ deck_id: 'deck-1', importance: 0.9 }]), settings: {} }, CTX)

    const [, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    const items = args.p_items as unknown[]
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(DEFAULT_NEW_CARDS_PER_DAY)
  })

  it('saves a plan whose items carry the full activity shape, then re-reads it', async () => {
    queue('cards', { data: [cardRow('card-1'), cardRow('card-2')], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    // the re-read after saving
    queue('daily_plans', {
      data: {
        id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
        algorithm_version: 'daily-plan-v1', input_fingerprint: 'fnv1a32:deadbeef',
        status: 'pending', budget_minutes: 20, completed_minutes: 0, completed_items: 0,
        total_items: 2,
      },
      error: null,
    })
    queue('daily_plan_items', { data: [{ id: 'item-1', plan_id: 'plan-1', position: 0 }], error: null })

    const ok = await useLearningStore.getState().generatePlan(
      goalWithDecks([{ deck_id: 'deck-1', importance: 0.9 }]), CTX)

    expect(ok).toBe(true)
    const [name, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('save_daily_plan')
    expect(args.p_goal_id).toBe('goal-1')
    expect(args.p_plan_date).toBe('2026-07-31')
    expect(args.p_timezone).toBe('Asia/Seoul')
    // The literal, not the imported constant: a weight change without a version bump is the
    // defect this pins, and comparing the constant to itself would never catch it.
    expect(args.p_algorithm_version).toBe('daily-plan-v2')
    expect(args.p_budget_minutes).toBe(20)
    expect(String(args.p_input_fingerprint)).toMatch(/^fnv1a32:/)

    const items = args.p_items as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    for (const item of items) {
      // save_daily_plan rejects an item missing any of these (P0002), and a legacy
      // card must plan by card_id with no activity row invented for it.
      expect(item.card_id).toBeTruthy()
      expect(item.activity_id).toBeNull()
      expect(item.activity_type).toBe('recall')
      expect(item.stimulus_type).toBe('text')
      expect(item.response_type).toBe('self_rate')
      expect(item.evaluator_type).toBe('self_rate')
      expect(String(item.reason_code).length).toBeGreaterThan(0)
      expect(item.priority as number).toBeGreaterThanOrEqual(0)
      expect(item.priority as number).toBeLessThanOrEqual(1)
      expect(item.estimated_minutes as number).toBeGreaterThan(0)
    }

    // The UI renders the stored plan, not the in-memory planner output.
    expect(useLearningStore.getState().plan?.id).toBe('plan-1')
    expect(useLearningStore.getState().planItems).toHaveLength(1)
  })

  // ── where a card's schedule is read from ──────────────────────────────────
  //
  // On a subscribed or official deck the `cards` row holds the PUBLISHER's SRS; the learner's
  // own lives in `user_card_progress`. The planner read `cards` for both, so in production —
  // where all 376,095 official cards carry `interval_days = 0` and `last_reviewed_at = NULL` —
  // every memory feature saw the same no-evidence value and every card scored identically.

  it('reads a subscribed deck\'s schedule from user_card_progress, not the publisher\'s row', async () => {
    tableResults = {}   // this test owns the whole read sequence
    queue('decks', { data: [deckRow({ user_id: 'publisher' })], error: null })
    queue('user_card_progress', {
      data: [{
        id: 'p1', user_id: 'user-1', card_id: 'card-1', deck_id: 'deck-1',
        srs_status: 'review', ease_factor: 2.5, interval_days: 12, repetitions: 4,
        next_review_at: '2026-07-30T00:00:00.000Z', last_reviewed_at: '2026-07-18T00:00:00.000Z',
        srs_revision: 3, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-07-18T00:00:00.000Z',
      }],
      error: null,
    })
    // The publisher's row: never studied. This is what the planner used to read.
    queue('cards', {
      data: [{ ...cardRow('card-1'), user_id: 'publisher', interval_days: 0, last_reviewed_at: null, next_review_at: null }],
      error: null,
    })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })

    const ok = await useLearningStore.getState().generatePlan(
      goalWithDecks([{ deck_id: 'deck-1', importance: 0.5 }]), CTX)

    expect(ok).toBe(true)
    // It asked the progress table at all — the read that did not exist before.
    expect(mockFrom.mock.calls.map(([t]) => t)).toContain('user_card_progress')
    // And the plan is built from the LEARNER's schedule: a 12-day interval last reviewed on the
    // 18th yields a real memory estimate, where the publisher's row yields none.
    const [, args] = mockRpc.mock.calls.find(([name]) => name === 'save_daily_plan') ?? []
    expect((args as { p_items: unknown[] }).p_items).toHaveLength(1)
  })

  it('does not ask the progress table for a deck the learner owns', async () => {
    tableResults = {}
    queue('decks', { data: [deckRow({ user_id: 'user-1' })], error: null })
    queue('cards', { data: [cardRow('card-1')], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })

    await useLearningStore.getState().generatePlan(
      goalWithDecks([{ deck_id: 'deck-1', importance: 0.5 }]), CTX)

    expect(mockFrom.mock.calls.map(([t]) => t)).not.toContain('user_card_progress')
  })

  it('maps the save-limit failure to LIMIT_EXCEEDED so the UI can say why', async () => {
    queue('cards', { data: [cardRow('card-1')], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({
      data: null, error: { code: 'P0006', message: 'Daily plan save limit (50) exceeded' },
    })

    const ok = await useLearningStore.getState().generatePlan(
      goalWithDecks([{ deck_id: 'deck-1', importance: 0.5 }]), CTX)

    expect(ok).toBe(false)
    expect(useLearningStore.getState().planError?.code).toBe('LIMIT_EXCEEDED')
  })

  it('maps a completed-plan overwrite to CONFLICT, not a generic failure', async () => {
    queue('cards', { data: [cardRow('card-1')], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({
      data: null, error: { code: 'P0007', message: 'Cannot overwrite a completed plan' },
    })

    await useLearningStore.getState().generatePlan(
      goalWithDecks([{ deck_id: 'deck-1', importance: 0.5 }]), CTX)

    expect(useLearningStore.getState().planError?.code).toBe('CONFLICT')
  })

  it('ignores a second concurrent call instead of double-saving', async () => {
    queue('cards', { data: [cardRow('card-1')], error: null })
    queue('study_logs', { data: [], error: null })
    queue('daily_plans', { data: null, error: null })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })

    const goal = goalWithDecks([{ deck_id: 'deck-1', importance: 0.5 }])
    const first = useLearningStore.getState().generatePlan(goal, CTX)
    const second = await useLearningStore.getState().generatePlan(goal, CTX)
    await first

    expect(second).toBe(false)
    const saves = mockRpc.mock.calls.filter(([name]) => name === 'save_daily_plan')
    expect(saves).toHaveLength(1)
  })

  // ── typed answers (Stage 2) ──────────────────────────────────────────────
  //
  // An item becomes typeable only because its TEMPLATE says which field is the answer. The
  // dangerous direction is permissive: an input box on a card whose answer nobody can name
  // becomes the premise for a later paid comparison against nothing.
  describe('typed-answer items', () => {
    const basicTemplate = {
      id: 'tpl-1',
      fields: [
        { key: 'front', name: 'Front', type: 'text', order: 0 },
        { key: 'back', name: 'Back', type: 'text', order: 1 },
      ],
      front_layout: [{ field_key: 'front', style: 'primary' }],
      back_layout: [{ field_key: 'back', style: 'primary' }],
    }

    async function generateWith(templates: unknown[]) {
      queue('cards', { data: [cardRow('card-1')], error: null })
      queue('card_templates', { data: templates, error: null })
      queue('study_logs', { data: [], error: null })
      mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
      queue('daily_plans', { data: null, error: null })

      await useLearningStore.getState().generatePlan(
        goalWithDecks([{ deck_id: 'deck-1', importance: 0.9 }]), CTX)
      const args = mockRpc.mock.calls[0][1] as Record<string, unknown>
      return (args.p_items as Array<Record<string, unknown>>)[0]
    }

    it('asks for text, and records which fields it decided on', async () => {
      const item = await generateWith([basicTemplate])

      expect(item.response_type).toBe('text')
      // Still self-rated: nothing grades the text, so the learner remains the evaluator.
      expect(item.evaluator_type).toBe('self_rate')
      // `payload` is the audit trail — the plan says which key it called the reference, so a
      // template edited tomorrow cannot rewrite what today's plan meant. Matched loosely: the
      // payload also carries `is_new`, which these cases are not about.
      expect(item.payload).toMatchObject({
        typed_answer: {
          resolver: 'card-answer-v1',
          prompt_keys: ['front'],
          reference_keys: ['back'],
        },
      })
    })

    it('records whether the planner counted the row as intake', async () => {
      // Recorded, not left to be re-derived. Inferring it from a missing recall estimate reads
      // every learning-step card as new — the mistake mig 191 removes from the RPC, and the
      // one `plan-composition` used to make on screen hours after a card had been studied.
      const item = await generateWith([basicTemplate])

      expect(item.payload).toMatchObject({ is_new: true })
    })

    it('reads the layouts, not just the field order, from card_templates', async () => {
      await generateWith([basicTemplate])

      // Without `back_layout` there is no declared answer, and the only remaining way to pick
      // one is jsonb key order — which is inverted for every official word card.
      expect(selectedColumns).toContain('id, fields, front_layout, back_layout')
    })

    it('stays a self-rating when the template cannot be read', async () => {
      // The subscriber case (mig 009 shares a template only as a deck default) and the
      // request-failed case land here together. Fail-closed: no input box, no payload.
      const item = await generateWith([])

      expect(item.response_type).toBe('self_rate')
      // No typed-answer record. `is_new` is still there — it is about the CARD, not the
      // template, and the planner knows it whether or not a template could be read.
      expect(item.payload).toEqual({ is_new: true })
    })

    it('stays a self-rating when the template declares no answer face', async () => {
      // `back_layout` defaults to '[]', so this is the ordinary case for hand-made templates.
      const item = await generateWith([{ ...basicTemplate, back_layout: [] }])

      expect(item.response_type).toBe('self_rate')
      expect(item.payload).toEqual({ is_new: true })
    })
  })
})

// ── recordAttempt / fetchAttempts (Phase 2) ────────────────────────────────
describe('recordAttempt', () => {
  const planItem = {
    id: 'item-1', plan_id: 'plan-1', position: 0, activity_id: null, card_id: 'card-1',
    concept_id: null, activity_type: 'recall', stimulus_type: 'text',
    response_type: 'self_rate', evaluator_type: 'self_rate', reason_code: 'due',
    priority: 0.7, estimated_minutes: 0.5, status: 'pending' as const,
  }

  it('sends the plan item snapshot verbatim, because the RPC compares against it', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    queue('daily_plans', { data: null, error: null })

    const ok = await useLearningStore.getState().recordAttempt({
      planItem, goalId: 'goal-1', score: 1, clientAttemptId: 'att-1', durationMs: 4200,
    }, '2026-07-31')

    expect(ok).toBe(true)
    const [name, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('record_answer_attempt')
    // record_answer_attempt raises P0007 unless goal / activity / card and all three type
    // fields match the stored item, so these must come from the item, not be re-derived.
    expect(args).toMatchObject({
      p_client_attempt_id: 'att-1',
      p_plan_item_id: 'item-1',
      p_goal_id: 'goal-1',
      p_activity_id: null,
      p_card_id: 'card-1',
      p_activity_type: 'recall',
      p_response_type: 'self_rate',
      p_evaluator_type: 'self_rate',
      p_normalized_score: 1,
      p_duration_ms: 4200,
    })
  })

  it('clamps the score into 0..1 rather than letting the RPC reject it', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    queue('daily_plans', { data: null, error: null })

    await useLearningStore.getState().recordAttempt({
      planItem, goalId: 'goal-1', score: 4, clientAttemptId: 'att-2',
    }, '2026-07-31')

    expect((mockRpc.mock.calls[0][1] as Record<string, unknown>).p_normalized_score).toBe(1)
  })

  it('re-reads the plan instead of patching item status locally', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    queue('daily_plans', {
      data: { id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
        algorithm_version: 'daily-plan-v1', input_fingerprint: 'f', status: 'completed',
        budget_minutes: 20, completed_minutes: 1, completed_items: 1, total_items: 1 },
      error: null,
    })
    queue('daily_plan_items', { data: [{ ...planItem, status: 'completed' }], error: null })

    await useLearningStore.getState().recordAttempt({
      planItem, goalId: 'goal-1', score: 1, clientAttemptId: 'att-3',
    }, '2026-07-31')

    // The server owns the item status and the plan aggregates (it updates both atomically).
    expect(useLearningStore.getState().planItems[0].status).toBe('completed')
    expect(useLearningStore.getState().plan?.completed_items).toBe(1)
  })

  it('maps a snapshot mismatch to CONFLICT so the UI can say what happened', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0007', message: 'Attempt targets do not match the plan item snapshot' },
    })

    const ok = await useLearningStore.getState().recordAttempt({
      planItem, goalId: 'goal-1', score: 1, clientAttemptId: 'att-4',
    }, '2026-07-31')

    expect(ok).toBe(false)
    expect(useLearningStore.getState().planError?.code).toBe('CONFLICT')
    expect(useLearningStore.getState().recordingItemId).toBeNull()
  })

  it('ignores a second concurrent record instead of double-writing', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    queue('daily_plans', { data: null, error: null })

    const first = useLearningStore.getState().recordAttempt({
      planItem, goalId: 'goal-1', score: 1, clientAttemptId: 'att-5',
    }, '2026-07-31')
    const second = await useLearningStore.getState().recordAttempt({
      planItem, goalId: 'goal-1', score: 0, clientAttemptId: 'att-6',
    }, '2026-07-31')
    await first

    expect(second).toBe(false)
    expect(mockRpc.mock.calls.filter(([n]) => n === 'record_answer_attempt')).toHaveLength(1)
  })

  // ── the typed answer itself ───────────────────────────────────────────────
  //
  // `p_response` is part of the RPC's idempotency comparison, so its exact shape is a contract,
  // not a detail: the same `client_attempt_id` with a different response raises P0007.
  describe('typed answer', () => {
    const typedItem = { ...planItem, response_type: 'text' }
    const responseOf = (call = 0) =>
      (mockRpc.mock.calls[call][1] as Record<string, unknown>).p_response

    async function record(input: { planItem: typeof planItem; text?: string; score?: number }) {
      mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
      queue('daily_plans', { data: null, error: null })
      await useLearningStore.getState().recordAttempt({
        planItem: input.planItem, goalId: 'goal-1', score: input.score ?? 0,
        text: input.text, clientAttemptId: 'att-typed',
      }, '2026-07-31')
    }

    it('stores what the learner wrote next to the rating', async () => {
      await record({ planItem: typedItem, text: '사과', score: 0.5 })

      expect(responseOf()).toEqual({ self_rated: 0.5, text: '사과' })
    })

    it('trims, and omits the key entirely when nothing was typed', async () => {
      await record({ planItem: typedItem, text: '  \n ' })

      // `{ self_rated }` — the shape every attempt has had since Phase 2 — rather than
      // `text: ''`. "Typed nothing" and "was never asked" must read the same downstream, so no
      // later feature can mistake an empty string for an answer it can compare against.
      expect(responseOf()).toEqual({ self_rated: 0 })
    })

    it('ignores text on an item that only asked for a rating', async () => {
      // The item's snapshot is what the row CLAIMS to hold. Writing prose under a `self_rate`
      // item would make that claim false, and the read-back helper would then have to guess.
      await record({ planItem, text: 'apple' })

      expect(responseOf()).toEqual({ self_rated: 0 })
    })

    it('caps the answer before the server has to reject it', async () => {
      await record({ planItem: typedItem, text: 'a'.repeat(5_000) })

      // mig 167 rejects a response over 64 KiB with P0006 — the same code as the plan-save cap,
      // which the UI renders as a message about rebuilding plans. The cap has to bite here.
      expect((responseOf() as { text: string }).text).toHaveLength(2_000)
    })
  })
})

describe('fetchAttempts', () => {
  it('loads the goal\'s attempts', async () => {
    queue('answer_attempts', {
      data: [{ id: 'a1', goal_id: 'goal-1', card_id: 'card-1', activity_id: null,
        plan_item_id: 'item-1', activity_type: 'recall', response_type: 'self_rate',
        evaluator_type: 'self_rate', response: { self_rated: 0.5 },
        normalized_score: 0.5, duration_ms: 1000, created_at: '2026-07-31T00:00:00.000Z' }],
      error: null,
    })

    await useLearningStore.getState().fetchAttempts('goal-1')

    expect(useLearningStore.getState().attempts).toHaveLength(1)
    expect(useLearningStore.getState().attemptsLoading).toBe(false)
  })

  it('reads back the response and its type, or the history row cannot show it', async () => {
    // Asserted on the SELECT string because that is where the mistake would live: a column left
    // out is simply absent from the row, with no type error and no failing render — the answer
    // would just never appear, and a later paid `compare` would have no way to tell an attempt
    // with text from one without.
    queue('answer_attempts', { data: [], error: null })

    await useLearningStore.getState().fetchAttempts('goal-1')

    const [columns] = selectedColumns
    expect(columns).toContain('response_type')
    expect(columns).toContain('response,')
  })
})
describe('recommendations', () => {
  const insights = {
    attemptCount: 6, scoredCount: 6, accuracy: 0.5, medianDurationMs: 5000,
    weakCards: [
      { cardId: 'card-1', attempts: 3, meanScore: 0.2 },
      { cardId: 'card-2', attempts: 2, meanScore: 0.5 },
    ],
    adherence: [], overallAdherence: null,
  }

  it('produces a versioned, deterministic set from the diagnostics', async () => {
    useLearningStore.setState({ insights })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    queue('study_recommendations', { data: [], error: null })

    const ok = await useLearningStore.getState().regenerateRecommendations('goal-1')

    expect(ok).toBe(true)
    const [name, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('set_study_recommendations')
    expect(args.p_goal_id).toBe('goal-1')
    // The producer is recorded so one source's quality can later be compared with another's.
    expect(args.p_provider).toBe('algorithm')
    expect(args.p_algorithm_version).toBe('weak-card-v1')

    const items = args.p_items as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ card_id: 'card-1', action_type: 'review_card' })
    // The evidence travels with the row, so a stored suggestion stays explainable later.
    expect(items[0].reason).toBe('mean 20% over 3 attempts')
    expect(items[0].payload).toEqual({ mean_score: 0.2, attempts: 3 })
  })

  it('refuses to produce with no diagnostics loaded', async () => {
    useLearningStore.setState({ insights: null })

    const ok = await useLearningStore.getState().regenerateRecommendations('goal-1')

    // An empty set would REPLACE the pending suggestions server-side, so producing from
    // nothing would silently wipe the feed.
    expect(ok).toBe(false)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('accepts a suggestion and reflects it locally', async () => {
    useLearningStore.setState({
      recommendations: [{
        id: 'rec-1', goal_id: 'goal-1', card_id: 'card-1', concept_id: null, activity_id: null,
        action_type: 'review_card', provider: 'algorithm', reason: null,
        algorithm_version: 'weak-card-v1', payload: null, status: 'pending', created_at: '2026-07-31T00:00:00Z',
      }],
    })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })

    const ok = await useLearningStore.getState().resolveRecommendation('rec-1', 'accepted')

    expect(ok).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('set_study_recommendation_status', {
      p_recommendation_id: 'rec-1', p_status: 'accepted',
    })
    expect(useLearningStore.getState().recommendations[0].status).toBe('accepted')
    expect(useLearningStore.getState().recommendationBusyId).toBeNull()
  })

  it('treats an already-decided suggestion as done rather than an error', async () => {
    useLearningStore.setState({
      recommendations: [{
        id: 'rec-1', goal_id: 'goal-1', card_id: 'card-1', concept_id: null, activity_id: null,
        action_type: 'review_card', provider: 'algorithm', reason: null,
        algorithm_version: 'weak-card-v1', payload: null, status: 'pending', created_at: '2026-07-31T00:00:00Z',
      }],
    })
    // Both closed states are terminal server-side; a stale tab must not trap the user.
    mockRpc.mockResolvedValue({
      data: null, error: { code: 'P0007', message: 'Recommendation is already accepted' },
    })

    const ok = await useLearningStore.getState().resolveRecommendation('rec-1', 'dismissed')

    expect(ok).toBe(true)
    expect(useLearningStore.getState().planError).toBeNull()
  })

  it('adopts the server state when the suggestion was already decided elsewhere', async () => {
    useLearningStore.setState({
      recommendations: [{
        id: 'rec-1', goal_id: 'goal-1', card_id: 'card-1', concept_id: null, activity_id: null,
        action_type: 'review_card', provider: 'algorithm', reason: null,
        algorithm_version: 'weak-card-v1', payload: null, status: 'pending', created_at: '2026-07-31T00:00:00Z',
      }],
    })
    // The row was ACCEPTED elsewhere; this tab asks to dismiss it and gets P0007.
    mockRpc.mockResolvedValue({
      data: null, error: { code: 'P0007', message: 'Recommendation is already accepted' },
    })
    queue('study_recommendations', {
      data: [{
        id: 'rec-1', goal_id: 'goal-1', card_id: 'card-1', concept_id: null, activity_id: null,
        action_type: 'review_card', provider: 'algorithm', reason: null,
        algorithm_version: 'weak-card-v1', payload: null, status: 'accepted', created_at: '2026-07-31T00:00:00Z',
      }],
      error: null,
    })

    const ok = await useLearningStore.getState().resolveRecommendation('rec-1', 'dismissed')

    // Not an error — the decision is already recorded, so the user is not trapped.
    expect(ok).toBe(true)
    // But the store must NOT claim the status this tab asked for. Writing 'dismissed' here
    // would render a state the server does not hold, and the row would flip on next load.
    expect(useLearningStore.getState().recommendations[0].status).toBe('accepted')
  })

  it('feeds accepted cards into the next plan, which is what makes accepting matter', async () => {
    queue('cards', { data: [cardRow('card-1'), cardRow('card-2')], error: null })
    queue('study_logs', { data: [], error: null })
    queue('study_recommendations', { data: [{ card_id: 'card-2' }], error: null })
    queue('daily_plans', { data: null, error: null })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })

    await useLearningStore.getState().generatePlan(
      goalWithDecks([{ deck_id: 'deck-1', importance: 0.5 }]), CTX)

    const save = mockRpc.mock.calls.find(([n]) => n === 'save_daily_plan')
    expect(save).toBeTruthy()
    const items = (save![1] as Record<string, unknown>).p_items as Array<Record<string, unknown>>
    // card-2 was accepted, so its priority must exceed the otherwise-identical card-1.
    const byCard = new Map(items.map((i) => [i.card_id, i.priority as number]))
    expect(byCard.get('card-2')).toBeGreaterThan(byCard.get('card-1') as number)
  })
})

// ── fetchInsights: switching goals ─────────────────────────────────────────
//
// The screen lets a learner switch between active goals, and the numbers it shows are the
// harshest thing this product says to anyone. Attributing one goal's accuracy to another is
// a worse lie than showing nothing, so the loader has to be correct under overlap — not
// merely "not crash".
describe('fetchInsights — switching goals while a load is in flight', () => {
  /**
   * A `from()` implementation that records which goal each query filtered on, and holds the
   * first N invocations open until released. Two invocations make up ONE fetchInsights call
   * (answer_attempts + daily_plans).
   */
  function gatedFrom(heldInvocations: number, firstResult: unknown = { data: [], error: null }) {
    const filteredGoalIds: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let invocation = 0

    mockFrom.mockImplementation(() => {
      const held = invocation++ < heldInvocations
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'gte', 'order', 'limit', 'returns']) {
        builder[method] = (...args: unknown[]) => {
          if (method === 'eq' && args[0] === 'goal_id') filteredGoalIds.push(String(args[1]))
          return builder
        }
      }
      builder.then = (onOk: unknown, onErr: unknown) => {
        const settled = held
          ? gate.then(() => firstResult)
          : Promise.resolve({ data: [], error: null })
        return settled.then(onOk as never, onErr as never)
      }
      return builder
    })

    return { filteredGoalIds, release }
  }

  it('does not drop the second goal, which would leave the first goal\'s numbers on screen', async () => {
    const { filteredGoalIds, release } = gatedFrom(2)

    const first = useLearningStore.getState().fetchInsights('goal-1')
    // The learner taps the other goal chip before the first load lands.
    const second = useLearningStore.getState().fetchInsights('goal-2')
    release()
    await Promise.all([first, second])

    // A busy-flag early return here is not a harmless optimisation: the chip would show
    // goal-2 selected while the stats below still belong to goal-1.
    expect(filteredGoalIds).toContain('goal-2')
    expect(useLearningStore.getState().insightsGoalId).toBe('goal-2')
  })

  it('discards a superseded response instead of letting it overwrite the current goal', async () => {
    // goal-1 resolves LAST and carries data that would read as 100% accuracy.
    const { release } = gatedFrom(2, {
      data: [{
        card_id: 'card-1', normalized_score: 1, duration_ms: 1000,
        created_at: '2026-07-30T00:00:00.000Z',
      }],
      error: null,
    })

    const first = useLearningStore.getState().fetchInsights('goal-1')
    const second = useLearningStore.getState().fetchInsights('goal-2')
    await second          // goal-2 (no attempts) lands first
    release()
    await first           // the stale goal-1 response arrives afterwards

    const state = useLearningStore.getState()
    expect(state.insightsGoalId).toBe('goal-2')
    // goal-2 has no scored attempts, so accuracy must stay "no data" — not goal-1's 100%.
    expect(state.insights?.accuracy).toBeNull()
  })

  it('reports a diagnostics failure on its own channel, not the plan\'s', async () => {
    queue('answer_attempts', { data: null, error: { code: '42501', message: 'denied' } })

    await useLearningStore.getState().fetchInsights('goal-1')

    const state = useLearningStore.getState()
    expect(state.insightsError?.code).toBe('FORBIDDEN')
    expect(state.insights).toBeNull()
    // planError drives the today screen's banner; a diagnostics failure must not appear there.
    expect(state.planError).toBeNull()
  })
})

describe('goal writes', () => {
  it('creates a goal and then attaches its decks', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, goal_id: 'goal-9' }, error: null })
    queue('learning_goals', { data: [], error: null })

    const id = await useLearningStore.getState().createGoal({
      domainId: 'language', title: 'New goal', dailyMinutes: 15,
      decks: [{ deck_id: 'deck-1', importance: 0.5 }],
    })

    expect(id).toBe('goal-9')
    expect(mockRpc.mock.calls.map(([name]) => name))
      .toEqual(['create_learning_goal', 'set_learning_goal_decks'])
    expect(mockRpc.mock.calls[1][1]).toEqual({
      p_goal_id: 'goal-9', p_decks: [{ deck_id: 'deck-1', importance: 0.5 }],
    })
  })

  it('does not call the link RPC when no decks were chosen', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, goal_id: 'goal-9' }, error: null })
    queue('learning_goals', { data: [], error: null })

    await useLearningStore.getState().createGoal({
      domainId: 'language', title: 'New goal', dailyMinutes: 15,
    })

    expect(mockRpc.mock.calls.map(([name]) => name)).toEqual(['create_learning_goal'])
  })

  it('sends only the fields an edit actually changed', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    queue('learning_goals', { data: [], error: null })

    await useLearningStore.getState().updateGoal({ goalId: 'goal-1', dailyMinutes: 30 })

    // Every RPC parameter is COALESCE'd server-side: an unchanged field sent as null
    // keeps its old value, which would look like a save that silently did nothing.
    expect(mockRpc.mock.calls[0][1]).toEqual({ p_goal_id: 'goal-1', p_daily_minutes: 30 })
  })

  it('surfaces an archived-goal edit as NOT_FOUND', async () => {
    mockRpc.mockResolvedValue({
      data: null, error: { code: 'P0003', message: 'Goal not found, not owned, or archived' },
    })

    const ok = await useLearningStore.getState().updateGoal({ goalId: 'goal-1', title: 'x' })

    expect(ok).toBe(false)
    expect(useLearningStore.getState().goalsError?.code).toBe('NOT_FOUND')
  })

  it('clears everything that described the goal it just deleted', async () => {
    // Server-side the plan cascades. Locally it does not: `fetchGoals` alone would leave the
    // plan, its items and its forecast painted on screen, and the day's list would keep
    // offering to study a plan whose rows no longer exist.
    useLearningStore.setState({
      plan: { id: 'plan-1', goal_id: 'goal-1' } as never,
      planItems: [{ id: 'item-1' }] as never,
      planCards: { 'card-1': { id: 'card-1' } } as never,
      planAbsentFor: 'goal-1|2026-08-06',
      attempts: [
        { id: 'a-1', goal_id: 'goal-1' },
        { id: 'a-2', goal_id: 'goal-2' },
      ] as never,
    })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    queue('learning_goals', { data: [], error: null })

    const ok = await useLearningStore.getState().deleteGoal('goal-1')

    expect(ok).toBe(true)
    expect(mockRpc.mock.calls[0]).toEqual(['delete_learning_goal', { p_goal_id: 'goal-1' }])
    const state = useLearningStore.getState()
    expect(state.plan).toBeNull()
    expect(state.planItems).toEqual([])
    expect(state.planAbsentFor).toBeNull()
    // Another goal's attempts are untouched — they describe study that still exists.
    expect(state.attempts.map((a) => a.id)).toEqual(['a-2'])
  })

  it('reports a delete the server refused, and changes nothing', async () => {
    useLearningStore.setState({ plan: { id: 'plan-1' } as never })
    mockRpc.mockResolvedValue({
      data: null, error: { code: 'P0003', message: 'Goal not found or not owned' },
    })

    const ok = await useLearningStore.getState().deleteGoal('goal-1')

    expect(ok).toBe(false)
    expect(useLearningStore.getState().goalsError?.code).toBe('NOT_FOUND')
    expect(useLearningStore.getState().plan).not.toBeNull()
  })
})

// ── the archive ────────────────────────────────────────────────────────────
//
// `archive_learning_goal` shipped without the half that reads the result back. The status flip
// was real, but `fetchGoals` filtered the row out with `.neq('status','archived')` and no screen
// anywhere listed one — so 보관 meant "hide forever" while the goal, its deck links and every
// daily plan it produced stayed in the database, unreachable. `update_learning_goal` had allowed
// `archived → active` since mig 167 and nothing had ever called it.
describe('the archive', () => {
  const archivedRow = { ...goalRow, id: 'goal-9', title: 'JLPT N3', status: 'archived' as const }

  it('starts at null, which is not the same answer as an empty archive', () => {
    // The drawer reads this to tell "not asked yet" from "asked, and there is nothing" — with
    // `[]` it would claim the archive is empty before anything had looked.
    expect(useLearningStore.getState().archivedGoals).toBeNull()
  })

  it('reads only archived goals, newest put-away first', async () => {
    queue('learning_goals', { data: [archivedRow], error: null })
    queue('learning_goal_decks', { data: [{ goal_id: 'goal-9', deck_id: 'deck-3', importance: 0.5 }], error: null })

    await useLearningStore.getState().fetchArchivedGoals()

    const archived = useLearningStore.getState().archivedGoals
    expect(archived).toHaveLength(1)
    // Hydrated with deck links like the working list, so a restored goal arrives with exactly
    // the decks the archive showed.
    expect(archived?.[0].decks).toEqual([{ deck_id: 'deck-3', importance: 0.5 }])
  })

  it('answers [] rather than null once it has looked and found nothing', async () => {
    queue('learning_goals', { data: [], error: null })

    await useLearningStore.getState().fetchArchivedGoals()

    expect(useLearningStore.getState().archivedGoals).toEqual([])
  })

  it('restores through the transition the server already allowed', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    queue('learning_goals', { data: [goalRow], error: null })     // fetchGoals
    queue('learning_goal_decks', { data: [], error: null })
    queue('learning_goals', { data: [], error: null })            // fetchArchivedGoals

    const ok = await useLearningStore.getState().restoreGoal('goal-9')

    expect(ok).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('update_learning_goal', {
      p_goal_id: 'goal-9', p_status: 'active',
    })
  })

  it('reports a refused restore instead of moving the row locally', async () => {
    useLearningStore.setState({ archivedGoals: [{ ...archivedRow, decks: [] }] })
    mockRpc.mockResolvedValue({
      data: null, error: { code: 'P0007', message: 'Archived goals can only transition to active' },
    })

    const ok = await useLearningStore.getState().restoreGoal('goal-9')

    expect(ok).toBe(false)
    expect(useLearningStore.getState().archivedGoals).toHaveLength(1)
  })

  it('does not read the archive for someone who never opened it', async () => {
    // `archivedGoals === null` means the drawer was never pulled. Refreshing it on every archive
    // would spend a round trip filling a list nobody is looking at.
    useLearningStore.setState({ archivedGoals: null })
    mockRpc.mockResolvedValue({ data: null, error: null })
    queue('learning_goals', { data: [], error: null })   // fetchGoals only

    await useLearningStore.getState().archiveGoal('goal-1')

    expect(useLearningStore.getState().archivedGoals).toBeNull()
  })
})

// ── extendPlan ─────────────────────────────────────────────────────────────
//
// "더 하기". The operation that could not exist before mig 185: the only way to add work to a
// day was `save_daily_plan`, which deletes every item and zeroes the day's progress — so a
// learner who had done half the plan and wanted more would have lost the half they did.
describe('extendPlan', () => {
  const DECKS = [{ deck_id: 'deck-1', importance: 0.5 }]

  const planRow = (over: Record<string, unknown> = {}) => ({
    id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
    algorithm_version: 'daily-plan-v1', input_fingerprint: 'fnv1a32:deadbeef',
    status: 'completed', budget_minutes: 20, completed_minutes: 12, completed_items: 1,
    total_items: 1, ...over,
  })

  const itemRow = (id: string, cardId: string, position: number) => ({
    id, plan_id: 'plan-1', position, activity_id: null, card_id: cardId, concept_id: null,
    activity_type: 'flashcard_recall', stimulus_type: 'text', response_type: 'self_rate',
    evaluator_type: 'self_rate', reason_code: 'due', priority: 0.5, estimated_minutes: 0.5,
    status: 'completed', payload: {},
  })

  /** A plan already on screen with `card-1` done. */
  const withPlan = () => {
    useLearningStore.setState({
      plan: planRow() as never,
      planItems: [itemRow('item-1', 'card-1', 0)] as never,
    })
  }

  /** The re-read `fetchPlan` performs after a successful append. */
  const queueReread = (items: unknown[]) => {
    queue('daily_plans', { data: planRow({ status: 'active', total_items: items.length }), error: null })
    queue('daily_plan_items', { data: items, error: null })
    queue('cards', { data: [], error: null })
  }

  it('refuses when there is no plan to add to', async () => {
    // Not a user error — the caller asked to extend something that is not there. The RPC
    // would raise P0003, which would surface as a failure the learner cannot act on.
    const ok = await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    expect(ok).toBe(false)
    // Not a single query either. Without the guard this falls through to candidate
    // collection, finds nothing, and reports `no_candidates` — the same outward result for
    // a completely different reason, which is how "extend" would come to mean "generate".
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('appends rather than saving — the destructive RPC is never called', async () => {
    // The whole point. `save_daily_plan` would DELETE every item and reset completed_items.
    withPlan()
    queue('cards', { data: [cardRow('card-2')], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true, appended: 1, skipped: 0 }, error: null })
    queueReread([itemRow('item-1', 'card-1', 0), itemRow('item-2', 'card-2', 1)])

    const ok = await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    expect(ok).toBe(true)
    const names = mockRpc.mock.calls.map(([name]) => name)
    expect(names).toContain('append_daily_plan_items')
    expect(names).not.toContain('save_daily_plan')
  })

  it('does not re-offer a card that is already on today\'s list', async () => {
    // The server skips duplicates, but a payload made only of them returns "0 appended",
    // which the learner reads as "there is nothing left to study" when there is.
    withPlan()
    queue('cards', { data: [cardRow('card-1')], error: null })
    queue('study_logs', { data: [], error: null })

    const ok = await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    expect(ok).toBe(false)
    expect(mockRpc).not.toHaveBeenCalled()

    // Reported as an EXTENSION RESULT, never as a blocked plan.
    //
    // This assertion is the reverse of what it used to be, and the reversal is the fix. A
    // learner finished today's twelve items, pressed 더 하기, and `planBlockedReason` —
    // which the screen renders INSTEAD of the plan — replaced their completed day with
    // "오늘 이 덱들에서 복습할 카드가 없습니다". The day's work vanished, and the sentence
    // was false besides: six cards had been due and they had done all six. Nothing was
    // blocked; there was simply nothing left to add.
    expect(useLearningStore.getState().planBlockedReason).toBeNull()
    expect(useLearningStore.getState().planExtension)
      .toEqual({ appended: 0, newCards: 0, reviewsTomorrow: 0, aheadOfSchedule: false })
  })

  it('states how much tomorrow grows, counted from the plan the server returned', async () => {
    // The one cost a learner cannot see today: every new card started now comes back
    // tomorrow. `card-2` has never been reviewed, so it is intake.
    withPlan()
    queue('cards', { data: [cardRow('card-2', { last_reviewed_at: null })], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true, appended: 1, skipped: 0 }, error: null })
    queueReread([itemRow('item-1', 'card-1', 0), itemRow('item-2', 'card-2', 1)])

    await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    expect(useLearningStore.getState().planExtension)
      .toEqual({ appended: 1, newCards: 1, reviewsTomorrow: 1, aheadOfSchedule: false })
  })

  it('counts no new intake when the extra work is all review', async () => {
    // A card WITH a review history is not intake, so tomorrow does not grow by it.
    withPlan()
    queue('cards', { data: [cardRow('card-2', { last_reviewed_at: '2026-07-20T00:00:00.000Z' })], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true, appended: 1, skipped: 0 }, error: null })
    queueReread([itemRow('item-1', 'card-1', 0), itemRow('item-2', 'card-2', 1)])

    await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    expect(useLearningStore.getState().planExtension)
      .toEqual({ appended: 1, newCards: 0, reviewsTomorrow: 0, aheadOfSchedule: false })
  })

  it('reports what the server accepted, not what was sent', async () => {
    // A stale `planItems` — another device, another tab — means some of the payload is
    // already there. The server skips those and says so; claiming otherwise would tell the
    // learner they have work that does not exist.
    withPlan()
    queue('cards', { data: [cardRow('card-2'), cardRow('card-3')], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true, appended: 1, skipped: 1 }, error: null })
    queueReread([itemRow('item-1', 'card-1', 0), itemRow('item-2', 'card-2', 1)])

    await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    expect(useLearningStore.getState().planExtension?.appended).toBe(1)
  })

  it('does not run twice at once', async () => {
    withPlan()
    useLearningStore.setState({ planExtending: true })

    const ok = await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    expect(ok).toBe(false)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('clears the last result before starting, so a failure cannot show a stale success', async () => {
    withPlan()
    useLearningStore.setState({ planExtension: { appended: 9, newCards: 9, reviewsTomorrow: 9, aheadOfSchedule: false } })
    queue('cards', { data: [], error: null })

    await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    // `9 added` must not survive a press that added nothing. It is now overwritten with an
    // explicit zero rather than left null: the screen has a line for "nothing to add", and a
    // null would render no answer at all to a button the learner just pressed.
    expect(useLearningStore.getState().planExtension)
      .toEqual({ appended: 0, newCards: 0, reviewsTomorrow: 0, aheadOfSchedule: false })
  })

  it('pulls upcoming cards forward when nothing is owed', async () => {
    // THE point of the button, reported directly: "더할 것이 없는게 뭔데 … 이거는 하루치
    // 이상을 하겠다고 하는건데".
    //
    // 더 하기 means "I want to do more than today's share". The fetch answered "nothing is
    // due" — which on a finished day is always true, because the day was built from exactly
    // the cards that were due — and the screen reported it as "더 넣을 것이 없습니다" while
    // twenty-three cards sat in the deck waiting for their turn.
    //
    // First pass: nothing owed. Second pass: the due CUTOFF is dropped, and a card scheduled
    // for next week is offered.
    withPlan()
    // Pass 1 bails before it reads templates or logs — an empty candidate set is decided as
    // soon as the two card queries come back, so only those two are consumed here. The second
    // pass re-reads `decks`, and `beforeEach` queues exactly one row.
    queue('decks', { data: [deckRow()], error: null })
    queue('cards', { data: [], error: null })                       // pass 1 — due
    queue('cards', { data: [], error: null })                       // pass 1 — intake
    queue('cards', { data: [cardRow('card-2', {                     // pass 2 — looks ahead
      next_review_at: '2026-08-07T00:00:00.000Z',                   // a week out
      last_reviewed_at: '2026-07-30T00:00:00.000Z',
    })], error: null })
    queue('cards', { data: [], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true, appended: 1, skipped: 0 }, error: null })
    queueReread([itemRow('item-1', 'card-1', 0), itemRow('item-2', 'card-2', 1)])

    const ok = await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)
    expect(ok).toBe(true)
    expect(mockRpc.mock.calls.map(([name]) => name)).toContain('append_daily_plan_items')
    // And it says the block was pulled forward, so the screen can too. Studying early has a
    // real cost and is not something to do to someone silently.
    expect(useLearningStore.getState().planExtension?.aheadOfSchedule).toBe(true)
  })

  it('only says there is nothing left when even looking ahead finds nothing', async () => {
    // The sentence is now true exactly when the goal is out of cards — which is what the
    // learner expected it to mean all along.
    withPlan()
    queue('decks', { data: [deckRow()], error: null })   // the second pass re-reads it
    for (let pass = 0; pass < 2; pass += 1) {
      queue('cards', { data: [], error: null })
      queue('cards', { data: [], error: null })
    }

    const ok = await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    expect(ok).toBe(false)
    expect(useLearningStore.getState().planExtension)
      .toEqual({ appended: 0, newCards: 0, reviewsTomorrow: 0, aheadOfSchedule: false })
    expect(useLearningStore.getState().planBlockedReason).toBeNull()
  })

  it('does NOT look ahead when something is owed', async () => {
    // Study-ahead is the fallback, never the default. A card due today must be preferred over
    // one due next week, and the second pass must not run at all when the first succeeds.
    withPlan()
    queue('cards', { data: [cardRow('card-2', { next_review_at: '2026-07-30T00:00:00.000Z' })], error: null })
    queue('cards', { data: [], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true, appended: 1, skipped: 0 }, error: null })
    queueReread([itemRow('item-1', 'card-1', 0), itemRow('item-2', 'card-2', 1)])

    await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    expect(useLearningStore.getState().planExtension?.aheadOfSchedule).toBe(false)
  })

  it('adds a SMALLER block when it has to pull cards forward', async () => {
    // Reported by pressing it: seventeen cards came forward in one tap — most of a 29-card
    // deck, its whole schedule compressed by a press the learner could not have predicted.
    //
    // Catching up on owed reviews is work the schedule already asked for; pulling cards
    // forward is a change TO the schedule, because each card's next interval is then set from
    // an answer given days early. The two get different budgets.
    withPlan()
    queue('decks', { data: [deckRow()], error: null })
    queue('cards', { data: [], error: null })                       // pass 1 — nothing owed
    queue('cards', { data: [], error: null })
    queue('cards', {                                                // pass 2 — twenty upcoming
      data: Array.from({ length: 20 }, (_, i) => cardRow(`ahead-${i}`, {
        next_review_at: '2026-08-07T00:00:00.000Z',
        last_reviewed_at: '2026-07-30T00:00:00.000Z',
      })),
      error: null,
    })
    queue('cards', { data: [], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true, appended: 6, skipped: 0 }, error: null })
    queueReread([itemRow('item-1', 'card-1', 0)])

    await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

    const [, args] = mockRpc.mock.calls.find(([name]) => name === 'append_daily_plan_items')!
    const sent = (args as { p_items: unknown[] }).p_items
    // Three minutes at RECALL_MINUTES, not ten. The exact count is the planner's business;
    // what must hold is that a forward pull is a fraction of a catch-up block.
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.length, 'a forward pull took a full catch-up block').toBeLessThanOrEqual(8)
  })

  it('never reports an extension as a blocked plan, whatever went missing', async () => {
    // Both refusal paths at once. `collectPlanInputs` can bail before the builder runs (no
    // decks, no candidates) and the builder can return nothing after it — and BOTH used to
    // set `planBlockedReason`, so either one erased the finished day.
    for (const cards of [[], [cardRow('card-1')]]) {
      useLearningStore.setState({ planBlockedReason: null, planExtension: null })
      withPlan()
      queue('cards', { data: cards, error: null })
      queue('study_logs', { data: [], error: null })

      await useLearningStore.getState().extendPlan(goalWithDecks(DECKS), CTX)

      expect(useLearningStore.getState().planBlockedReason).toBeNull()
      expect(useLearningStore.getState().planExtension?.appended).toBe(0)
    }
  })
})

// ── fetchPlan → planAbsentFor ──────────────────────────────────────────────
//
// `plan === null` is three different situations wearing one face: not read yet, read and
// genuinely empty, read and FAILED. Auto-generation may act on exactly one of them, and
// `save_daily_plan` is destructive, so the difference has to survive as its own state.
describe('fetchPlan records WHY there is no plan', () => {
  const emptyPlanRead = () => {
    queue('daily_plans', { data: null, error: null })
  }

  it('records the absence when the server says there is no plan', async () => {
    emptyPlanRead()

    await useLearningStore.getState().fetchPlan('goal-1', '2026-07-31')

    expect(useLearningStore.getState().plan).toBeNull()
    expect(useLearningStore.getState().planAbsentFor).toBe('goal-1|2026-07-31')
  })

  it('records nothing when the read fails', async () => {
    // The dangerous case. A network blip leaves `plan === null` exactly as a real absence does;
    // treating it as absence would rebuild a plan the learner is half-way through.
    queue('daily_plans', { data: null, error: { code: '08006', message: 'connection failure' } })

    await useLearningStore.getState().fetchPlan('goal-1', '2026-07-31')

    expect(useLearningStore.getState().plan).toBeNull()
    expect(useLearningStore.getState().planError).not.toBeNull()
    expect(useLearningStore.getState().planAbsentFor).toBeNull()
  })

  it('clears a previous absence when a plan is found', async () => {
    // Generating right after a plan appears — a save, a switch back to a goal planned on
    // another device — would delete the plan that was just read.
    useLearningStore.setState({ planAbsentFor: 'goal-1|2026-07-31' })
    queue('daily_plans', {
      data: {
        id: 'plan-1', goal_id: 'goal-1', plan_date: '2026-07-31', timezone: 'Asia/Seoul',
        algorithm_version: 'daily-plan-v1', input_fingerprint: 'fnv1a32:deadbeef',
        status: 'pending', budget_minutes: 20, completed_minutes: 0, completed_items: 0,
        total_items: 0,
      },
      error: null,
    })
    queue('daily_plan_items', { data: [], error: null })

    await useLearningStore.getState().fetchPlan('goal-1', '2026-07-31')

    expect(useLearningStore.getState().plan?.id).toBe('plan-1')
    expect(useLearningStore.getState().planAbsentFor).toBeNull()
  })

  it('clears a stale absence for the duration of the next read', async () => {
    // Between "yesterday had no plan" and today's answer, the state must not still claim an
    // absence — the screen can mount and ask mid-read.
    useLearningStore.setState({ planAbsentFor: 'goal-1|2026-07-30' })
    emptyPlanRead()

    const pending = useLearningStore.getState().fetchPlan('goal-1', '2026-07-31')
    expect(useLearningStore.getState().planAbsentFor).toBeNull()

    await pending
    expect(useLearningStore.getState().planAbsentFor).toBe('goal-1|2026-07-31')
  })
})

describe('reset', () => {
  it('clears the plan-absence facts along with the plan', async () => {
    // These describe one account's day. Left behind, `planAbsentFor` asserts "no plan today"
    // about the user who signed out, and `autoPlanAttempted` refuses to build one for the user
    // who signed in.
    useLearningStore.setState({
      planAbsentFor: 'goal-1|2026-07-31',
      autoPlanAttempted: { 'goal-1|2026-07-31': true },
    })

    useLearningStore.getState().reset()

    expect(useLearningStore.getState().planAbsentFor).toBeNull()
    expect(useLearningStore.getState().autoPlanAttempted).toEqual({})
  })
})

// ── autoGeneratePlan ───────────────────────────────────────────────────────
//
// The conditions under which opening the app may write a plan by itself. Each one exists
// because the write is destructive — `save_daily_plan` deletes every item and zeroes the day's
// progress — and because the 50-writes-per-UTC-day cap is shared across every goal and cannot be
// read back by the client. A wrong "yes" costs a learner the work they already did today; a
// wrong "no" costs them one button press.
describe('autoGeneratePlan', () => {
  const DECKS = [{ deck_id: 'deck-1', importance: 0.5 }]

  /** The one state that means "the server was asked, and answered: there is no plan". */
  const armAbsent = (planDate = CTX.planDate, goalId = 'goal-1') =>
    useLearningStore.setState({ planAbsentFor: `${goalId}|${planDate}`, autoPlanAttempted: {} })

  it('builds a plan once the server has confirmed there is none', async () => {
    armAbsent()
    queue('cards', { data: [], error: null })

    await useLearningStore.getState().autoGeneratePlan(goalWithDecks(DECKS), CTX)

    // It ran: `generatePlan` got as far as reading candidates and found nothing to plan.
    expect(useLearningStore.getState().planBlockedReason).toBe('no_candidates')
  })

  it('does nothing when no read has come back yet', async () => {
    // `planAbsentFor === null` is the initial state, and also what a FAILED read leaves behind.
    // `plan === null` cannot tell those apart from a real absence — which is why the trigger is
    // this positive fact and not the absence of a plan.
    useLearningStore.setState({ planAbsentFor: null, autoPlanAttempted: {} })

    await useLearningStore.getState().autoGeneratePlan(goalWithDecks(DECKS), CTX)

    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('does nothing when the absence was recorded for another day', async () => {
    // Crossing midnight with the screen open. Yesterday's "no plan" says nothing about today,
    // and acting on it would overwrite a plan the learner may already be part-way through.
    armAbsent('2026-07-30')

    await useLearningStore.getState().autoGeneratePlan(goalWithDecks(DECKS), CTX)

    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('does nothing when the absence was recorded for another goal', async () => {
    armAbsent(CTX.planDate, 'goal-2')

    await useLearningStore.getState().autoGeneratePlan(goalWithDecks(DECKS), CTX)

    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('attempts once per goal per day, even after the attempt failed', async () => {
    // A failure must not retry itself. The cap is shared across every goal and invisible here,
    // so a retry loop spends the learner\'s own regenerations on an error they cannot see.
    armAbsent()
    useLearningStore.setState({ autoPlanAttempted: { [`goal-1|${CTX.planDate}`]: true } })

    await useLearningStore.getState().autoGeneratePlan(goalWithDecks(DECKS), CTX)

    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('does not spend the one attempt on a goal with no decks', async () => {
    // `generatePlan` would only set `no_decks` here, but marking the attempt used would mean a
    // learner who attaches a deck a moment later still faces a button.
    armAbsent()

    await useLearningStore.getState().autoGeneratePlan(goalWithDecks([]), CTX)

    expect(useLearningStore.getState().autoPlanAttempted).toEqual({})
  })

  it('writes once when two mounts fire in the same tick', async () => {
    // StrictMode does exactly this. The attempt is recorded BEFORE the await, so the second
    // call is already out by guard (2) — which is why this needs no separate in-flight lock.
    armAbsent()
    queue('cards', { data: [cardRow('card-1')], error: null })
    queue('study_logs', { data: [], error: null })
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    const auto = useLearningStore.getState().autoGeneratePlan

    await Promise.all([auto(goalWithDecks(DECKS), CTX), auto(goalWithDecks(DECKS), CTX)])

    expect(mockRpc.mock.calls.filter(([name]) => name === 'save_daily_plan')).toHaveLength(1)
  })

  it('does nothing while the plan is still being read', async () => {
    // `planAbsentFor` is from the PREVIOUS read; a read in flight may be about to contradict it.
    armAbsent()
    useLearningStore.setState({ planLoading: true })

    await useLearningStore.getState().autoGeneratePlan(goalWithDecks(DECKS), CTX)

    expect(mockFrom).not.toHaveBeenCalled()
  })
})
