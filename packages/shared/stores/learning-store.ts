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
import type { TemplateFieldOrder } from '../lib/card-prompt'
import { supabase } from '../lib/supabase'
import {
  buildCandidatesFromCards, legacyCardItemShape, planItemAnswerPayload,
  TYPED_ANSWER_MAX_CHARS, type CandidateStudyLog,
} from '../lib/learning-candidates'
import { callServerAI, getAiWallet } from '../lib/ai/server-client'
import {
  summarizeLearning, type InsightAttempt, type InsightPlan, type LearningInsights,
} from '../lib/learning-insights'
import {
  splitDecksBySrsSource, attachProgressToCards, isDueAt, type PlannerDeckMeta,
} from '../lib/learning-card-sources'
import type { UserCardProgress } from '../lib/srs-access'
import {
  buildDailyPlan, DAILY_PLANNER_VERSION, retentionStabilityMultiplier,
  parseNewCardsPerDay,
} from '../learning/application/index'
import { activityMixForDomain, supportedActivityTypesForDomain } from '../learning/adapters/index'
import type { LearningGoal } from '../learning/domain/index'
import type { Card, LayoutItem, TemplateField } from '../types/database'

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
  /**
   * Server vocabulary, not ours: mig 165 constrains this to
   * CHECK (status IN ('pending','completed','skipped')) and record_answer_attempt writes
   * 'completed'. Phase 1 typed it as 'done' and the UI compared against that, so a finished
   * item never rendered as finished. Keep these three spellings exact.
   */
  status: 'pending' | 'completed' | 'skipped'
  /**
   * What the planner knew when it chose this row, kept so the plan can SHOW its reasoning.
   *
   * `recall_probability` is the estimated chance the learner can recall the item right now
   * (`application/memory.ts`). ABSENT — not null — for a card with no forgetting curve yet,
   * so "we cannot say" and "we say 0%" stay different things all the way to the screen.
   */
  payload?: { recall_probability?: number } | null
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
 * Template columns both plan paths read — ONE constant, deliberately.
 *
 * `fields` orders the prompt label (`card-prompt`); `front_layout` / `back_layout` are what
 * `resolveCardAnswerFaces` reads to decide whether a card can be answered by typing. Two selects
 * over the same table for two overlapping purposes is how the read path and the write path end
 * up disagreeing about the same card, so they share this.
 *
 * RLS matters here and is left alone on purpose: a subscriber can read a shared template only
 * when it is the deck's `default_template_id` (mig 009). An unreadable template is simply absent
 * from the result, the resolver returns null, and the item stays a self-rating. Fail-closed.
 */
const TEMPLATE_COLUMNS = 'id, fields, front_layout, back_layout'

interface PlanTemplateRow {
  id: string
  fields: TemplateField[]
  front_layout: LayoutItem[]
  back_layout: LayoutItem[]
}

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
  template_id: string | null
  field_values: Record<string, string>
}

export interface AttemptRow {
  id: string
  goal_id: string | null
  card_id: string | null
  activity_id: string | null
  plan_item_id: string | null
  activity_type: string
  /**
   * What KIND of response was recorded — `'self_rate'` for a rating alone, `'text'` for a
   * typed answer. Read back rather than assumed because it is the only thing that says whether
   * `response.text` is meaningful, and a later paid `compare` must not be offered on a row that
   * has no answer in it.
   */
  response_type: string
  evaluator_type: string
  /**
   * The raw response jsonb. `{ self_rated }` always; `{ self_rated, text }` when the learner
   * typed something. Kept as the stored shape rather than flattened into a `text` field, so the
   * UI reads exactly what the server holds — and therefore exactly what a model would be shown.
   */
  response: Record<string, unknown> | null
  normalized_score: number | null
  duration_ms: number
  created_at: string
}

/**
 * What the user reported about a plan item they just worked on.
 *
 * `score` is a self-rating on 0..1 — the legacy-card projection is
 * `recall / self_rate / self_rate` (design §5.2), so the learner IS the evaluator here.
 * It is NOT an SRS rating: `apply_study_rating` (mig 160) remains the single authority for
 * scheduling, and recording an attempt deliberately does not touch interval/ease. The two
 * are different questions — "when should I see this again" vs "how did this attempt go".
 */
/** Card counts for a goal, as `get_goal_knowledge` reports them. */
export interface GoalKnowledge {
  readonly total: number
  /** Never reviewed. Kept out of both known and unknown — no evidence is not "forgotten". */
  readonly unseen: number
  readonly known: number
  readonly unknown: number
}

export interface AttemptInput {
  planItem: DailyPlanItemRow
  goalId: string
  score: number
  durationMs?: number
  /**
   * What the learner typed, when the item asks for it (`planItem.response_type === 'text'`).
   *
   * Stored verbatim (trimmed) next to the rating; nothing grades it. It is IGNORED on an item
   * whose snapshot says `self_rate`, because an item with no input field has no typed answer and
   * writing one anyway would put text in a row that claims to hold only a rating.
   *
   * One retry hazard, owned by the caller: `p_response` is part of the RPC's idempotency
   * comparison (mig 167), so replaying the SAME `clientAttemptId` with different text raises
   * P0007. Mint the id at submit time, together with the text — never before it is final.
   */
  text?: string
  /** Stable per attempt: the RPC is idempotent on it, so a retry cannot double-record. */
  clientAttemptId: string
}

/**
 * A remediation the server generated, charged for, and persisted as a PREVIEW.
 *
 * The money is already spent by the time this exists — `ai-generate` reserves before
 * generating and charges after (mig 168). Accepting or rejecting only decides whether the
 * content is kept, so "reject" is not a refund and the UI must not imply that it is.
 */
export interface EnrichmentPreview {
  enrichmentId: string
  action: RemediationAction
  content: Record<string, unknown>
  /** Source citations the server validated. Labor-law content cannot be ungrounded. */
  sources: EnrichmentSource[]
  /** Wallet balance in micro-USD after the charge, when the server reported it. */
  balance: number | null
}

export interface RecommendationRow {
  id: string
  goal_id: string | null
  card_id: string | null
  concept_id: string | null
  activity_id: string | null
  action_type: string
  provider: string
  reason: string | null
  algorithm_version: string | null
  status: 'pending' | 'accepted' | 'dismissed' | 'expired'
  created_at: string
}

/** The deterministic producer's version, recorded on every row it writes. */
export const WEAK_CARD_RECOMMENDER_VERSION = 'weak-card-v1'

export interface EnrichmentSource {
  title?: string
  url?: string
  clause?: string
  id?: string
}

/**
 * Actions the UI offers. Must stay a subset of `SERVED_REMEDIATION_ACTIONS` on the server —
 * that list, not this one, is what actually gates a charge.
 *
 * `compare` is offered ONLY on an attempt that carries the learner's typed answer
 * (`attemptTypedAnswer`), because the server refuses an ungrounded one and a button that spends
 * a request to get a refusal is worse than no button. `evaluate` / `generate` / `recommend`
 * remain unserved.
 */
export type RemediationAction = 'explain' | 'hint' | 'compare'

/**
 * The price of one remediation, in micro-USD, plus the balance it comes out of.
 *
 * `reserve_ai_remediation` books exactly one paid card-equivalent per request
 * (`paid_cards = 1, billable_fraction = 1.0`, mig 168), so the wallet's per-card estimate IS
 * the per-request estimate. It is an ESTIMATE: the real charge is the model's actual token cost,
 * settled after the call, and the UI must not present it as a fixed price.
 */
export interface EnrichmentQuote {
  estPriceMicro: number
  balanceMicro: number
}

/**
 * Everything the enrichment call can fail with, kept distinct because the user's next
 * action differs per case: top up, wait for tomorrow, or nothing they can do.
 */
export type EnrichmentErrorCode =
  | 'INSUFFICIENT_CREDITS'   // AI_INSUFFICIENT_CREDITS — 402, wallet empty
  | 'RATE_CAP'               // AI_RATE_CAP — 429, today's request cap
  | 'GROUNDING_REQUIRED'     // AI_GROUNDING_REQUIRED — refused rather than cite nothing
  | 'COMPARE_NO_ANSWER'      // AI_COMPARE_NO_ANSWER — nothing typed to compare; the learner can fix this
  | 'COMPARE_NO_REFERENCE'   // AI_COMPARE_NO_REFERENCE — the card never declared an answer field
  | 'INVALID_RESULT'         // AI_INVALID_RESULT — model returned something unusable
  | 'PROVIDER_ERROR'         // AI_PROVIDER_ERROR / AI_PROVIDER_AUTH
  | 'NOT_CONFIGURED'         // AI_NOT_CONFIGURED — no provider key on this deployment
  | 'FORBIDDEN'              // reference not accessible
  | 'BAD_REQUEST'
  | 'NETWORK'
  | 'UNKNOWN'

function toEnrichmentError(e: unknown): EnrichmentErrorCode {
  // callServerAI throws `new Error(<server code>)`, so the message IS the code.
  const code = e instanceof Error ? e.message : String(e)
  switch (code) {
    case 'AI_INSUFFICIENT_CREDITS': return 'INSUFFICIENT_CREDITS'
    case 'AI_RATE_CAP': return 'RATE_CAP'
    case 'AI_GROUNDING_REQUIRED': return 'GROUNDING_REQUIRED'
    case 'AI_COMPARE_NO_ANSWER': return 'COMPARE_NO_ANSWER'
    case 'AI_COMPARE_NO_REFERENCE': return 'COMPARE_NO_REFERENCE'
    case 'AI_INVALID_RESULT': return 'INVALID_RESULT'
    case 'AI_PROVIDER_ERROR':
    case 'AI_PROVIDER_AUTH': return 'PROVIDER_ERROR'
    case 'AI_NOT_CONFIGURED': return 'NOT_CONFIGURED'
    case 'FORBIDDEN': return 'FORBIDDEN'
    case 'BAD_REQUEST': return 'BAD_REQUEST'
    case 'NETWORK_ERROR': return 'NETWORK'
    // AI_PERSISTENCE_ERROR and AI_METER_ERROR are server faults the user cannot act on;
    // they are surfaced as UNKNOWN rather than pretending to be actionable.
    default: return 'UNKNOWN'
  }
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
  /**
   * Field keys per template, in the order the template says to read them.
   *
   * Needed because `field_values` is jsonb: Postgres returns its keys in its own order, so
   * "the first value" can be the ANSWER — see shared/lib/card-prompt.
   */
  planTemplateFields: TemplateFieldOrder
  planLoading: boolean
  planGenerating: boolean
  planError: LearningError | null
  /** Set when the goal has no decks attached: there is nothing to plan over. */
  planBlockedReason: 'no_decks' | 'no_candidates' | null

  /** Plan-item id currently being recorded, so one row can show progress alone. */
  recordingItemId: string | null
  attempts: AttemptRow[]
  attemptsLoading: boolean

  /** The preview being shown. Null when nothing is open. */
  enrichment: EnrichmentPreview | null
  /** Card id the request is running for, so one row can show its own spinner. */
  enrichmentPendingCardId: string | null
  enrichmentError: EnrichmentErrorCode | null
  enrichmentSaving: boolean
  /**
   * What one remediation costs, read before the call.
   *
   * Null means "we could not read the wallet" — which the UI renders as no number at all, never
   * as $0.00. A quote that fails must not block a learner who has credits, and must not claim a
   * price of zero for something that charges.
   */
  enrichmentQuote: EnrichmentQuote | null

  /**
   * Goal progress from `get_goal_knowledge` (mig 181), keyed by goal id.
   *
   * Server-aggregated because the client never holds a goal's full card set — the plan fetches
   * only DUE cards, capped, so a 10,000-card goal could not be counted here.
   */
  knowledge: Record<string, GoalKnowledge>
  knowledgeLoading: boolean
  insights: LearningInsights | null
  insightsLoading: boolean
  /**
   * Which goal the numbers in `insights` belong to.
   *
   * The screen lets a learner switch goals, and attributing one goal's accuracy to another
   * is worse than showing nothing — so the goal travels with the data instead of being
   * inferred from whatever the selector happens to hold when the render runs.
   */
  insightsGoalId: string | null
  /**
   * Diagnostics failures have their own channel. `planError` drives the today screen's
   * banner, so routing a diagnostics failure there would make an unrelated screen claim
   * the plan is broken.
   */
  insightsError: LearningError | null

  recommendations: RecommendationRow[]
  recommendationsLoading: boolean
  recommendationsGoalId: string | null
  recommendationBusyId: string | null

  fetchGoals: () => Promise<void>
  createGoal: (input: CreateGoalInput) => Promise<string | null>
  updateGoal: (input: UpdateGoalInput) => Promise<boolean>
  archiveGoal: (goalId: string) => Promise<boolean>
  setGoalDecks: (goalId: string, decks: GoalDeckLink[]) => Promise<boolean>

  fetchPlan: (goalId: string, planDate: string) => Promise<void>
  generatePlan: (goal: LearningGoalWithDecks, ctx: PlanContext) => Promise<boolean>
  recordAttempt: (input: AttemptInput, planDate: string) => Promise<boolean>
  fetchAttempts: (goalId: string) => Promise<void>
  requestEnrichment: (input: {
    action: RemediationAction
    goalId: string
    cardId: string
    /**
     * The attempt this request is grounded in, when the caller has one.
     *
     * Optional: an explanation of a card the learner has not attempted yet is still a
     * legitimate request. The store never derives this — a paid call must not depend on a
     * heuristic about which attempt the learner probably meant (design §5).
     */
    attemptId?: string | null
    uiLang: string
  }) => Promise<boolean>
  /** Read the wallet so the UI can state the cost BEFORE the click. */
  loadEnrichmentQuote: () => Promise<void>
  resolveEnrichment: (status: 'accepted' | 'rejected') => Promise<boolean>
  dismissEnrichment: () => void
  fetchGoalKnowledge: (goalId: string, atISO: string) => Promise<void>
  fetchInsights: (goalId: string) => Promise<void>
  fetchRecommendations: (goalId: string) => Promise<void>
  regenerateRecommendations: (goalId: string) => Promise<boolean>
  resolveRecommendation: (id: string, status: 'accepted' | 'dismissed') => Promise<boolean>
  reset: () => void
}

/**
 * Request generations for the two goal-scoped loaders.
 *
 * Kept outside the store on purpose: they are bookkeeping for in-flight work, not state any
 * view should re-render on. Comparing the generation after every await is what makes goal
 * switching correct — see `fetchInsights`.
 */
let insightsRequestSeq = 0
let recommendationsRequestSeq = 0

export const useLearningStore = create<LearningState>((set, get) => ({
  goals: [],
  goalsLoading: false,
  goalsError: null,
  plan: null,
  planItems: [],
  planCards: {},
  planTemplateFields: {},
  planLoading: false,
  planGenerating: false,
  planError: null,
  planBlockedReason: null,
  recordingItemId: null,
  attempts: [],
  attemptsLoading: false,
  enrichment: null,
  enrichmentPendingCardId: null,
  enrichmentError: null,
  enrichmentSaving: false,
  enrichmentQuote: null,
  knowledge: {},
  knowledgeLoading: false,
  insights: null,
  insightsLoading: false,
  insightsGoalId: null,
  insightsError: null,
  recommendations: [],
  recommendationsLoading: false,
  recommendationsGoalId: null,
  recommendationBusyId: null,

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
        .select('id, plan_id, position, activity_id, card_id, concept_id, activity_type, stimulus_type, response_type, evaluator_type, reason_code, priority, estimated_minutes, status, payload')
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
      let planTemplateFields: TemplateFieldOrder = {}
      if (cardIds.length > 0) {
        const { data: cardRefs, error: refErr } = await supabase
          .from('cards')
          .select('id, deck_id, template_id, field_values')
          .in('id', cardIds)
          .returns<PlanCardRef[]>()
        if (refErr) throw refErr
        planCards = Object.fromEntries((cardRefs ?? []).map((card) => [card.id, card]))

        // The templates decide which field is the prompt. Without them the row can show the
        // answer, which is the one thing that makes a plan row worthless. A failure here is
        // NOT fatal: card-prompt falls back to conventional keys, so the plan still renders.
        const templateIds = [...new Set(
          (cardRefs ?? []).map((card) => card.template_id).filter((id): id is string => !!id),
        )]
        if (templateIds.length > 0) {
          const { data: templates } = await supabase
            .from('card_templates')
            .select(TEMPLATE_COLUMNS)
            .in('id', templateIds)
            .returns<PlanTemplateRow[]>()
          planTemplateFields = Object.fromEntries((templates ?? []).map((template) => [
            template.id,
            [...(template.fields ?? [])]
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
              .map((field) => field.key)
              .filter((key): key is string => typeof key === 'string'),
          ]))
        }
      }

      set({ plan: planRow as DailyPlanRow, planItems: items, planCards, planTemplateFields })
    } catch (e) {
      set({
        planError: toLearningError(e), plan: null, planItems: [], planCards: {},
        planTemplateFields: {},
      })
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

      // A card's schedule is not always on the card row. Decks the learner OWNS carry SRS
      // embedded in `cards`; decks they SUBSCRIBED to keep the learner's own schedule in
      // `user_card_progress` while `cards` holds the PUBLISHER's (mig 009, `getSrsSource`).
      //
      // Planning read `cards` for both, so on a subscribed or official deck every memory
      // feature saw the publisher's untouched row — in production all 376,095 official cards
      // have `interval_days = 0` and `last_reviewed_at = NULL`. Every card scored identically
      // and the "personalised" plan was whatever order the rows arrived in.
      const { data: deckRows, error: deckErr } = await supabase
        .from('decks')
        .select('id, user_id, share_mode, source_owner_id')
        .in('id', deckIds)
        .returns<PlannerDeckMeta[]>()
      if (deckErr) throw deckErr
      const { embeddedDeckIds, progressDeckIds } = splitDecksBySrsSource(deckRows ?? [], userId)

      // Owned decks: the DUE filter goes in the query. A plan is today's work, and this keeps a
      // large account from turning generation into a full-table read. `next_review_at IS NULL`
      // is a new card, which the mapper scores as maximally due.
      const embeddedCards = embeddedDeckIds.length === 0 ? [] : await (async () => {
        const { data, error } = await supabase
          .from('cards')
          .select(CARD_COLUMNS)
          .in('deck_id', embeddedDeckIds)
          .or(`next_review_at.is.null,next_review_at.lte.${ctx.now}`)
          .limit(CANDIDATE_CARD_LIMIT)
          .returns<Card[]>()
        if (error) throw error
        return data ?? []
      })()

      // Subscribed decks: the due filter CANNOT be pushed into the card query, because the
      // column it would filter on belongs to the publisher. Drive from the progress table
      // instead — `idx_ucp_user_review` covers exactly this predicate — then read the cards
      // those rows point at, so the limit is spent on cards that are actually due.
      const progressCards = progressDeckIds.length === 0 ? [] : await (async () => {
        const { data: progressRows, error: progressErr } = await supabase
          .from('user_card_progress')
          .select('id, user_id, card_id, deck_id, srs_status, ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at, srs_revision, created_at, updated_at')
          .eq('user_id', userId)
          .in('deck_id', progressDeckIds)
          .or(`next_review_at.is.null,next_review_at.lte.${ctx.now}`)
          .limit(CANDIDATE_CARD_LIMIT)
          .returns<UserCardProgress[]>()
        if (progressErr) throw progressErr
        const rows = progressRows ?? []
        if (rows.length === 0) return []
        const { data: cardData, error: cardsErr } = await supabase
          .from('cards')
          .select(CARD_COLUMNS)
          .in('id', rows.map((row) => row.card_id))
          .returns<Card[]>()
        if (cardsErr) throw cardsErr
        // Re-checked in memory: a progress row can be seeded with a due date the query matched
        // on, and `attachProgressToCards` is what puts that date on the card the planner sees.
        return attachProgressToCards(cardData ?? [], rows)
          .filter((card) => isDueAt(card.next_review_at, ctx.now))
      })()

      const cards = [...embeddedCards, ...progressCards].slice(0, CANDIDATE_CARD_LIMIT)
      if (cards.length === 0) {
        set({ planBlockedReason: 'no_candidates' })
        return false
      }

      // The templates of those cards, which decide WHICH items can be answered by typing.
      //
      // Read here rather than derived from the cards: only the template author's declared
      // `front_layout` / `back_layout` can say which field is the answer, and guessing from
      // jsonb key order is inverted for every official word card (shared/lib/card-answer).
      //
      // A failure is NOT fatal and deliberately not thrown: an unreadable or missing template
      // means the plan falls back to what it has always done — a self-rating with no input box.
      // Failing plan generation because a typing affordance could not be offered would trade a
      // working feature for a missing one.
      const templateIds = [...new Set(
        cards.map((card) => card.template_id).filter((id): id is string => !!id),
      )]
      const templatesById = new Map<string, PlanTemplateRow>()
      if (templateIds.length > 0) {
        const { data: templateRows } = await supabase
          .from('card_templates')
          .select(TEMPLATE_COLUMNS)
          .in('id', templateIds)
          .returns<PlanTemplateRow[]>()
        for (const template of templateRows ?? []) templatesById.set(template.id, template)
      }

      const since = new Date(Date.parse(ctx.now) - LOG_WINDOW_DAYS * 86_400_000).toISOString()
      // `.returns` rather than a cast at the call site: the cast is what let `rating` be
      // declared `number` while the column is TEXT, which silently pinned `recentFailure` to
      // its no-evidence constant. If the columns and the interface disagree again, this line
      // is where the compiler says so.
      const { data: logRows, error: logErr } = await supabase
        .from('study_logs')
        .select('card_id, rating, review_duration_ms, studied_at')
        .in('deck_id', deckIds)
        .gte('studied_at', since)
        .order('studied_at', { ascending: false })
        .limit(LOG_ROW_LIMIT)
        .returns<CandidateStudyLog[]>()
      if (logErr) throw logErr

      const deckImportance: Record<string, number> = {}
      for (const link of goal.decks) deckImportance[link.deck_id] = link.importance

      // Accepted recommendations (mig 174) raise contentImportance, which is what makes
      // "accept" change anything. Read fresh rather than trusting whatever the insights
      // screen last loaded: the plan must reflect decisions made since.
      const { data: acceptedRows } = await supabase
        .from('study_recommendations')
        .select('card_id')
        .eq('goal_id', goal.id)
        .eq('status', 'accepted')
        .not('card_id', 'is', null)
        .limit(200)
      const acceptedCardIds = (acceptedRows ?? [])
        .map((row) => (row as { card_id: string | null }).card_id)
        .filter((id): id is string => !!id)

      const candidates = buildCandidatesFromCards({
        cards,
        recentLogs: logRows ?? [],
        deckImportance,
        now: ctx.now,
        acceptedCardIds,
      })

      // The goal's domain decides the plan shape. This call used to pass neither, so every
      // learner got `DEFAULT_MIX` regardless of what they said they were studying and the
      // adapters' `defaultPlanMix` / `supportedActivityTypes` had no production caller at all.
      //
      // Both are `undefined` for a domain this build does not ship — a goal row can name any
      // non-empty string — and `buildDailyPlan` reads that as "use the defaults", so an
      // unrecognised domain still gets a plan instead of an empty one.
      const output = buildDailyPlan({
        goal: toDomainGoal(goal, userId),
        candidates,
        budgetMinutes: goal.daily_minutes,
        // The intake throttle, read from the goal's settings. Absent means uncapped, which is
        // how every goal saved before this behaved — so an existing goal plans exactly as it
        // did until its owner chooses a number.
        newCardsPerDay: parseNewCardsPerDay(goal.settings),
        activityMix: activityMixForDomain(goal.domain_id),
        now: ctx.now,
        timezone: ctx.timezone,
        algorithmVersion: DAILY_PLANNER_VERSION,
      }, {
        supportedActivityTypes: supportedActivityTypesForDomain(goal.domain_id),
      })
      if (output.items.length === 0) {
        set({ planBlockedReason: 'no_candidates' })
        return false
      }

      const cardsById = new Map(cards.map((card) => [card.id, card]))
      // Candidates carry the recall estimate; planner output does not, because the planner does
      // not score on it (see PlannerCandidate.retrievability). Keyed on candidateId, which is
      // what the planner preserves through ranking and selection.
      const recallByCandidate = new Map(
        candidates
          .filter((candidate) => typeof candidate.retrievability === 'number')
          .map((candidate) => [candidate.candidateId, candidate.retrievability as number]),
      )
      const items = output.items.map((item) => {
        const card = item.cardId ? cardsById.get(item.cardId) : undefined
        const shape = card
          ? legacyCardItemShape(card, card.template_id ? templatesById.get(card.template_id) : null)
          : {
            activityType: item.activityType, stimulusType: 'text',
            responseType: 'self_rate', evaluatorType: 'self_rate', answerFaces: null,
          }
        // `payload` carries two independent records, and either can be absent.
        //
        // `typed_answer` records WHICH fields the plan called prompt and reference, decided
        // here and never re-derived: a template edited after today's plan was written must not
        // change what today's plan meant.
        //
        // `recall_probability` is the estimate this row was CHOSEN on, stored so the plan can
        // SHOW its reasoning instead of only asserting it. Omitted when the estimate is null —
        // a new card has no forgetting curve, and `recall_probability: null` would render as a
        // number-shaped absence rather than no claim at all.
        //
        // `daily_plan_items.payload` already exists and `save_daily_plan` already writes it
        // (mig 167), so neither record needs a migration. The key is omitted entirely when BOTH
        // are absent, so `save_daily_plan` keeps writing its `'{}'` default for every other item.
        const recall = recallByCandidate.get(item.candidateId)
        const payload = {
          ...(planItemAnswerPayload(shape) ?? {}),
          ...(recall === undefined ? {} : { recall_probability: recall }),
        }
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
          ...(Object.keys(payload).length > 0 ? { payload } : {}),
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

  /**
   * Record what happened on one plan item.
   *
   * `record_answer_attempt` (mig 167) does the whole write atomically: it inserts the
   * attempt, marks the item `completed` with its `completion_attempt_id`, and advances
   * `daily_plans.completed_items / completed_minutes / status`. So this must NOT try to
   * patch those rows itself — it calls the RPC and re-reads.
   *
   * Two server contracts shape the arguments:
   *   * the attempt must match the plan item's SNAPSHOT exactly (goal, activity, card, and
   *     all three type fields) or the RPC raises P0007. We therefore send the values from
   *     the stored item rather than re-deriving them, because a re-derivation that drifts
   *     would fail at write time instead of at review time;
   *   * `client_attempt_id` makes it idempotent — replaying the same id returns the first
   *     result, while reusing it with a DIFFERENT payload is a caller bug and raises P0007.
   *     The caller therefore owns the id for the lifetime of one attempt.
   */
  recordAttempt: async (input, planDate) => {
    if (get().recordingItemId) return false
    const item = input.planItem
    set({ recordingItemId: item.id, planError: null })
    try {
      const score = Math.min(1, Math.max(0, input.score))
      // The typed answer, if this item asks for one.
      //
      // Gated on the ITEM's snapshot, not on whether the caller passed text: `response_type`
      // is what the row claims to hold, and storing prose under a `self_rate` item would make
      // that claim false. Trimmed and capped because `record_answer_attempt` rejects a response
      // over 64 KiB with the same error code as the plan-save cap — a limit the learner would
      // meet as an unrelated message about rebuilding plans.
      const typed = item.response_type === 'text'
      const text = typed
        ? (input.text ?? '').trim().slice(0, TYPED_ANSWER_MAX_CHARS)
        : ''
      // Built BEFORE the call and never re-derived: `p_response` is part of the RPC's
      // idempotency comparison, so the same `clientAttemptId` with a different response raises
      // P0007. An empty answer stays `{ self_rated }` — the exact shape every existing attempt
      // has — rather than `{ self_rated, text: '' }`, so "typed nothing" and "was never asked"
      // read the same downstream, and no later feature can mistake an empty string for an answer.
      const response: Record<string, unknown> = text === ''
        ? { self_rated: score }
        : { self_rated: score, text }
      const { error } = await supabase.rpc('record_answer_attempt', {
        p_client_attempt_id: input.clientAttemptId,
        p_activity_type: item.activity_type,
        p_response_type: item.response_type,
        p_evaluator_type: item.evaluator_type,
        p_response: response,
        p_goal_id: input.goalId,
        p_activity_id: item.activity_id,
        p_card_id: item.card_id,
        p_plan_item_id: item.id,
        p_normalized_score: score,
        p_evaluator_result: { evaluator: 'self_rate', score },
        p_duration_ms: input.durationMs ?? 0,
        p_evaluator_version: 'self-rate-v1',
      })
      if (error) throw error
      // Re-read: the server owns the item status and the plan aggregates.
      await get().fetchPlan(input.goalId, planDate)
      return true
    } catch (e) {
      set({ planError: toLearningError(e) })
      return false
    } finally {
      set({ recordingItemId: null })
    }
  },

  /** Recent attempts for a goal — the review surface. Owner-scoped by RLS. */
  fetchAttempts: async (goalId) => {
    set({ attemptsLoading: true })
    try {
      const { data, error } = await supabase
        .from('answer_attempts')
        // `response` and `response_type` are read back so the history row can show the learner
        // exactly what was stored — the honesty check for typed answers, and the only way a
        // later feature can tell an attempt that HAS an answer from one that does not.
        .select('id, goal_id, card_id, activity_id, plan_item_id, activity_type, response_type, evaluator_type, response, normalized_score, duration_ms, created_at')
        .eq('goal_id', goalId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      set({ attempts: (data ?? []) as AttemptRow[] })
    } catch (e) {
      set({ planError: toLearningError(e) })
    } finally {
      set({ attemptsLoading: false })
    }
  },

  /**
   * Ask the server for a remediation on one card, and hold the result as a preview.
   *
   * This SPENDS MONEY. `ai-generate` reserves against the wallet before calling the model
   * and charges the real token cost after (mig 168), so the caller must only reach here on
   * an explicit user action — and the UI has to say it costs credits BEFORE the click, not
   * after the charge.
   *
   * The server persists the result as `user_enrichments.status = 'preview'` and returns its
   * id; accepting or rejecting is a separate decision (`resolveEnrichment`). Rejecting is
   * NOT a refund — the generation already happened.
   */
  requestEnrichment: async (input) => {
    if (get().enrichmentPendingCardId) return false
    set({ enrichmentPendingCardId: input.cardId, enrichmentError: null, enrichment: null })
    try {
      const result = await callServerAI({
        kind: 'remediation',
        action: input.action,
        uiLang: input.uiLang,
        goalId: input.goalId,
        cardIds: [input.cardId],
        // Omitted entirely when absent: the edge function rejects a malformed uuid, and
        // sending `null` for "no attempt" would be a different request shape than the one
        // `parseRemediationRefs` treats as "not supplied".
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      })
      // No enrichment id means the server could not persist the preview, so there is
      // nothing to accept later. Surfacing it as an error beats showing content that
      // silently cannot be kept.
      if (!result.enrichmentId) {
        set({ enrichmentError: 'UNKNOWN' })
        return false
      }
      const rawSources = (result.content as { sources?: unknown }).sources
      set({
        enrichment: {
          enrichmentId: result.enrichmentId,
          action: input.action,
          content: result.content,
          sources: Array.isArray(rawSources) ? rawSources as EnrichmentSource[] : [],
          balance: typeof result.balance === 'number' ? result.balance : null,
        },
      })
      return true
    } catch (e) {
      set({ enrichmentError: toEnrichmentError(e) })
      return false
    } finally {
      set({ enrichmentPendingCardId: null })
    }
  },

  /**
   * Read the price of one remediation before offering it.
   *
   * Fails SILENTLY into `null`: a wallet read that times out must not stop a learner with
   * credits from asking a question, and the alternative — rendering 0 — would understate a
   * real charge. The server remains authoritative and rejects an empty wallet with
   * `AI_INSUFFICIENT_CREDITS`, which already has its own message.
   */
  loadEnrichmentQuote: async () => {
    const wallet = await getAiWallet()
    set({
      enrichmentQuote: wallet
        ? { estPriceMicro: wallet.estPricePerCardMicro, balanceMicro: wallet.balanceMicroWon }
        : null,
    })
  },

  /**
   * Keep or discard the open preview.
   *
   * `set_user_enrichment_status` only allows a transition OUT OF 'preview' (P0007
   * otherwise) — the closed statuses are terminal. So a double-click on Accept is a
   * server-side conflict, not a silent second write, and the store closes the preview on
   * success either way.
   */
  resolveEnrichment: async (status) => {
    const current = get().enrichment
    if (!current || get().enrichmentSaving) return false
    set({ enrichmentSaving: true, enrichmentError: null })
    try {
      const { error } = await supabase.rpc('set_user_enrichment_status', {
        p_enrichment_id: current.enrichmentId,
        p_status: status,
      })
      if (error) throw error
      set({ enrichment: null })
      return true
    } catch (e) {
      const code = (e as { code?: string }).code
      // P0007 means it was already finalized — the user's intent is satisfied, so close
      // the preview instead of trapping them behind an error they cannot clear.
      if (code === 'P0007') {
        set({ enrichment: null })
        return true
      }
      set({ enrichmentError: 'UNKNOWN' })
      return false
    } finally {
      set({ enrichmentSaving: false })
    }
  },

  /**
   * Load the diagnostics window for a goal: attempts and plans, aggregated by a pure
   * function so the arithmetic is testable without a database.
   *
   * Windows differ on purpose. Attempts look back 30 days because accuracy needs volume;
   * plans look back 14 because adherence is a habit question and a three-week-old miss says
   * nothing about this week.
   */
  /**
   * How much of this goal the learner would still know at `atISO`.
   *
   * The retention rule lives in the kernel, not in SQL: `retentionStabilityMultiplier` collapses
   * the whole forgetting curve into one scalar the database can compare dates with. Changing the
   * criterion therefore changes this number too, with no migration.
   *
   * Failures are swallowed into a null entry rather than surfaced as a page error — progress is
   * a header on a screen whose real job is serving today's cards, and a summary that cannot load
   * must not take the plan down with it.
   */
  fetchGoalKnowledge: async (goalId, atISO) => {
    set({ knowledgeLoading: true })
    try {
      const { data, error } = await supabase.rpc('get_goal_knowledge', {
        p_goal_id: goalId,
        p_at: atISO,
        p_stability_multiplier: retentionStabilityMultiplier(),
      })
      if (error) throw error
      const row = (data ?? {}) as Partial<GoalKnowledge>
      set((state) => ({
        knowledge: {
          ...state.knowledge,
          [goalId]: {
            total: Number(row.total ?? 0),
            unseen: Number(row.unseen ?? 0),
            known: Number(row.known ?? 0),
            unknown: Number(row.unknown ?? 0),
          },
        },
      }))
    } catch (e) {
      console.error('[learning-store] get_goal_knowledge failed:', e)
    } finally {
      set({ knowledgeLoading: false })
    }
  },

  fetchInsights: async (goalId) => {
    // Latest-wins, NOT first-wins. A busy-flag early return would drop the goal the learner
    // just selected and leave the previous goal's numbers under the new goal's label; a
    // plain overwrite would let a slow earlier response land last and do the same thing.
    const seq = ++insightsRequestSeq
    set({ insightsLoading: true, insightsError: null })
    try {
      const now = Date.now()
      const attemptsSince = new Date(now - 30 * 86_400_000).toISOString()
      const plansSince = new Date(now - 14 * 86_400_000).toISOString().slice(0, 10)

      const [attemptsResult, plansResult] = await Promise.all([
        supabase
          .from('answer_attempts')
          .select('card_id, normalized_score, duration_ms, created_at')
          .eq('goal_id', goalId)
          .gte('created_at', attemptsSince)
          .order('created_at', { ascending: false })
          .limit(2000)
          .returns<InsightAttempt[]>(),
        supabase
          .from('daily_plans')
          .select('plan_date, total_items, completed_items')
          .eq('goal_id', goalId)
          .gte('plan_date', plansSince)
          .returns<InsightPlan[]>(),
      ])
      if (seq !== insightsRequestSeq) return
      if (attemptsResult.error) throw attemptsResult.error
      if (plansResult.error) throw plansResult.error

      set({
        insights: summarizeLearning({
          attempts: attemptsResult.data ?? [],
          plans: plansResult.data ?? [],
        }),
        insightsGoalId: goalId,
      })
    } catch (e) {
      if (seq !== insightsRequestSeq) return
      set({ insightsError: toLearningError(e), insights: null, insightsGoalId: goalId })
    } finally {
      if (seq === insightsRequestSeq) set({ insightsLoading: false })
    }
  },

  /** Recommendations for a goal, newest first. Owner-scoped by RLS. */
  fetchRecommendations: async (goalId) => {
    const seq = ++recommendationsRequestSeq
    set({ recommendationsLoading: true })
    try {
      const { data, error } = await supabase
        .from('study_recommendations')
        .select('id, goal_id, card_id, concept_id, activity_id, action_type, provider, reason, algorithm_version, status, created_at')
        .eq('goal_id', goalId)
        .order('created_at', { ascending: false })
        .limit(50)
        .returns<RecommendationRow[]>()
      if (seq !== recommendationsRequestSeq) return
      if (error) throw error
      set({ recommendations: data ?? [], recommendationsGoalId: goalId })
    } catch (e) {
      if (seq !== recommendationsRequestSeq) return
      set({ insightsError: toLearningError(e) })
    } finally {
      if (seq === recommendationsRequestSeq) set({ recommendationsLoading: false })
    }
  },

  /**
   * Produce the current suggestion set for a goal from the diagnostics window.
   *
   * The producer is deliberately DETERMINISTIC and versioned (`weak-card-v1`), like the
   * daily planner: the same attempt history yields the same suggestions, and the version
   * is stored on every row so the quality of one producer can be compared with another's
   * later (design §11.5). Nothing here calls the model — an AI producer can write the same
   * table under a different `provider` without a schema change.
   *
   * `set_study_recommendations` replaces only the PENDING rows, so a regeneration cannot
   * erase what the learner already accepted or dismissed. That is enforced server-side; the
   * client is free to re-send its full current set.
   */
  regenerateRecommendations: async (goalId) => {
    const insights = get().insights
    if (!insights) {
      // Diagnostics are the input. Producing from nothing would emit an empty set and wipe
      // the current pending suggestions for no reason.
      return false
    }
    set({ planError: null })
    try {
      const items = insights.weakCards.map((card) => ({
        card_id: card.cardId,
        action_type: 'review_card',
        // The evidence travels with the suggestion, so the UI can say WHY without
        // recomputing it and a stored row stays explainable months later.
        reason: `mean ${Math.round(card.meanScore * 100)}% over ${card.attempts} attempts`,
        payload: { mean_score: card.meanScore, attempts: card.attempts },
      }))
      const { error } = await supabase.rpc('set_study_recommendations', {
        p_goal_id: goalId,
        p_items: items,
        p_provider: 'algorithm',
        p_algorithm_version: WEAK_CARD_RECOMMENDER_VERSION,
      })
      if (error) throw error
      await get().fetchRecommendations(goalId)
      return true
    } catch (e) {
      set({ planError: toLearningError(e) })
      return false
    }
  },

  /**
   * Accept or dismiss one suggestion.
   *
   * Accepting is not decoration: `generatePlan` reads accepted card ids and raises their
   * `contentImportance`, so the decision changes tomorrow's plan. Dismissing keeps the
   * suggestion from being re-proposed, because the server preserves non-pending rows.
   *
   * Both states are terminal server-side (P0007 on a second transition). That is not an
   * error the learner can act on — the decision is already recorded — but it is also NOT a
   * licence to claim the status THIS tab asked for: the row may have been accepted elsewhere
   * while this one asked to dismiss it. So P0007 re-reads the goal's rows and adopts the
   * server's truth instead of rendering a state the server does not hold.
   */
  resolveRecommendation: async (id, status) => {
    if (get().recommendationBusyId) return false
    const target = get().recommendations.find((rec) => rec.id === id)
    set({ recommendationBusyId: id, insightsError: null })
    try {
      const { error } = await supabase.rpc('set_study_recommendation_status', {
        p_recommendation_id: id,
        p_status: status,
      })
      const alreadyDecided = !!error && (error as { code?: string }).code === 'P0007'
      if (error && !alreadyDecided) throw error

      if (alreadyDecided) {
        set({ recommendationBusyId: null })
        // Re-read only when the row tells us which goal to re-read. A suggestion with no
        // goal cannot be refetched, so the safer move is to leave the list untouched rather
        // than assert a status the server may not hold.
        if (target?.goal_id) await get().fetchRecommendations(target.goal_id)
        return true
      }

      set({
        recommendations: get().recommendations.map((rec) =>
          rec.id === id ? { ...rec, status } : rec),
      })
      return true
    } catch (e) {
      set({ insightsError: toLearningError(e) })
      return false
    } finally {
      set({ recommendationBusyId: null })
    }
  },

  /** Close the preview without deciding. It stays 'preview' server-side and can be
   *  resolved later; the money is spent either way. */
  dismissEnrichment: () => set({ enrichment: null, enrichmentError: null }),

  reset: () => {
    // Bump both generations so any response still in flight is recognised as superseded and
    // cannot repopulate the store after a logout.
    insightsRequestSeq++
    recommendationsRequestSeq++
    set({
      goals: [], goalsLoading: false, goalsError: null,
      plan: null, planItems: [], planCards: {}, planTemplateFields: {},
      planLoading: false, planGenerating: false,
      planError: null, planBlockedReason: null,
      recordingItemId: null, attempts: [], attemptsLoading: false,
      enrichment: null, enrichmentPendingCardId: null, enrichmentError: null,
      enrichmentSaving: false, enrichmentQuote: null,
      insights: null, insightsLoading: false, insightsGoalId: null, insightsError: null,
      recommendations: [], recommendationsLoading: false, recommendationsGoalId: null,
      recommendationBusyId: null,
    })
  },
}))
