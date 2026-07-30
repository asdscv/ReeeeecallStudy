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
  for (const method of ['select', 'eq', 'neq', 'in', 'or', 'gte', 'order', 'limit', 'returns']) {
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

beforeEach(() => {
  vi.clearAllMocks()
  tableResults = {}
  mockFrom.mockImplementation((table: string) => {
    const pending = tableResults[table]
    const next = pending && pending.length > 0 ? pending.shift() : { data: [], error: null }
    return q(next)
  })
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
    expect(args.p_algorithm_version).toBe('daily-plan-v1')
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

// ── goal writes ────────────────────────────────────────────────────────────
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
