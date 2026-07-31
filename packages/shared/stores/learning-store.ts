// ─── Learning engine store (goals + today's plan) ───────────────────────────
//
// This is the first product surface over the learning engine (migs 165/167/172).
// Everything it reads is owner-scoped by RLS; everything it writes goes through a
// SECURITY DEFINER RPC, because mig 165 grants the learning tables SELECT only. If
// something is not exposed by an RPC it is a gap to close in SQL — never a reason to
// reach for a service-role key from a client.
//
// The planner itself stays pure (learning design §9.1): this store gathers rows,
// hands them to `buildCandidatesFromCards` → `buildDailyPlan`, persists the result
// with `save_daily_plan`, and then RE-READS the saved plan so the UI renders the
// database's version of the plan rather than a local object that might differ.
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import {
  buildCandidatesFromCards, legacyCardItemShape, type CandidateStudyLog,
} from '../lib/learning-candidates'
import { buildDailyPlan, DAILY_PLANNER_VERSION } from '../learning/application/index'
import type { LearningGoal } from '../learning/domain/index'
import type { Card } from '../types/database'

// ── Row shapes (snake_case, as returned by PostgREST) ───────────────────────
export interface LearningGoalRow {
  id: string
  domain_id: string
  title: string
  target_date: string | null
  daily_minutes: number
  status: 'active' | 'paused' | 'completed' | 'archived'
  target: Record<string, unknown>
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface GoalDeckLink {
  deck_id: string
  importance: number
}

export interface LearningGoalWithDecks extends LearningGoalRow {
  decks: GoalDeckLink[]
}

export interface DailyPlanRow {
  id: string
  goal_id: string
  plan_date: string
  timezone: string
  algorithm_version: string
  input_fingerprint: string
  status: 'pending' | 'active' | 'completed' | 'abandoned' | string
  budget_minutes: number
  completed_minutes: number
  completed_items: number
  total_items: number
}

export interface DailyPlanItemRow {
  id: string
  plan_id: string
  position: number
  activity_id: string | null
  card_id: string | null
  concept_id: string | null
  activity_type: string
  stimulus_type: string
  response_type: string
  evaluator_type: string
  reason_code: string
  priority: number | null
  estimated_minutes: number | null
  status: 'pending' | 'done' | 'skipped' | string
}

/**
 * Every failure the UI has to tell apart, as a stable code.
 *
 * The RPCs raise distinct `P000x` SQLSTATEs and the difference is user-visible:
 * "you have hit today's regeneration limit" and "that goal is archived" need
 * different words, and collapsing them into one string is how a support ticket is
 * born. Anything unrecognised stays `UNKNOWN` rather than being guessed at.
 */
export type LearningErrorCode =
  | 'AUTH_REQUIRED'      // P0001
  | 'INVALID_INPUT'      // P0002
  | 'NOT_FOUND'          // P0003 — missing, not owned, archived, or inaccessible reference
  | 'LIMIT_EXCEEDED'     // P0006 — goal cap, deck cap, 50 plan saves/day, payload size
  | 'CONFLICT'           // P0007 — completed plan, illegal status transition
  | 'FORBIDDEN'          // 42501
  | 'UNKNOWN'

export interface LearningError {
  code: LearningErrorCode
  message: string
}

function toLearningError(error: unknown): LearningError {
  const raw = error as { code?: string; message?: string } | null
  const message = raw?.message ?? 'Unexpected error'
  switch (raw?.code) {
    case 'P0001': return { code: 'AUTH_REQUIRED', message }
    case 'P0002': return { code: 'INVALID_INPUT', message }
    case 'P0003': return { code: 'NOT_FOUND', message }
    case 'P0006': return { code: 'LIMIT_EXCEEDED', message }
    case 'P0007': return { code: 'CONFLICT', message }
    case '42501': return { code: 'FORBIDDEN', message }
    default: return { code: 'UNKNOWN', message }
  }
}

/** The planner needs a domain `LearningGoal`; the DB hands us a row. */
function toDomainGoal(row: LearningGoalRow, userId: string): LearningGoal {
  return {
    id: row.id,
    userId,
    domainId: row.domain_id,
    title: row.title,
    targetDate: row.target_date,
    dailyMinutes: row.daily_minutes,
    status: row.status,
    target: row.target ?? {},
    settings: row.settings ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const CARD_COLUMNS =
  'id, deck_id, user_id, template_id, field_values, tags, sort_position, srs_status,'
  + ' ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at,'
  + ' created_at, updated_at'

/**
 * Upper bound on the cards pulled for one plan. A plan is one day of work; at
 * RECALL_MINUTES per item even a 1440-minute budget cannot use more than ~2880, and
 * a 500-card slice of the DUE set is far past any realistic daily budget. The cap
 * exists so a 50k-card account cannot turn plan generation into a full table read.
 */
const CANDIDATE_CARD_LIMIT = 500

/** How far back study logs are read for the failure/timing features. */
const LOG_WINDOW_DAYS = 30
const LOG_ROW_LIMIT = 2000

/** The little a plan row needs to show and link an item: which deck, what it says. */
export interface PlanCardRef {
  id: string
  deck_id: string
  field_values: Record<string, string>
}

export interface PlanContext {
  /** IANA zone, e.g. 'Asia/Seoul'. Supplied by the platform layer: shared code must
   *  not depend on Intl (the mobile bundle is deliberately Intl-free). */
  timezone: string
  /** `YYYY-MM-DD` in that zone — which day the user thinks it is. */
  planDate: string
  /** ISO instant, injected so a plan is reproducible in tests. */
  now: string
}

export interface CreateGoalInput {
  domainId: string
  title: string
  dailyMinutes: number
  targetDate?: string | null
  decks?: GoalDeckLink[]
}

export interface UpdateGoalInput {
  goalId: string
  title?: string
  dailyMinutes?: number
  targetDate?: string | null
  status?: 'active' | 'paused' | 'completed'
  decks?: GoalDeckLink[]
}

interface LearningState {
  goals: LearningGoalWithDecks[]
  goalsLoading: boolean
  goalsError: LearningError | null

  plan: DailyPlanRow | null
  planItems: DailyPlanItemRow[]
  /** Cards referenced by the current plan's items, by card id. */
  planCards: Record<string, PlanCardRef>
  planLoading: boolean
  planGenerating: boolean
  planError: LearningError | null
  /** Set when the goal has no decks attached: there is nothing to plan over. */
  planBlockedReason: 'no_decks' | 'no_candidates' | null

  fetchGoals: () => Promise<void>
  createGoal: (input: CreateGoalInput) => Promise<string | null>
  updateGoal: (input: UpdateGoalInput) => Promise<boolean>
  archiveGoal: (goalId: string) => Promise<boolean>
  setGoalDecks: (goalId: string, decks: GoalDeckLink[]) => Promise<boolean>

  fetchPlan: (goalId: string, planDate: string) => Promise<void>
  generatePlan: (goal: LearningGoalWithDecks, ctx: PlanContext) => Promise<boolean>
  reset: () => void
}

export const useLearningStore = create<LearningState>((set, get) => ({
  goals: [],
  goalsLoading: false,
  goalsError: null,
  plan: null,
  planItems: [],
  planCards: {},
  planLoading: false,
  planGenerating: false,
  planError: null,
  planBlockedReason: null,

  fetchGoals: async () => {
    if (get().goalsLoading) return
    set({ goalsLoading: true, goalsError: null })
    try {
      // Archived goals are excluded: they cannot be planned or edited (the RPCs
      // reject them), so listing them would only offer dead actions.
      const { data: goalRows, error: goalError } = await supabase
        .from('learning_goals')
        .select('id, domain_id, title, target_date, daily_minutes, status, target, settings, created_at, updated_at')
        .neq('status', 'archived')
        .order('created_at', { ascending: true })
      if (goalError) throw goalError

      const goals = (goalRows ?? []) as LearningGoalRow[]
      if (goals.length === 0) {
        set({ goals: [] })
        return
      }

      const { data: linkRows, error: linkError } = await supabase
        .from('learning_goal_decks')
        .select('goal_id, deck_id, importance')
        .in('goal_id', goals.map((goal) => goal.id))
      if (linkError) throw linkError

      const byGoal = new Map<string, GoalDeckLink[]>()
      for (const row of (linkRows ?? []) as Array<GoalDeckLink & { goal_id: string }>) {
        const bucket = byGoal.get(row.goal_id)
        const link = { deck_id: row.deck_id, importance: Number(row.importance) }
        if (bucket) bucket.push(link)
        else byGoal.set(row.goal_id, [link])
      }

      set({ goals: goals.map((goal) => ({ ...goal, decks: byGoal.get(goal.id) ?? [] })) })
    } catch (e) {
      set({ goalsError: toLearningError(e) })
    } finally {
      set({ goalsLoading: false })
    }
  },

  createGoal: async (input) => {
    set({ goalsError: null })
    try {
      const { data, error } = await supabase.rpc('create_learning_goal', {
        p_domain_id: input.domainId,
        p_title: input.title,
        p_daily_minutes: input.dailyMinutes,
        p_target_date: input.targetDate ?? null,
      })
      if (error) throw error
      const goalId = (data as { goal_id?: string } | null)?.goal_id ?? null
      // Deck attachment is a second call by design: mig 172 replaces the whole set,
      // and a goal that exists with no decks is a valid (if inert) state, so a failure
      // here leaves a usable goal the user can attach decks to from the edit form.
      if (goalId && input.decks?.length) {
        const { error: linkError } = await supabase.rpc('set_learning_goal_decks', {
          p_goal_id: goalId, p_decks: input.decks,
        })
        if (linkError) throw linkError
      }
      await get().fetchGoals()
      return goalId
    } catch (e) {
      set({ goalsError: toLearningError(e) })
      return null
    }
  },

  updateGoal: async (input) => {
    set({ goalsError: null })
    try {
      // Only send what changed: every parameter is COALESCE'd server-side, so a null
      // means "leave it alone" — passing undefined fields as null would silently keep
      // the old value and look like a failed edit.
      const payload: Record<string, unknown> = { p_goal_id: input.goalId }
      if (input.title !== undefined) payload.p_title = input.title
      if (input.dailyMinutes !== undefined) payload.p_daily_minutes = input.dailyMinutes
      if (input.targetDate !== undefined) payload.p_target_date = input.targetDate
      if (input.status !== undefined) payload.p_status = input.status
      const { error } = await supabase.rpc('update_learning_goal', payload)
      if (error) throw error
      if (input.decks) {
        const { error: linkError } = await supabase.rpc('set_learning_goal_decks', {
          p_goal_id: input.goalId, p_decks: input.decks,
        })
        if (linkError) throw linkError
      }
      await get().fetchGoals()
      return true
    } catch (e) {
      set({ goalsError: toLearningError(e) })
      return false
    }
  },

  archiveGoal: async (goalId) => {
    set({ goalsError: null })
    try {
      const { error } = await supabase.rpc('archive_learning_goal', { p_goal_id: goalId })
      if (error) throw error
      await get().fetchGoals()
      return true
    } catch (e) {
      set({ goalsError: toLearningError(e) })
      return false
    }
  },

  setGoalDecks: async (goalId, decks) => {
    set({ goalsError: null })
    try {
      const { error } = await supabase.rpc('set_learning_goal_decks', {
        p_goal_id: goalId, p_decks: decks,
      })
      if (error) throw error
      await get().fetchGoals()
      return true
    } catch (e) {
      set({ goalsError: toLearningError(e) })
      return false
    }
  },

  fetchPlan: async (goalId, planDate) => {
    set({ planLoading: true, planError: null, planBlockedReason: null })
    try {
      const { data: planRow, error: planErr } = await supabase
        .from('daily_plans')
        .select('id, goal_id, plan_date, timezone, algorithm_version, input_fingerprint, status, budget_minutes, completed_minutes, completed_items, total_items')
        .eq('goal_id', goalId)
        .eq('plan_date', planDate)
        .maybeSingle()
      if (planErr) throw planErr
      if (!planRow) {
        set({ plan: null, planItems: [], planCards: {} })
        return
      }
      const { data: itemRows, error: itemErr } = await supabase
        .from('daily_plan_items')
        .select('id, plan_id, position, activity_id, card_id, concept_id, activity_type, stimulus_type, response_type, evaluator_type, reason_code, priority, estimated_minutes, status')
        .eq('plan_id', (planRow as DailyPlanRow).id)
        .order('position', { ascending: true })
      if (itemErr) throw itemErr
      const items = (itemRows ?? []) as DailyPlanItemRow[]

      // Plan items store only the card id, so the row cannot say what to study or
      // which deck to open without this. Kept separate from the items rather than
      // denormalized into them: the card is the live record and may have been edited
      // since the plan was written.
      const cardIds = items.map((item) => item.card_id).filter((id): id is string => !!id)
      let planCards: Record<string, PlanCardRef> = {}
      if (cardIds.length > 0) {
        const { data: cardRefs, error: refErr } = await supabase
          .from('cards')
          .select('id, deck_id, field_values')
          .in('id', cardIds)
          .returns<PlanCardRef[]>()
        if (refErr) throw refErr
        planCards = Object.fromEntries((cardRefs ?? []).map((card) => [card.id, card]))
      }

      set({ plan: planRow as DailyPlanRow, planItems: items, planCards })
    } catch (e) {
      set({ planError: toLearningError(e), plan: null, planItems: [], planCards: {} })
    } finally {
      set({ planLoading: false })
    }
  },

  /**
   * Generate + persist today's plan for a goal.
   *
   * Called on EXPLICIT intent only (first open of the day, or the user asking for a
   * new plan) — never from an effect that can re-fire. `save_daily_plan` is capped at
   * 50 saves per user per day, so a regenerate-on-render loop would burn a real quota
   * and then start failing.
   */
  generatePlan: async (goal, ctx) => {
    if (get().planGenerating) return false
    set({ planGenerating: true, planError: null, planBlockedReason: null })
    try {
      const deckIds = goal.decks.map((link) => link.deck_id)
      if (deckIds.length === 0) {
        // Nothing to plan over. Refusing here is deliberate: sending an empty item
        // list would fail server-side validation ("Plan must have at least one item")
        // and surface as a confusing error instead of a clear empty state.
        set({ planBlockedReason: 'no_decks' })
        return false
      }

      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id
      if (!userId) throw { code: 'P0001', message: 'Authentication required' }

      // Only the DUE set: a plan is today's work, and this keeps a large account from
      // turning generation into a full-table read. `next_review_at IS NULL` is a new
      // card, which the mapper scores as maximally due.
      const { data: cardRows, error: cardErr } = await supabase
        .from('cards')
        .select(CARD_COLUMNS)
        .in('deck_id', deckIds)
        .or(`next_review_at.is.null,next_review_at.lte.${ctx.now}`)
        .limit(CANDIDATE_CARD_LIMIT)
        .returns<Card[]>()
      if (cardErr) throw cardErr
      const cards = cardRows ?? []
      if (cards.length === 0) {
        set({ planBlockedReason: 'no_candidates' })
        return false
      }

      const since = new Date(Date.parse(ctx.now) - LOG_WINDOW_DAYS * 86_400_000).toISOString()
      const { data: logRows, error: logErr } = await supabase
        .from('study_logs')
        .select('card_id, rating, review_duration_ms, studied_at')
        .in('deck_id', deckIds)
        .gte('studied_at', since)
        .order('studied_at', { ascending: false })
        .limit(LOG_ROW_LIMIT)
      if (logErr) throw logErr

      const deckImportance: Record<string, number> = {}
      for (const link of goal.decks) deckImportance[link.deck_id] = link.importance

      const candidates = buildCandidatesFromCards({
        cards,
        recentLogs: (logRows ?? []) as CandidateStudyLog[],
        deckImportance,
        now: ctx.now,
      })

      const output = buildDailyPlan({
        goal: toDomainGoal(goal, userId),
        candidates,
        budgetMinutes: goal.daily_minutes,
        now: ctx.now,
        timezone: ctx.timezone,
        algorithmVersion: DAILY_PLANNER_VERSION,
      })
      if (output.items.length === 0) {
        set({ planBlockedReason: 'no_candidates' })
        return false
      }

      const cardsById = new Map(cards.map((card) => [card.id, card]))
      const items = output.items.map((item) => {
        const card = item.cardId ? cardsById.get(item.cardId) : undefined
        const shape = card
          ? legacyCardItemShape(card)
          : { activityType: item.activityType, stimulusType: 'text', responseType: 'self_rate', evaluatorType: 'self_rate' }
        return {
          activity_id: item.activityId,
          card_id: item.cardId,
          concept_id: item.conceptId,
          activity_type: shape.activityType,
          stimulus_type: shape.stimulusType,
          response_type: shape.responseType,
          evaluator_type: shape.evaluatorType,
          reason_code: item.reasonCode,
          priority: item.priority,
          estimated_minutes: item.estimatedMinutes,
        }
      })

      const { error: saveErr } = await supabase.rpc('save_daily_plan', {
        p_goal_id: goal.id,
        p_plan_date: ctx.planDate,
        p_timezone: ctx.timezone,
        p_algorithm_version: output.algorithmVersion,
        p_input_fingerprint: output.inputFingerprint,
        p_budget_minutes: goal.daily_minutes,
        p_items: items,
      })
      if (saveErr) throw saveErr

      // Re-read: the stored rows (with their ids and server-side statuses) are what
      // the UI acts on, not the in-memory planner output.
      await get().fetchPlan(goal.id, ctx.planDate)
      return true
    } catch (e) {
      set({ planError: toLearningError(e) })
      return false
    } finally {
      set({ planGenerating: false })
    }
  },

  reset: () => set({
    goals: [], goalsLoading: false, goalsError: null,
    plan: null, planItems: [], planCards: {}, planLoading: false, planGenerating: false,
    planError: null, planBlockedReason: null,
  }),
}))
