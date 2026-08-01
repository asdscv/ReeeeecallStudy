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

/** A thenable PostgREST-builder stub: every filter returns itself, awaiting resolves. */
function q(result: unknown) {
  const settled = Promise.resolve(result)
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'neq', 'in', 'or', 'not', 'gte', 'order', 'limit', 'returns']) {
    builder[method] = () => builder
  }
  builder.maybeSingle = () => settled
  builder.then = (onOk: unknown, onErr: unknown) =>
    settled.then(onOk as never, onErr as never)
  return builder
}

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

function cardRow(id: string) {
  return {
    id, deck_id: 'deck-1', user_id: 'user-1', template_id: 'tpl-1',
    field_values: { front: 'q', back: 'a' }, tags: [], sort_position: 1,
    srs_status: 'review', ease_factor: 2.5, interval_days: 3, repetitions: 2,
    next_review_at: '2026-07-30T00:00:00.000Z', last_reviewed_at: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  }
}

/** A deck row as `generatePlan` reads it, to decide where the SRS state lives. */
const deckRow = (over: Record<string, unknown> = {}) =>
  ({ id: 'deck-1', user_id: 'user-1', share_mode: null, source_owner_id: null, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  tableResults = {}
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
})

describe('fetchAttempts', () => {
  it('loads the goal\'s attempts', async () => {
    queue('answer_attempts', {
      data: [{ id: 'a1', goal_id: 'goal-1', card_id: 'card-1', activity_id: null,
        plan_item_id: 'item-1', activity_type: 'recall', evaluator_type: 'self_rate',
        normalized_score: 0.5, duration_ms: 1000, created_at: '2026-07-31T00:00:00.000Z' }],
      error: null,
    })

    await useLearningStore.getState().fetchAttempts('goal-1')

    expect(useLearningStore.getState().attempts).toHaveLength(1)
    expect(useLearningStore.getState().attemptsLoading).toBe(false)
  })
})
// ── enrichment (Phase 3, paid) ─────────────────────────────────────────────
describe('requestEnrichment', () => {
  const ok = {
    content: { explanation: 'because', sources: [{ title: '근로기준법', clause: '제56조' }] },
    enrichmentId: 'enr-1',
    balance: 12345,
  }

  it('asks the server and holds the result as a preview', async () => {
    mockCallServerAI.mockResolvedValue(ok)

    const done = await useLearningStore.getState().requestEnrichment({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', uiLang: 'ko',
    })

    expect(done).toBe(true)
    expect(mockCallServerAI).toHaveBeenCalledWith({
      kind: 'remediation', action: 'explain', uiLang: 'ko',
      goalId: 'goal-1', cardIds: ['card-1'],
    })
    const preview = useLearningStore.getState().enrichment
    expect(preview?.enrichmentId).toBe('enr-1')
    expect(preview?.sources).toHaveLength(1)
    expect(preview?.balance).toBe(12345)
    expect(useLearningStore.getState().enrichmentPendingCardId).toBeNull()
  })

  it('refuses to show content it cannot let the user keep', async () => {
    // No enrichment id → the preview was never persisted, so Accept would have nothing to
    // act on. Showing the text anyway would promise something we cannot deliver.
    mockCallServerAI.mockResolvedValue({ content: { explanation: 'x' } })

    const done = await useLearningStore.getState().requestEnrichment({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', uiLang: 'ko',
    })

    expect(done).toBe(false)
    expect(useLearningStore.getState().enrichment).toBeNull()
    expect(useLearningStore.getState().enrichmentError).toBe('UNKNOWN')
  })

  it('keeps every server failure distinguishable, because the next action differs', async () => {
    const cases: Array<[string, string]> = [
      ['AI_INSUFFICIENT_CREDITS', 'INSUFFICIENT_CREDITS'],  // top up
      ['AI_RATE_CAP', 'RATE_CAP'],                          // wait for tomorrow
      ['AI_GROUNDING_REQUIRED', 'GROUNDING_REQUIRED'],      // refused, not broken
      ['AI_INVALID_RESULT', 'INVALID_RESULT'],
      ['AI_PROVIDER_ERROR', 'PROVIDER_ERROR'],
      ['AI_NOT_CONFIGURED', 'NOT_CONFIGURED'],
      ['FORBIDDEN', 'FORBIDDEN'],
      ['BAD_REQUEST', 'BAD_REQUEST'],
      ['NETWORK_ERROR', 'NETWORK'],
      ['AI_PERSISTENCE_ERROR', 'UNKNOWN'],                  // server fault, not actionable
    ]
    for (const [serverCode, expected] of cases) {
      mockCallServerAI.mockRejectedValueOnce(new Error(serverCode))
      await useLearningStore.getState().requestEnrichment({
        action: 'explain', goalId: 'goal-1', cardId: 'card-1', uiLang: 'ko',
      })
      expect(useLearningStore.getState().enrichmentError, serverCode).toBe(expected)
    }
  })

  it('ignores a second request while one is in flight (each call costs money)', async () => {
    mockCallServerAI.mockResolvedValue(ok)

    const first = useLearningStore.getState().requestEnrichment({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', uiLang: 'ko',
    })
    const second = await useLearningStore.getState().requestEnrichment({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', uiLang: 'ko',
    })
    await first

    expect(second).toBe(false)
    expect(mockCallServerAI).toHaveBeenCalledTimes(1)
  })

  it('grounds the request in the attempt the caller named', async () => {
    // The whole point of the feature: without this id the model explains the card in the
    // abstract and can never say "you have missed this four times".
    mockCallServerAI.mockResolvedValue(ok)

    await useLearningStore.getState().requestEnrichment({
      action: 'hint', goalId: 'goal-1', cardId: 'card-1', attemptId: 'att-9', uiLang: 'ko',
    })

    expect(mockCallServerAI).toHaveBeenCalledWith({
      kind: 'remediation', action: 'hint', uiLang: 'ko',
      goalId: 'goal-1', cardIds: ['card-1'], attemptId: 'att-9',
    })
  })

  it('omits the key entirely when there is no attempt, rather than sending null', async () => {
    // `parseRemediationRefs` treats a present-but-null attemptId as a supplied value and the
    // edge function rejects it as a malformed uuid — so the card-scoped button, which has no
    // attempt, would start failing. toHaveBeenCalledWith cannot catch this (deep equality
    // ignores undefined-valued keys), so assert on the key list.
    mockCallServerAI.mockResolvedValue(ok)

    await useLearningStore.getState().requestEnrichment({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', attemptId: null, uiLang: 'ko',
    })

    const payload = mockCallServerAI.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload)).not.toContain('attemptId')
  })
})

describe('loadEnrichmentQuote', () => {
  it('reads what one remediation costs and where it comes from', async () => {
    // reserve_ai_remediation books exactly one paid card-equivalent, so the wallet's
    // per-card estimate is the per-request estimate.
    mockGetAiWallet.mockResolvedValue({ balanceMicroWon: 1_480_000, estPricePerCardMicro: 3_880 })

    await useLearningStore.getState().loadEnrichmentQuote()

    expect(useLearningStore.getState().enrichmentQuote)
      .toEqual({ estPriceMicro: 3_880, balanceMicro: 1_480_000 })
  })

  it('leaves the feature usable when the wallet cannot be read', async () => {
    // Null, never a zeroed quote: rendering $0.00 would understate a real charge, and a
    // wallet read that fails must not stop a learner who has credits from asking.
    mockGetAiWallet.mockResolvedValue(null)
    mockCallServerAI.mockResolvedValue({ content: { explanation: 'because' }, enrichmentId: 'enr-1' })

    await useLearningStore.getState().loadEnrichmentQuote()

    expect(useLearningStore.getState().enrichmentQuote).toBeNull()
    expect(await useLearningStore.getState().requestEnrichment({
      action: 'explain', goalId: 'goal-1', cardId: 'card-1', uiLang: 'ko',
    })).toBe(true)
  })
})

describe('resolveEnrichment', () => {
  beforeEach(() => {
    useLearningStore.setState({
      enrichment: { enrichmentId: 'enr-1', action: 'explain', content: {}, sources: [], balance: null },
    })
  })

  it('keeps the preview via the RPC and closes it', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })

    const done = await useLearningStore.getState().resolveEnrichment('accepted')

    expect(done).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith('set_user_enrichment_status', {
      p_enrichment_id: 'enr-1', p_status: 'accepted',
    })
    expect(useLearningStore.getState().enrichment).toBeNull()
  })

  it('treats an already-finalized preview as done rather than trapping the user', async () => {
    // set_user_enrichment_status only allows a transition OUT of 'preview' (P0007
    // otherwise). A double-click must not leave an error the user cannot clear.
    mockRpc.mockResolvedValue({
      data: null, error: { code: 'P0007', message: 'Enrichment status is already finalized' },
    })

    const done = await useLearningStore.getState().resolveEnrichment('accepted')

    expect(done).toBe(true)
    expect(useLearningStore.getState().enrichment).toBeNull()
    expect(useLearningStore.getState().enrichmentError).toBeNull()
  })

  it('does nothing when there is no open preview', async () => {
    useLearningStore.setState({ enrichment: null })

    expect(await useLearningStore.getState().resolveEnrichment('rejected')).toBe(false)
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

// ── recommendations (Phase 4b) ─────────────────────────────────────────────
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
        algorithm_version: 'weak-card-v1', status: 'pending', created_at: '2026-07-31T00:00:00Z',
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
        algorithm_version: 'weak-card-v1', status: 'pending', created_at: '2026-07-31T00:00:00Z',
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
        algorithm_version: 'weak-card-v1', status: 'pending', created_at: '2026-07-31T00:00:00Z',
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
        algorithm_version: 'weak-card-v1', status: 'accepted', created_at: '2026-07-31T00:00:00Z',
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
})
