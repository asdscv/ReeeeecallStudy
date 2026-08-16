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
import {
  planCoach,
  type CoachSuggestion, type PlanDigest, type PlanLever,
} from '../learning/application/plan-coach'
import { planWeek as derivePlanWeek, type PlanWeek, type WeekDigest } from '../learning/application/plan-week'
import type { TemplateFieldOrder } from '../lib/card-prompt'
import { supabase } from '../lib/supabase'
import { callServerAI } from '../lib/ai/server-client'
import {
  buildCandidatesFromCards, legacyCardItemShape, planItemAnswerPayload, RECALL_MINUTES,
  TYPED_ANSWER_MAX_CHARS, type CandidateStudyLog,
} from '../lib/learning-candidates'
import {
  summarizeLearning, type InsightAttempt, type InsightPlan, type LearningInsights,
} from '../lib/learning-insights'
import {
  splitDecksBySrsSource, attachProgressToCards, isDueAt, type PlannerDeckMeta,
} from '../lib/learning-card-sources'
import type { UserCardProgress } from '../lib/srs-access'
import {
  buildDailyPlan, DAILY_PLANNER_VERSION, retentionStabilityMultiplier, reviewsAddedTomorrow,
  parseNewCardsPerDay, DEFAULT_NEW_CARDS_PER_DAY, parseCadence, type StudyCadence,
} from '../learning/application/index'
import { activityMixForDomain, supportedActivityTypesForDomain } from '../learning/adapters/index'
import type { LearningGoal } from '../learning/domain/index'
import type { Card, LayoutItem, TemplateField } from '../types/database'
import { fetchAllRows } from '../lib/fetch-all-rows'

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
   *
   * `is_new` is whether the planner counted this row as INTAKE. Recorded because it cannot be
   * re-derived from the row: a card mid-learning-step has no forgetting curve either, so
   * "no recall estimate" does NOT mean "never studied". Absent on plans saved before this
   * existed, which is why readers fall back rather than assume.
   */
  payload?: { recall_probability?: number; is_new?: boolean } | null
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
 * How many candidates one plan actually needs, derived from the budget rather than fixed.
 *
 * The old form was a flat 500, and it was wrong in both directions at once. Its own comment
 * reasoned that "a 1440-minute budget cannot use more than ~2880" and then capped at 500 — which
 * is 250 minutes at RECALL_MINUTES, so a learner studying four hours a day could not fill their
 * plan. Meanwhile a learner doing twenty minutes downloaded 500 rows to use forty.
 *
 * Worse, the query had no ORDER BY, so WHICH 500 was undefined. On a goal spanning two decks the
 * first one physically stored could supply all 500 and the second contribute nothing — silently,
 * with no way for the learner to tell that half their goal was missing from the plan.
 *
 * A day's plan cannot hold more items than the budget pays for, so that is the bound. The
 * `+ 1` is slack for a rounding edge, not a safety factor: the ordering below means anything
 * beyond the budget is strictly less urgent than what was already taken.
 */
/**
 * Take `limit` cards, one deck at a time, so every deck in a goal advances.
 *
 * A goal that mixes a 1,000-card deck with a 200-card one should introduce cards from both.
 * Taking them in storage order gives the whole day's intake to whichever deck happens to sort
 * first, and the learner sees a goal that only ever studies half of itself — with nothing on
 * screen to say why.
 *
 * Order within a deck is preserved, so the caller's `sort_position` ordering still decides which
 * card of a deck comes next.
 */
function roundRobinByDeck(cards: readonly Card[], limit: number): Card[] {
  const byDeck = new Map<string, Card[]>()
  for (const card of cards) {
    const bucket = byDeck.get(card.deck_id)
    if (bucket) bucket.push(card)
    else byDeck.set(card.deck_id, [card])
  }
  const queues = [...byDeck.values()]
  const out: Card[] = []
  let index = 0
  while (out.length < limit && queues.some((queue) => queue.length > index)) {
    for (const queue of queues) {
      if (out.length >= limit) break
      if (queue.length > index) out.push(queue[index])
    }
    index += 1
  }
  return out
}

function candidateFetchLimit(budgetMinutes: number): number {
  const items = Math.ceil(Math.max(0, budgetMinutes) / RECALL_MINUTES) + 1
  // A goal whose budget is somehow unusable still asks for one card rather than zero, so the
  // "no candidates" state means "nothing is due", never "the arithmetic collapsed".
  return Math.max(1, Math.min(items, 5000))
}

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

/**
 * The remediation actions this app offers.
 *
 * A strict subset of the protocol vocabulary, and deliberately the same subset the server
 * actually serves (`SERVED_REMEDIATION_ACTIONS` in supabase/functions/_shared/ai-remediation.ts).
 * Sending anything else is refused before the wallet is touched, so a wider union here would
 * only let a screen offer a button that always fails.
 */
export type RemediationAction = 'explain' | 'hint' | 'compare'

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
  /**
   * The residual `total - unseen - known`, NOT a measurement.
   *
   * `known` requires `interval_days > 0`, so every card sitting in a 1- or 10-minute learning
   * step falls in here — which is why nothing on a screen may call this "밀림". A card the
   * learner answered ninety seconds ago is in this bucket by construction.
   */
  readonly unknown: number
  /**
   * Reviews owed right now: studied, and `next_review_at <= now`. The real "today's work".
   */
  readonly dueNow: number
  /**
   * Late by MORE THAN A DAY. Migration 191 separated this from `dueNow` in so many words —
   * "so 'behind' is a fact with a size" — and then no client read it, so the screen said
   * 밀렸어요 from `unknown` instead and told learners they were behind on cards they had just
   * finished. This is the only number that may be called 밀림.
   */
  readonly overdue: number
  /**
   * Retained rather than being learned: interval >= 21 days (mig 192).
   *
   * Deliberately NOT filtered on whether the card is currently due — a mature card one day
   * overdue has not stopped being mature, and tying completion to punctuality would let a
   * finished goal un-finish itself overnight.
   */
  readonly mature: number
  /** Studied, interval 0-2. Twelve days of waiting from mature. */
  readonly rung1: number
  /** interval 3-7. Eleven days. */
  readonly rung3: number
  /** interval 8-20. Its next review is the one that matures it. */
  readonly rung8: number
  /**
   * The soonest review still AHEAD, ISO, or null when nothing is scheduled at all (mig 211).
   *
   * The difference between "you are done for now" and "this goal has nothing left in it", and
   * the screen could not tell them apart: it printed 「오늘 이 덱들에서 복습할 카드가 없습니다」
   * to a learner whose twelve cards were coming back in ten minutes.
   */
  readonly nextDueAt: string | null
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
  /**
   * Producer-defined. For a plan-level suggestion this carries the already-clamped value and
   * the evidence that produced it, so accepting one does not re-derive a number the chooser
   * has already reasoned about.
   */
  payload: Record<string, unknown> | null
}

/** The deterministic producer's version, recorded on every row it writes. */
export const WEAK_CARD_RECOMMENDER_VERSION = 'weak-card-v1'

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
  /**
   * Goal-scoped settings, stored as-is in `learning_goals.settings`.
   *
   * The study rhythm and the daily intake limit live here rather than in columns of their own:
   * the jsonb column has existed since mig 165, both RPCs already accept it, and neither value
   * is ever queried on — they are read back with the goal and handed to the planner. A column
   * would buy nothing and cost a migration.
   */
  settings?: Record<string, unknown>
}

/**
 * Which setting each lever turns. Mirrors `learning_plan_levers.dial` (mig 206) — the levers
 * that map to nothing are encouragement, not configuration, and accepting one changes only
 * the recommendation's status.
 */
const PLAN_LEVER_DIAL: Partial<Record<PlanLever, 'daily_minutes' | 'new_cards_per_day'>> = {
  lower_intake: 'new_cards_per_day',
  raise_intake: 'new_cards_per_day',
  shorten_session: 'daily_minutes',
}

/** Stored on every row, so one producer's quality can be compared with another's later. */
const PLAN_COACH_VERSION = 'plan-coach-v1'

export interface UpdateGoalInput {
  goalId: string
  title?: string
  dailyMinutes?: number
  targetDate?: string | null
  /** See CreateGoalInput.settings. Omitted leaves the stored value untouched. */
  settings?: Record<string, unknown>
  status?: 'active' | 'paused' | 'completed'
  decks?: GoalDeckLink[]
}

interface LearningState {
  goals: LearningGoalWithDecks[]
  goalsLoading: boolean
  goalsError: LearningError | null

  /**
   * Archived goals, or `null` when the archive has never been opened.
   *
   * `null` and `[]` are different answers and the screens rely on it: `null` means "not asked
   * yet", `[]` means "asked, and there are none". An empty array on first render would let the
   * drawer claim the archive is empty before anything had read it.
   */
  archivedGoals: LearningGoalWithDecks[] | null
  archivedGoalsLoading: boolean

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
  /**
   * WHICH action produced `planError`.
   *
   * Six actions used to write that one field and the screen rendered every one of them as
   * "플랜을 만들지 못했습니다. 다시 시도해 주세요." A learner photographed that sentence sitting
   * directly above a plan of 29 items that had just been extended successfully — the plan had
   * been built, something else had failed, and the banner named the one thing that had not
   * gone wrong.
   *
   * Actions that are not ABOUT the plan no longer write here at all (see `fetchAttempts` and
   * `regeneratePlanCoach`). The ones that remain say which they were, so the sentence can be
   * true.
   */
  planErrorFrom: 'read' | 'generate' | 'extend' | 'record' | null
  /** A failed history read. Its own field so it cannot be mistaken for a failed plan. */
  attemptsError: LearningError | null
  /**
   * The last paid explanation the learner asked for, and which attempt it was about.
   *
   * Keyed by attempt so a second card's explanation cannot appear under the first card's
   * heading — the failure mode every other goal-scoped read on this screen has a guard for.
   */
  remediation: {
    attemptId: string
    action: RemediationAction
    summary: string
    blocks: Array<{ type: string; content: unknown }>
    warnings: string[]
  } | null
  /**
   * Explanations this learner has ALREADY PAID FOR, by attempt id.
   *
   * `remediation` is what is on screen; this is what has been bought. They were the same field
   * once, and that is how 닫기 — a button that says "close" — destroyed an artifact the learner
   * had been charged for, leaving the paid button as the only way back to it. Every press of
   * that button was a second charge for a re-worded answer to an identical question.
   *
   * Filled from the wallet-free read of `user_enrichments` as well as from a purchase, so a
   * reload restores it too.
   */
  remediationOwned: Record<string, {
    attemptId: string
    action: RemediationAction
    summary: string
    blocks: Array<{ type: string; content: unknown }>
    warnings: string[]
  }>
  /** The attempt a paid request is in flight for, so only that row shows a spinner. */
  remediationBusyAttemptId: string | null
  /**
   * The server's OWN code, verbatim — `AI_INSUFFICIENT_CREDITS`, `AI_RATE_CAP`,
   * `COMPARE_UNGROUNDED:…`, `NETWORK_ERROR`.
   *
   * Not a `LearningError`: that maps Postgres SQLSTATEs, and `callServerAI` throws
   * `new Error(code)` where the code is the edge function's, so routing it through the SQL
   * mapper would turn every distinct AI failure into `UNKNOWN` — including the one the learner
   * can act on, which is having no credits.
   */
  remediationError: { code: string } | null
  /** A coach that could not be produced. Never shown; kept so a failure is not swallowed. */
  coachError: LearningError | null
  /**
   * The last seven days, as the strip renders them, for the goal named by `planWeekGoalId`.
   *
   * Kept because the coach's own fetch already pays for it: `regeneratePlanCoach` reads the
   * digest to DECIDE, and used to throw it away. The screen showing the week and the coach
   * judging the week must never be able to disagree about which week it was, so they come
   * from one round trip.
   */
  planWeek: PlanWeek | null
  /** Which goal `planWeek` describes — the same guard `insightsGoalId` exists for. */
  planWeekGoalId: string | null
  /**
   * `goalId|planDate` for which a read COMPLETED and found no plan. Null otherwise.
   *
   * A positive fact, because `plan === null` is three different situations wearing one face:
   * "not fetched yet" (the initial state), "the fetch failed" (the catch below), and "there
   * genuinely is no plan today". Auto-generation may only act on the third. Acting on the first
   * would write a plan before knowing whether one exists; acting on the second would overwrite a
   * real plan whenever the network hiccuped — and `save_daily_plan` deletes every item and zeroes
   * the day's progress, so that mistake is not recoverable by retrying.
   */
  planAbsentFor: string | null
  /** True while an append is in flight. Separate from `planGenerating`: the two writes are
   *  different actions with different buttons, and one spinner for both would disable the
   *  wrong control. */
  planExtending: boolean
  /**
   * The result of the last "더 하기", or null.
   *
   * Kept so the consequence can be STATED rather than implied. Starting new cards is the one
   * plan decision with a cost the learner cannot see today — every card started now comes back
   * tomorrow — and a button that silently grows tomorrow's list is how a learner ends up
   * abandoning a goal they were doing well at.
   */
  planExtension: {
    appended: number
    newCards: number
    reviewsTomorrow: number
    /**
     * The block was pulled FORWARD — nothing was owed, so cards whose turn had not come yet
     * were taken instead.
     *
     * 더 하기 means "I want to do more than today's share", and answering it with "nothing is
     * due" told a learner their goal was exhausted while twenty-three cards sat in the deck
     * waiting. Studying early is a real choice with a real cost, so it is offered and then
     * said out loud rather than done silently.
     */
    aheadOfSchedule: boolean
  } | null
  /**
   * Goal+date keys already attempted automatically, so a failure is never retried in a loop.
   *
   * `save_daily_plan` is capped at 50 writes per USER per UTC day across every goal, and the
   * client cannot read how many are left. One automatic attempt per goal per day is the budget
   * this can safely spend without the learner's own regenerations starting to fail.
   */
  autoPlanAttempted: Record<string, true>
  /** Set when the goal has no decks attached: there is nothing to plan over. */
  planBlockedReason: 'no_decks' | 'no_candidates' | null

  /** Plan-item id currently being recorded, so one row can show progress alone. */
  recordingItemId: string | null
  attempts: AttemptRow[]
  attemptsLoading: boolean

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
   * Deck id per weak card, so the "다시 볼 카드" button can start a session.
   *
   * A study session takes ONE deck (`finalize_study_session` refuses events spanning decks),
   * and `summarizeLearning` works from attempt rows which carry no deck. Empty when there are
   * no weak cards, or when the diagnostics read failed.
   */
  weakCardDecks: Record<string, string>
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
  fetchArchivedGoals: () => Promise<void>
  /**
   * Move an archived goal back to `active`, with its plans and history intact.
   *
   * The counterpart `archiveGoal` never had. Without it, archiving was a one-way trip into a
   * list nothing rendered — strictly worse than deleting, because the rows stayed and the
   * learner could neither see nor recover them.
   */
  restoreGoal: (goalId: string) => Promise<boolean>
  /**
   * Permanently remove a goal, its deck links and every plan it produced.
   *
   * Distinct from `archiveGoal`, which is a status flip that keeps all of it. The answer
   * attempts survive with `goal_id` NULL — they are the record of study that genuinely
   * happened, and the card's SRS state rests on them.
   */
  deleteGoal: (goalId: string) => Promise<boolean>
  setGoalDecks: (goalId: string, decks: GoalDeckLink[]) => Promise<boolean>

  fetchPlan: (goalId: string, planDate: string) => Promise<void>
  generatePlan: (goal: LearningGoalWithDecks, ctx: PlanContext) => Promise<boolean>
  /**
   * Build today's plan if — and only if — the server has said there is not one.
   *
   * Both screens call this on open instead of showing a button. It is a separate action rather
   * than a flag on `generatePlan` because the decision has four conditions and all four are
   * about state the store owns; putting them in a component would mean two copies that drift,
   * and the cost of one drifting is a wiped day.
   */
  autoGeneratePlan: (goal: LearningGoalWithDecks, ctx: PlanContext) => Promise<void>
  /**
   * "더 하기" — add one more block of work to today's plan, keeping everything already done.
   *
   * A separate action from `generatePlan` because it is a separate operation on the server:
   * `save_daily_plan` deletes the day and rewrites it, `append_daily_plan_items` (mig 185)
   * only inserts. Routing "I want more" through the destructive one is what made this
   * impossible before — a learner who had done half the plan would have lost the half.
   */
  extendPlan: (goal: LearningGoalWithDecks, ctx: PlanContext) => Promise<boolean>
  /**
   * Build today out of cards whose turn has not come, on explicit request.
   *
   * The answer to "매일 공부하고 싶은데 오늘 아무것도 안 뜬다". Unbounded, unlike the automatic
   * top-up in {@link generatePlan}, because a press is a decision.
   */
  generateAheadPlan: (goal: LearningGoalWithDecks, ctx: PlanContext) => Promise<boolean>
  recordAttempt: (input: AttemptInput, planDate: string) => Promise<boolean>
  fetchAttempts: (goalId: string) => Promise<void>
  fetchGoalKnowledge: (goalId: string, atISO: string) => Promise<void>
  /** Stamp the goal completed if it has earned it. Returns whether this call changed it. */
  completeGoalIfEarned: (goalId: string) => Promise<boolean>
  fetchInsights: (goalId: string) => Promise<void>
  fetchRecommendations: (goalId: string) => Promise<void>
  regenerateRecommendations: (goalId: string) => Promise<boolean>
  resolveRecommendation: (id: string, status: 'accepted' | 'dismissed') => Promise<boolean>

  /**
   * Produce this week's plan suggestion, if there is one worth making.
   *
   * Deterministic and versioned, exactly like the weak-card producer beside it, and written
   * through the same `set_study_recommendations` — so when a model takes over the choosing
   * it writes the same rows under a different `provider` and nothing else moves.
   */
  regeneratePlanCoach: (goalId: string, timezone: string) => Promise<boolean>
  /**
   * Apply an accepted plan suggestion.
   *
   * The NUMBER comes from the stored row, not from the screen: the chooser already clamped
   * it to the range `update_learning_goal` accepts, and re-deriving it in the UI would be a
   * second implementation free to disagree.
   */
  applyPlanCoach: (recommendationId: string) => Promise<boolean>
  /**
   * Ask the server for a paid explanation of ONE attempt.
   *
   * The whole server half of this has been deployed the entire time — the edge function's
   * `kind: 'remediation'` branch reserves against the wallet, loads the grounding, builds the
   * prompt, validates the result, persists it and releases the hold on failure. There has never
   * been a caller. `packages/shared/lib/learning-attempt-selection.ts` even holds the rule for
   * WHICH attempt may be sent, written as a pure function so both platforms pick the same one.
   *
   * `attemptId` is passed in, never guessed here: a paid call must be grounded in an attempt a
   * screen deliberately chose, and a store that picks one on the caller's behalf is how a
   * learner ends up paying for an explanation of something they did not ask about.
   */
  requestRemediation: (input: {
    action: RemediationAction
    goalId: string
    attemptId: string
    cardId: string | null
    uiLang: string
  }) => Promise<boolean>
  /**
   * Fetch an explanation this learner has already bought for `attemptId`. Free.
   *
   * Reads `user_enrichments` directly — the table has had an owner-read RLS policy and a
   * SELECT grant to `authenticated` since it was created, and nothing in either app had ever
   * used them, so every paid answer became unreachable the moment it left memory.
   *
   * Populates `remediationOwned` only. Whether to SHOW it is the screen's decision.
   */
  loadRemediation: (input: { attemptId: string; action: RemediationAction }) => Promise<boolean>
  /**
   * Put a bought explanation back on screen. No network, no charge.
   *
   * Returns false when nothing is owned for that attempt, so a caller cannot mistake "nothing
   * to show" for "shown".
   */
  showOwnedRemediation: (attemptId: string) => boolean
  /** Drop the explanation on screen. Not a refund, and no longer a loss — it stays in
   *  `remediationOwned` and can be reopened for free. */
  dismissRemediation: () => void

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

/**
 * Turn planner output into the row shape `save_daily_plan` / `append_daily_plan_items` accept.
 *
 * Shared by both writers. The mapping is where a plan stops being a ranking and becomes a
 * record: it freezes which template fields were the prompt and the answer, and the recall
 * estimate the row was chosen on. Two copies of that would eventually freeze two different
 * things for the same card on the same day.
 */
function toPlanItemRows(
  output: ReturnType<typeof buildDailyPlan>,
  cards: readonly Card[],
  templatesById: Map<string, PlanTemplateRow>,
  candidates: ReturnType<typeof buildCandidatesFromCards>,
) {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  // Candidates carry the recall estimate; planner output does not, because the planner does
  // not score on it (see PlannerCandidate.retrievability). Keyed on candidateId, which is
  // what the planner preserves through ranking and selection.
  const recallByCandidate = new Map(
    candidates
      .filter((candidate) => typeof candidate.retrievability === 'number')
      .map((candidate) => [candidate.candidateId, candidate.retrievability as number]),
  )
  // Whether the planner treated this row as INTAKE, recorded rather than re-derived.
  //
  // The screens used to infer it from `recall_probability` being absent, which is wrong for
  // exactly the cards a learner is working hardest on: a card mid-learning-step has no
  // forgetting curve yet, so it carried no estimate and got labelled "새 카드" hours after
  // being studied. The planner's own test is `!card.last_reviewed_at` (learning-candidates.ts),
  // it spends intake and review budget on the two separately, and it is the only place that
  // knows. So it says so here instead of leaving the UI to guess.
  const isNewByCandidate = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate.isNew === true]),
  )
  return output.items.map((item) => {
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
    const isNew = isNewByCandidate.get(item.candidateId)
    const payload = {
      ...(planItemAnswerPayload(shape) ?? {}),
      ...(recall === undefined ? {} : { recall_probability: recall }),
      ...(isNew === undefined ? {} : { is_new: isNew }),
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
}

/**
 * How much work one press of "더 하기" adds, in minutes.
 *
 * Ten, not "another day's worth". The learner is already past the amount they said they
 * wanted, so each press should be small enough to stop after — a 60-minute goal that doubles
 * on one tap is a decision the learner did not get to make twice.
 */
const EXTRA_BLOCK_MINUTES = 10

/**
 * How much one press adds when there is nothing owed and cards have to be pulled FORWARD.
 *
 * Much smaller than `EXTRA_BLOCK_MINUTES`, and for a different reason. Catching up on owed
 * reviews is work the schedule already asked for; pulling cards forward is a change TO the
 * schedule, because each one's next interval is then set from an answer given days early.
 *
 * At `RECALL_MINUTES` a ten-minute block is twenty cards. The first learner to press it on a
 * caught-up day was handed seventeen — most of a 29-card deck, its whole schedule compressed
 * in one tap they could not have predicted. Three minutes is about six cards: enough to be
 * worth pressing, small enough that pressing it again is a decision rather than a discovery.
 */
const AHEAD_BLOCK_MINUTES = 3

/**
 * How far ahead the DAILY plan may reach to fill a short session, in days — from the cadence.
 *
 * This is the line where "주 7일" stops being decoration. The setting was written by the goal
 * form, stored on the goal, and read by nothing that plans; the planner asked only "what is due
 * today", so a goal set to seven days a week produced a plan on six days out of twenty-nine.
 *
 * Someone who saved "every day" has already said they intend to study every day. Reaching a
 * week ahead to give them one is honouring that, not overriding it. Someone who saved three
 * days a week has said the opposite, so the reach stays short and the unbounded version stays
 * behind a press.
 *
 * Bounded at both ends: never less than a day (a reach of zero cannot fill anything), never
 * more than a week (beyond that the card was not "nearly due" by any reading).
 */
export function autoAheadDays(cadence: StudyCadence): number {
  const ratio = cadence.studyDays / cadence.cycleDays
  // 7/7 → 7 days. 3/7 → 3. 1/7 → 1.
  return Math.max(1, Math.min(7, Math.round(ratio * 7)))
}

/** Nothing to exclude — `generatePlan` builds the whole day from scratch. */
const EMPTY_EXCLUSIONS: ReadonlySet<string> = new Set()

/** What {@link collectPlanInputs} produces, or why it could not. */
type PlanInputs =
  | { blocked: 'no_decks' | 'no_candidates' }
  | {
    blocked?: undefined
    deckIds: string[]
    cards: Card[]
    templatesById: Map<string, PlanTemplateRow>
    candidates: ReturnType<typeof buildCandidatesFromCards>
  }

/**
 * Gather and score everything the planner can choose from today.
 *
 * Extracted so `generatePlan` and `extendPlan` share it instead of holding two copies. What
 * it does is subtle in several places at once — owned decks carry SRS on the card while
 * subscribed decks keep it in `user_card_progress`, reviews are fetched most-overdue-first so
 * a bounded read drops only the least urgent, intake is round-robined so one deck cannot
 * starve another — and every one of those is a bug that was found and fixed here. A second
 * copy would not inherit the next fix.
 *
 * `excludeCardIds` is one of the two behavioural differences between the callers: extending
 * must not re-offer what is already on today's list.
 *
 * `aheadOfSchedule` is the other, and it exists because of what 더 하기 MEANS. The button says
 * "I want to do more than today's share", and the fetch answered it with "nothing is due" —
 * so a learner who had finished their twelve items was told there was nothing to add while
 * twenty-three cards sat in the deck waiting for their turn. Under this option the review
 * fetch keeps its nearest-first ordering and drops the due CUTOFF, so cards can be pulled
 * forward. Due cards still come first: the ordering is by `next_review_at`, and everything
 * already owed sorts ahead of everything merely upcoming.
 */
async function collectPlanInputs(
  goal: LearningGoalWithDecks,
  ctx: PlanContext,
  userId: string,
  excludeCardIds: ReadonlySet<string>,
  opts: { aheadOfSchedule?: boolean; aheadWithinDays?: number } = {},
): Promise<PlanInputs> {
  const ahead = opts.aheadOfSchedule === true
  /**
   * How far ahead a widened fetch may reach, in days. Undefined means no bound.
   *
   * Bounded is what makes an AUTOMATIC top-up safe. Pulling a card due tomorrow forward by a
   * day costs almost nothing; pulling one due in three weeks forward compresses a schedule the
   * learner never asked to compress. So the daily plan reaches only a few days out, and the
   * unbounded reach stays behind an explicit press.
   */
  const aheadHorizon = ahead && Number.isFinite(opts.aheadWithinDays)
    ? new Date(Date.parse(ctx.now) + (opts.aheadWithinDays as number) * 86_400_000).toISOString()
    : null
  const deckIds = goal.decks.map((link) => link.deck_id)
  if (deckIds.length === 0) {
    // Nothing to plan over. Reported rather than thrown: sending an empty item list would
    // fail server-side validation ("Plan must have at least one item") and surface as a
    // confusing error instead of a clear empty state.
    return { blocked: 'no_decks' }
  }

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
    /**
     * The bound has to clear the exclusions, not just the day.
     *
     * The LIMIT runs in the query and `excludeCardIds` is subtracted afterwards, so a fetch
     * sized for one day returns rows that are then all thrown away. 더 하기 is the case that
     * exposes it: it excludes every card already on today's plan — which the day was BUILT
     * from the top of this very ordering — so the top `fetchLimit` rows are exactly the ones
     * that get removed, and a learner with a real backlog is told nothing is due.
     *
     * Widening by the exclusion count restores the invariant the bound was written for: the
     * fetch returns at least a day's worth of rows the caller can actually use.
     */
    const fetchLimit = candidateFetchLimit(goal.daily_minutes) + excludeCardIds.size

    // Owed reviews, MOST OVERDUE FIRST. The ordering is what makes a bounded fetch honest:
    // whatever falls past the limit is strictly less urgent than what was taken, instead of
    // being whichever rows the database happened to return.
    const embeddedDue = embeddedDeckIds.length === 0 ? [] : await (async () => {
      const query = supabase
        .from('cards')
        .select(CARD_COLUMNS)
        .in('deck_id', embeddedDeckIds)
        .not('next_review_at', 'is', null)
      // The CUTOFF is what `aheadOfSchedule` removes — never the ordering. Sorting by
      // `next_review_at` ascending puts everything owed ahead of everything upcoming, so a
      // widened fetch still serves the backlog first and only then pulls the nearest card
      // forward.
      const bounded = ahead
        ? (aheadHorizon ? query.lte('next_review_at', aheadHorizon) : query)
        : query.lte('next_review_at', ctx.now)
      const { data, error } = await bounded
        .order('next_review_at', { ascending: true })
        .limit(fetchLimit)
        .returns<Card[]>()
      if (error) throw error
      return data ?? []
    })()

    // New cards, fetched SEPARATELY and shared across the goal's decks.
    //
    // Together with the ordering above this is what fixes the two-deck starvation: previously
    // one query took an arbitrary N over both decks, so a deck with a large backlog could
    // supply every row and the other contribute nothing. Intake is now its own budget, spread
    // round-robin, so every deck in a goal advances.
    const embeddedNew = embeddedDeckIds.length === 0 ? [] : await (async () => {
      const perDeckCeiling = Math.max(1, Math.ceil(fetchLimit / embeddedDeckIds.length))
      const { data, error } = await supabase
        .from('cards')
        .select(CARD_COLUMNS)
        .in('deck_id', embeddedDeckIds)
        .is('last_reviewed_at', null)
        // Deterministic, so the same day's plan does not reshuffle between generations.
        .order('deck_id', { ascending: true })
        .order('sort_position', { ascending: true })
        .limit(perDeckCeiling * embeddedDeckIds.length)
        .returns<Card[]>()
      if (error) throw error
      return roundRobinByDeck(data ?? [], fetchLimit)
    })()

    const embeddedCards = [...embeddedDue, ...embeddedNew]

    // Subscribed decks: the due filter CANNOT be pushed into the card query, because the
    // column it would filter on belongs to the publisher. Drive from the progress table
    // instead — `idx_ucp_user_review` covers exactly this predicate — then read the cards
    // those rows point at, so the limit is spent on cards that are actually due.
    const progressCards = progressDeckIds.length === 0 ? [] : await (async () => {
      const progressQuery = supabase
        .from('user_card_progress')
        .select('id, user_id, card_id, deck_id, srs_status, ease_factor, interval_days, repetitions, next_review_at, last_reviewed_at, srs_revision, created_at, updated_at')
        .eq('user_id', userId)
        .in('deck_id', progressDeckIds)
      const boundedProgress = ahead
        ? (aheadHorizon
          ? progressQuery.or(`next_review_at.is.null,next_review_at.lte.${aheadHorizon}`)
          : progressQuery)
        : progressQuery.or(`next_review_at.is.null,next_review_at.lte.${ctx.now}`)
      const { data: progressRows, error: progressErr } = await boundedProgress
        .order('next_review_at', { ascending: true, nullsFirst: false })
        .limit(fetchLimit)
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
      const attached = attachProgressToCards(cardData ?? [], rows)
      // Re-checked in memory because a progress row can be seeded with a due date the query
      // matched on — except when the caller asked to look ahead, where not-yet-due IS the point.
      if (!ahead) return attached.filter((card) => isDueAt(card.next_review_at, ctx.now))
      return aheadHorizon
        ? attached.filter((card) => !card.next_review_at || card.next_review_at <= aheadHorizon)
        : attached
    })()

    // No slice. Each source is already bounded by what the budget can hold, and cutting the
    // concatenation is what previously let owned decks starve subscribed ones: the tail of the
    // list was dropped without regard to how urgent it was.
    const allCards = [...embeddedCards, ...progressCards]
    // Cards already on today's list are dropped HERE, not left to the server. The RPC skips
    // duplicates too, but a payload made only of them returns "0 appended", which reads as
    // "there is nothing more to study" when in fact there is.
    const cards = excludeCardIds.size === 0
      ? allCards
      : allCards.filter((card) => !excludeCardIds.has(card.id))
    if (cards.length === 0) {
      return { blocked: 'no_candidates' }
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

  return { deckIds, cards, templatesById, candidates }
}

/**
 * Hydrate goal rows with their deck links — one query for the whole batch, not one per goal.
 *
 * Shared by the working list and the archive so the two cannot describe the same goal
 * differently: a restored goal must arrive in the active list with exactly the decks the
 * archive said it had.
 */
async function withDeckLinks(goals: LearningGoalRow[]): Promise<LearningGoalWithDecks[]> {
  const { data: linkRows, error } = await supabase
    .from('learning_goal_decks')
    .select('goal_id, deck_id, importance')
    .in('goal_id', goals.map((goal) => goal.id))
  if (error) throw error

  const byGoal = new Map<string, GoalDeckLink[]>()
  for (const row of (linkRows ?? []) as Array<GoalDeckLink & { goal_id: string }>) {
    const bucket = byGoal.get(row.goal_id)
    const link = { deck_id: row.deck_id, importance: Number(row.importance) }
    if (bucket) bucket.push(link)
    else byGoal.set(row.goal_id, [link])
  }
  return goals.map((goal) => ({ ...goal, decks: byGoal.get(goal.id) ?? [] }))
}

export const useLearningStore = create<LearningState>((set, get) => ({
  goals: [],
  goalsLoading: false,
  goalsError: null,
  archivedGoals: null,
  archivedGoalsLoading: false,
  plan: null,
  planItems: [],
  planCards: {},
  planTemplateFields: {},
  planLoading: false,
  planGenerating: false,
  planError: null,
  planErrorFrom: null,
  attemptsError: null,
  coachError: null,
  remediation: null,
  remediationOwned: {},
  remediationBusyAttemptId: null,
  remediationError: null,
  planWeek: null,
  planWeekGoalId: null,
  planAbsentFor: null,
  autoPlanAttempted: {},
  planExtending: false,
  planExtension: null,
  planBlockedReason: null,
  recordingItemId: null,
  attempts: [],
  attemptsLoading: false,
  knowledge: {},
  knowledgeLoading: false,
  insights: null,
  weakCardDecks: {},
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
      // Archived goals are excluded from the working list: they cannot be planned or edited
      // (the RPCs reject them), so listing them here would only offer dead actions. They are
      // read separately by `fetchArchivedGoals`, where the only action offered is restore.
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

      set({ goals: await withDeckLinks(goals) })
    } catch (e) {
      set({ goalsError: toLearningError(e) })
    } finally {
      set({ goalsLoading: false })
    }
  },

  /**
   * The archive, read only when the learner opens it.
   *
   * Not folded into `fetchGoals`: every session pays for that read, and almost nobody has an
   * archived goal. This runs on the press that reveals the drawer.
   */
  fetchArchivedGoals: async () => {
    if (get().archivedGoalsLoading) return
    set({ archivedGoalsLoading: true, goalsError: null })
    try {
      const { data: goalRows, error: goalError } = await supabase
        .from('learning_goals')
        .select('id, domain_id, title, target_date, daily_minutes, status, target, settings, created_at, updated_at')
        .eq('status', 'archived')
        // Most recently touched first: `updated_at` is when it was archived, and the one you
        // put away last is the one you are looking for.
        .order('updated_at', { ascending: false })
      if (goalError) throw goalError

      const goals = (goalRows ?? []) as LearningGoalRow[]
      set({ archivedGoals: goals.length === 0 ? [] : await withDeckLinks(goals) })
    } catch (e) {
      set({ goalsError: toLearningError(e) })
    } finally {
      set({ archivedGoalsLoading: false })
    }
  },

  /**
   * Put an archived goal back to work.
   *
   * `update_learning_goal` has allowed `archived → active` since mig 167 — "Archived goals can
   * only transition to active" — and nothing ever called it. Archiving was therefore a one-way
   * trip: `fetchGoals` filtered the row out and no screen could reach it again. The goal, its
   * deck links and every daily_plan it ever had were still in the database the whole time.
   *
   * Both lists are re-read, because the goal has to leave one and appear in the other.
   */
  restoreGoal: async (goalId) => {
    set({ goalsError: null })
    try {
      const { error } = await supabase.rpc('update_learning_goal', {
        p_goal_id: goalId, p_status: 'active',
      })
      if (error) throw error
      await Promise.all([get().fetchGoals(), get().fetchArchivedGoals()])
      return true
    } catch (e) {
      set({ goalsError: toLearningError(e) })
      return false
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
        ...(input.settings ? { p_settings: input.settings } : {}),
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
      if (input.settings !== undefined) payload.p_settings = input.settings
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
      // The archive list is refreshed only if it has already been opened. Reading it for someone
      // who never looked would spend a round trip to fill a drawer nobody has pulled.
      await get().fetchGoals()
      if (get().archivedGoals !== null) await get().fetchArchivedGoals()
      return true
    } catch (e) {
      set({ goalsError: toLearningError(e) })
      return false
    }
  },

  deleteGoal: async (goalId) => {
    set({ goalsError: null })
    try {
      const { error } = await supabase.rpc('delete_learning_goal', { p_goal_id: goalId })
      if (error) throw error
      // Clear anything that described the goal that no longer exists. `fetchGoals` alone would
      // leave the plan, its items and its forecast painted on screen, and a rating from that
      // stale surface would target a plan item the cascade has already removed.
      set({
        plan: null, planItems: [], planCards: {}, planAbsentFor: null,
        attempts: get().attempts.filter((attempt) => attempt.goal_id !== goalId),
      })
      await get().fetchGoals()
      // An archived goal can be deleted from the archive drawer, and leaving it painted there
      // would offer a restore that answers P0003.
      if (get().archivedGoals !== null) await get().fetchArchivedGoals()
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
    set({ planLoading: true, planError: null, planErrorFrom: null, planBlockedReason: null, planAbsentFor: null })
    try {
      const { data: planRow, error: planErr } = await supabase
        .from('daily_plans')
        .select('id, goal_id, plan_date, timezone, algorithm_version, input_fingerprint, status, budget_minutes, completed_minutes, completed_items, total_items')
        .eq('goal_id', goalId)
        .eq('plan_date', planDate)
        .maybeSingle()
      if (planErr) throw planErr
      if (!planRow) {
        // The read succeeded and there is no plan. This is the ONLY place that fact is
        // established, and the only signal auto-generation is allowed to act on.
        set({ plan: null, planItems: [], planCards: {}, planAbsentFor: `${goalId}|${planDate}` })
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
        planError: toLearningError(e), planErrorFrom: 'read',
        plan: null, planItems: [], planCards: {},
        planTemplateFields: {},
        // Explicitly NOT absent: a failed read tells us nothing about whether a plan exists.
        planAbsentFor: null,
      })
    } finally {
      set({ planLoading: false })
    }
  },

  /**
   * Build today's plan by itself, when — and only when — the server has confirmed there is none.
   *
   * This is the whole reason a learner no longer presses a button: a plan they did not ask for
   * is the product working, and a plan they have to summon is homework. What makes it safe to
   * fire from an effect is that the trigger is a POSITIVE fact from the server, not the absence
   * of one locally. `plan === null` is three situations wearing one face — not read yet, read
   * and empty, read and failed — and only the middle one may be written over.
   *
   * `save_daily_plan` deletes every item and rewrites the day, and it is capped at 50 writes per
   * user per UTC day across ALL goals, a number the client cannot read back. So the guards below
   * are not defensive style; each one is a way a learner loses either today's progress or their
   * ability to plan for the rest of the day.
   */
  autoGeneratePlan: async (goal, ctx) => {
    const key = `${goal.id}|${ctx.planDate}`
    const state = get()

    // 1. The server has to have SAID there is no plan. `plan === null` also means "not read
    //    yet" and "the read failed", and generating on either would overwrite a real plan —
    //    `save_daily_plan` deletes every item and zeroes the day's progress.
    if (state.planAbsentFor !== key) return
    // 2. At most one automatic attempt per goal per day. A failure must not retry itself: the
    //    50-writes-per-day cap is shared across every goal and cannot be read back, so a loop
    //    would spend the learner's own regenerations on retries that keep failing.
    if (state.autoPlanAttempted[key]) return
    // 3. Not while a read is in flight: `planAbsentFor` is from the PREVIOUS read, and the one
    //    running may be about to contradict it. Generation needs no lock here — `generatePlan`
    //    holds its own, and a second synchronous call is already stopped by (2), which is set
    //    before the await.
    if (state.planLoading) return
    // 4. A goal with no decks has nothing to plan, and `generatePlan` would only set a blocked
    //    reason. Checked here so opening such a goal does not burn the one attempt.
    if (!goal.decks?.length) return

    set({ autoPlanAttempted: { ...state.autoPlanAttempted, [key]: true } })
    await get().generatePlan(goal, ctx)
  },

  /**
   * Generate + persist today's plan for a goal.
   *
   * Called on explicit intent (the learner asking for a new plan) and by
   * {@link autoGeneratePlan}, which supplies the intent on the day's first open. It does NOT
   * decide whether generating is appropriate — every check that protects the 50-writes-per-day
   * cap lives in the caller, so that a deliberate "rebuild my plan" is never refused by a guard
   * meant for an effect.
   */
  generatePlan: async (goal, ctx) => {
    if (get().planGenerating) return false
    set({ planGenerating: true, planError: null, planErrorFrom: null, planBlockedReason: null })
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id
      if (!userId) throw { code: 'P0001', message: 'Authentication required' }

      const inputs = await collectPlanInputs(goal, ctx, userId, EMPTY_EXCLUSIONS)
      if (inputs.blocked) {
        set({ planBlockedReason: inputs.blocked })
        return false
      }
      const { cards, templatesById, candidates } = inputs

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
        /**
         * The intake throttle.
         *
         * Absent settings fall back to `DEFAULT_NEW_CARDS_PER_DAY`, NOT to uncapped. Uncapped
         * was a deliberate compatibility choice — "an existing goal plans exactly as it did
         * until its owner chooses a number" — and the behaviour it preserved turned out to be
         * the entire deck on day one. A learner reported it: a 29-card goal whose first plan
         * was all 29 cards, so from day two there were no new cards left and every plan was
         * pure review. On a 4,000-card deck the same path commits a year of reviews in one
         * sitting.
         *
         * It was also a lie about what the learner had been shown. `GoalFormModal` seeds the
         * field with `parseNewCardsPerDay(settings) ?? DEFAULT_NEW_CARDS_PER_DAY`, so the form
         * has always displayed 20 for a goal with no stored number while the planner used
         * infinity. The two now agree.
         *
         * `extendPlan` still passes `undefined` on purpose and still means uncapped — see its
         * own note. That is a button the learner pressed AFTER finishing the day's intake.
         */
        newCardsPerDay: parseNewCardsPerDay(goal.settings) ?? DEFAULT_NEW_CARDS_PER_DAY,
        activityMix: activityMixForDomain(goal.domain_id),
        now: ctx.now,
        timezone: ctx.timezone,
        algorithmVersion: DAILY_PLANNER_VERSION,
      }, {
        supportedActivityTypes: supportedActivityTypesForDomain(goal.domain_id),
      })
      if (output.items.length === 0) {
        // The planner had candidates and took none of them. For GENERATION that is a day with
        // nothing in it, which is exactly what `planBlockedReason` is for.
        set({ planBlockedReason: 'no_candidates' })
        return false
      }

      let items = toPlanItemRows(output, cards, templatesById, candidates)

      /**
       * Fill the session the learner asked for, as often as they said they study.
       *
       * `daily_minutes` is what they said they do IN A SESSION — `GoalFormModal` divides by
       * `perStudyDayMultiplier` precisely because of that. The planner had no obligation to
       * reach it: it took whatever was due, and stopped. On a small or well-learned deck that
       * is nothing most days, so a goal set to study seven days a week produced a plan on six
       * days out of twenty-nine and an empty screen on the rest. The setting promised daily
       * study and nothing in the planning path had ever read it.
       *
       * So a short day is topped up from cards whose turn is nearly here — and HOW FAR is
       * decided by the cadence the learner saved, which is the whole point:
       *
       *   주 7일  every day is a study day, so the plan reaches far enough to actually make one
       *   주 N일  fewer sessions carry more each, so a shorter reach still fills them
       *
       * A learner who said "seven days a week" has already consented to studying every day;
       * making them press a button to get a day is the app not believing its own settings.
       * A learner who said three days a week has not, so the reach stays small and the
       * unbounded version stays behind an explicit press (`generateAheadPlan`).
       */
      const plannedMinutes = output.items.reduce((sum, i) => sum + i.estimatedMinutes, 0)
      const shortBy = goal.daily_minutes - plannedMinutes
      /**
       * The day is short only when the planner RAN OUT, not merely when it stopped.
       *
       * Budget-versus-planned is the wrong signal, and measuring it that way would have shipped
       * a bad bug: a language goal with forty due cards plans twenty of them — the activity mix
       * declines to spend the whole budget on one class — so ten minutes look "missing" while
       * twenty owed cards sit unselected. Reaching forward there would pull tomorrow's work
       * onto the desk of someone already behind.
       *
       * Leaving candidates on the table means the day is as full as the planner wants it. Only
       * an exhausted pool says there was nothing more to take.
       */
      const poolExhausted = output.items.length >= candidates.length
      if (poolExhausted && shortBy >= RECALL_MINUTES * 2) {
        const already = new Set(items.map((i) => i.card_id).filter((id): id is string => !!id))
        const near = await collectPlanInputs(goal, ctx, userId, already, {
          aheadOfSchedule: true, aheadWithinDays: autoAheadDays(parseCadence(goal.settings)),
        })
        if (!near.blocked) {
          const topUp = buildDailyPlan({
            goal: toDomainGoal(goal, userId),
            candidates: near.candidates,
            budgetMinutes: shortBy,
            // Intake is already spent by the pass above; this block is review only.
            newCardsPerDay: 0,
            activityMix: activityMixForDomain(goal.domain_id),
            now: ctx.now,
            timezone: ctx.timezone,
            algorithmVersion: DAILY_PLANNER_VERSION,
          }, {
            supportedActivityTypes: supportedActivityTypesForDomain(goal.domain_id),
          })
          if (topUp.items.length > 0) {
            // Appended, not interleaved: `save_daily_plan` takes position from array order, and
            // owed work should still be the first thing the learner sees.
            items = [
              ...items,
              ...toPlanItemRows(topUp, near.cards, near.templatesById, near.candidates),
            ]
          }
        }
      }

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
      set({ planError: toLearningError(e), planErrorFrom: 'generate' })
      return false
    } finally {
      set({ planGenerating: false })
    }
  },

  /**
   * Build a day out of cards whose turn has NOT come, on explicit request.
   *
   * The day the learner opens a caught-up goal and wants to study anyway. `generatePlan` will
   * not do this: it reaches three days ahead at most, because it runs automatically and an
   * automatic reach into next month is a rescheduling nobody asked for. This one is a press,
   * so it is unbounded — and the screen says what it did.
   *
   * Deliberately NOT wired into `autoGeneratePlan`. A goal that quietly manufactures a full
   * session every day stops being spaced repetition; the learner has to ask.
   */
  generateAheadPlan: async (goal, ctx) => {
    if (get().planGenerating) return false
    set({ planGenerating: true, planError: null, planErrorFrom: null, planBlockedReason: null })
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id
      if (!userId) throw { code: 'P0001', message: 'Authentication required' }

      const inputs = await collectPlanInputs(goal, ctx, userId, EMPTY_EXCLUSIONS, {
        aheadOfSchedule: true,
      })
      if (inputs.blocked) {
        // Nothing owed AND nothing upcoming: the goal's decks are genuinely empty of anything
        // this learner could study, which is the one state the blocked card is true for.
        set({ planBlockedReason: inputs.blocked })
        return false
      }
      const { cards, templatesById, candidates } = inputs

      const output = buildDailyPlan({
        goal: toDomainGoal(goal, userId),
        candidates,
        budgetMinutes: goal.daily_minutes,
        newCardsPerDay: parseNewCardsPerDay(goal.settings) ?? DEFAULT_NEW_CARDS_PER_DAY,
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

      const { error: saveErr } = await supabase.rpc('save_daily_plan', {
        p_goal_id: goal.id,
        p_plan_date: ctx.planDate,
        p_timezone: ctx.timezone,
        p_algorithm_version: output.algorithmVersion,
        p_input_fingerprint: output.inputFingerprint,
        p_budget_minutes: goal.daily_minutes,
        p_items: toPlanItemRows(output, cards, templatesById, candidates),
      })
      if (saveErr) throw saveErr

      await get().fetchPlan(goal.id, ctx.planDate)
      return true
    } catch (e) {
      set({ planError: toLearningError(e), planErrorFrom: 'generate' })
      return false
    } finally {
      set({ planGenerating: false })
    }
  },

  extendPlan: async (goal, ctx) => {
    const { plan, planItems, planExtending, planGenerating } = get()
    // Nothing to append TO. The RPC would raise P0003, but the honest reading is that the
    // caller asked to extend a plan that does not exist — which is a bug, not a user error.
    if (!plan || planExtending || planGenerating) return false

    set({ planExtending: true, planError: null, planErrorFrom: null, planBlockedReason: null, planExtension: null })
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id
      if (!userId) throw { code: 'P0001', message: 'Authentication required' }

      const already = new Set(
        planItems.map((item) => item.card_id).filter((id): id is string => !!id),
      )

      /**
       * A FRESH instant, and the plan date the caller opened.
       *
       * Both screens build their context once at mount (`useMemo(() => currentPlanContext(),
       * [])`) so the plan they render cannot shift under them. That is right for rendering and
       * wrong here: `ctx.now` is the due cutoff, so a card whose 10-minute learning step
       * elapsed while the learner sat on the page was invisible to 더 하기 until a full
       * reload. The learner finishes the day, waits, presses the button, and is told nothing
       * is due — dated to when they arrived rather than to when they asked.
       *
       * `planDate` is deliberately NOT refreshed: this appends to the plan on screen, and a
       * page left open across midnight must not silently write into tomorrow.
       */
      const at: PlanContext = { ...ctx, now: new Date().toISOString() }

      /**
       * Two passes, because of what the button MEANS.
       *
       * 더 하기 is "I want to do more than today's share". The first pass asks the ordinary
       * question — what is owed — and on a finished day the answer is nothing, because the day
       * was built from exactly those cards. Reporting that as "더 넣을 것이 없습니다" told a
       * learner their goal was exhausted while twenty-three cards sat in the deck waiting for
       * their turn. It was answering "is anything due?" to someone who asked "can I do more?".
       *
       * So the second pass drops the due cutoff and pulls the NEAREST upcoming cards forward.
       * Only when that also comes back empty is there genuinely nothing left to add — which is
       * the only state the "nothing to add" sentence was ever true for.
       */
      const planFor = async (aheadOfSchedule: boolean) => {
        const collected = await collectPlanInputs(goal, at, userId, already, { aheadOfSchedule })
        if (collected.blocked) return { collected, output: null }
        return {
          collected,
          output: buildDailyPlan({
            goal: toDomainGoal(goal, userId),
            candidates: collected.candidates,
            // A fixed small block, not another full day. "더 하기" is meant to be pressed again
            // if it was not enough, and each press should be a decision the learner can stop
            // making — whereas one press that silently doubles a 60-minute goal is not.
            //
            // Smaller still when the block is pulled FORWARD: that is a change to the
            // schedule rather than work it already asked for. See `AHEAD_BLOCK_MINUTES`.
            budgetMinutes: aheadOfSchedule ? AHEAD_BLOCK_MINUTES : EXTRA_BLOCK_MINUTES,
            // Deliberately uncapped, unlike the daily plan. The learner has already met the
            // intake they set for today; refusing to start anything new would make this button
            // do nothing on the very day it is most wanted — the day they finished early. The
            // cost is stated instead, in `planExtension`.
            newCardsPerDay: undefined,
            activityMix: activityMixForDomain(goal.domain_id),
            now: at.now,
            timezone: at.timezone,
            algorithmVersion: DAILY_PLANNER_VERSION,
          }, {
            supportedActivityTypes: supportedActivityTypesForDomain(goal.domain_id),
          }),
        }
      }

      // Owed work first. Only if there is none — either no candidates at all, or none the
      // planner would take — does the second pass pull upcoming cards forward.
      let aheadOfSchedule = false
      let attempt = await planFor(false)
      if (attempt.collected.blocked === 'no_candidates' || attempt.output?.items.length === 0) {
        const wider = await planFor(true)
        if (!wider.collected.blocked && (wider.output?.items.length ?? 0) > 0) {
          aheadOfSchedule = true
          attempt = wider
        }
      }

      const inputs = attempt.collected
      if (inputs.blocked) {
        // NOT `planBlockedReason`. That state belongs to plan GENERATION — "this goal has
        // nothing to build a day out of" — and the screen renders it INSTEAD of the plan.
        // Setting it here meant pressing 더 하기 on a day the learner had just finished
        // replaced their completed plan with "오늘 이 덱들에서 복습할 카드가 없습니다": the
        // day's work vanished, and the message was false besides — six cards had been due
        // today and they had done all six.
        //
        // "Nothing more to add" is an extension RESULT, and the screen already has a line
        // for it that sits under the button and leaves the plan alone.
        set({ planExtension: { appended: 0, newCards: 0, reviewsTomorrow: 0, aheadOfSchedule: false } })
        return false
      }
      const { cards, templatesById, candidates } = inputs
      const output = attempt.output!
      if (output.items.length === 0) {
        // Genuinely nothing left: nothing owed, and nothing upcoming the planner would pull
        // forward either. This is the ONLY state the "nothing to add" sentence is true for.
        set({ planExtension: { appended: 0, newCards: 0, reviewsTomorrow: 0, aheadOfSchedule: false } })
        return false
      }

      const items = toPlanItemRows(output, cards, templatesById, candidates)
      const { data, error: appendErr } = await supabase.rpc('append_daily_plan_items', {
        p_goal_id: goal.id,
        p_plan_date: ctx.planDate,
        p_items: items,
      })
      if (appendErr) throw appendErr

      const appended = Number((data as { appended?: number } | null)?.appended ?? 0)

      await get().fetchPlan(goal.id, ctx.planDate)

      // Which items were added is read back from the PLAN, not inferred from the payload.
      // The RPC skips cards already present and reports only how many — and a skip can fall
      // anywhere in the list, so taking the first `appended` items of what was sent would name
      // the wrong ones whenever `planItems` was stale (another device, another tab). The rows
      // that are in the plan now and were not before are exactly the ones that landed.
      const cardsById = new Map(cards.map((card) => [card.id, card]))
      const newCards = get().planItems.filter((item) => {
        if (!item.card_id || already.has(item.card_id)) return false
        const card = cardsById.get(item.card_id)
        // A card with no review history is intake. Absent from the map means it came from an
        // earlier append this session and is not ours to count.
        return !!card && !card.last_reviewed_at
      }).length

      set({
        planExtension: {
          aheadOfSchedule,
          appended,
          newCards,
          reviewsTomorrow: reviewsAddedTomorrow(newCards),
        },
      })
      return appended > 0
    } catch (e) {
      set({ planError: toLearningError(e), planErrorFrom: 'extend' })
      return false
    } finally {
      set({ planExtending: false })
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
    set({ recordingItemId: item.id, planError: null, planErrorFrom: null })
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
      set({ planError: toLearningError(e), planErrorFrom: 'record' })
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
      // NOT `planError`. A history read that fails says nothing about whether the plan was
      // built, and routing it here put "플랜을 만들지 못했습니다" over a plan that existed.
      // The recap simply does not render; there is nothing for the learner to do about it.
      set({ attemptsError: toLearningError(e) })
    } finally {
      set({ attemptsLoading: false })
    }
  },

  /**
   * Ask the server whether this goal has earned its completion stamp.
   *
   * Idempotent and server-judged (`complete_goal_if_earned`, mig 192): the client says which
   * goal, never whether. Called after a rating rather than on every render — the ratio can only
   * change when a card's interval does.
   *
   * A refusal is swallowed. Failing to stamp a milestone must never break the screen the
   * learner is standing on, and the next rating will ask again.
   */
  completeGoalIfEarned: async (goalId) => {
    try {
      const { data, error } = await supabase.rpc('complete_goal_if_earned', { p_goal_id: goalId })
      if (error) throw error
      const changed = Boolean((data as { changed?: boolean } | null)?.changed)
      if (changed) await get().fetchGoals()
      return changed
    } catch (e) {
      console.error('[learning-store] complete_goal_if_earned failed:', e)
      return false
    }
  },

  fetchGoalKnowledge: async (goalId, atISO) => {
    set({ knowledgeLoading: true })
    try {
      const { data, error } = await supabase.rpc('get_goal_knowledge', {
        p_goal_id: goalId,
        p_at: atISO,
        p_stability_multiplier: retentionStabilityMultiplier(),
      })
      if (error) throw error
      // The RPC's jsonb is snake_case and two of its keys do not match the camelCase names
      // this store exposes, so the wire shape is spelt out rather than asserted to be the
      // domain type.
      const row = (data ?? {}) as Partial<GoalKnowledge> & {
        due_now?: number
        overdue?: number
        next_due_at?: string | null
      }
      set((state) => ({
        knowledge: {
          ...state.knowledge,
          [goalId]: {
            total: Number(row.total ?? 0),
            unseen: Number(row.unseen ?? 0),
            known: Number(row.known ?? 0),
            unknown: Number(row.unknown ?? 0),
            // The two the RPC has always returned and no client ever read.
            dueNow: Number(row.due_now ?? 0),
            overdue: Number(row.overdue ?? 0),
            // Absent until mig 192 is deployed. Zero then, which reads as "no mastery yet"
            // and simply shows no completion line — never as a wrong date.
            mature: Number(row.mature ?? 0),
            rung1: Number(row.rung1 ?? 0),
            rung3: Number(row.rung3 ?? 0),
            rung8: Number(row.rung8 ?? 0),
            // Absent before mig 211. Null then, which shows the plain empty state — never a
            // wrong time.
            nextDueAt: row.next_due_at ?? null,
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
        // PAGINATED, not `.limit(2000)`.
        //
        // PostgREST caps a single response at `max_rows = 1000` (supabase/config.toml), silently
        // — the same S-H1 truncation `study-store.ts` was fixed for. Asking for 2,000 and
        // receiving 1,000 with no error made this window "the last 1,000 attempts" rather than
        // "30 days", and it did so WORST for the heaviest learners: at 200 attempts a day the
        // effective window is five days, a card failed twice three weeks ago contributes nothing,
        // and a card whose two attempts straddle row 1,000 is filtered out by `WEAK_MIN_ATTEMPTS`
        // entirely. The panel got quieter the more you studied.
        fetchAllRows<InsightAttempt>(() => supabase
          .from('answer_attempts')
          .select('card_id, normalized_score, duration_ms, created_at')
          .eq('goal_id', goalId)
          .gte('created_at', attemptsSince)
          .order('created_at', { ascending: false })
          .returns<InsightAttempt[]>())
          .then((data) => ({ data, error: null }))
          // `cause` carries the PostgREST error, code and all; the wrapper Error only carries a
          // sentence, and this store maps 42501 to FORBIDDEN by code.
          .catch((error: unknown) => ({
            data: null,
            error: (error instanceof Error && error.cause) ? error.cause : error,
          })),
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

      const insights = summarizeLearning({
        attempts: attemptsResult.data ?? [],
        plans: plansResult.data ?? [],
      })

      // Which deck each weak card lives in. `summarizeLearning` is pure and works from attempt
      // rows, which carry no deck — but a study session takes ONE deck (`finalize_study_session`
      // refuses a session whose rating events span decks), so the button cannot be offered
      // without this. Read here rather than in the component: a component that fetches on render
      // would re-fetch on every keystroke elsewhere on the page.
      let weakCardDecks: Record<string, string> = {}
      if (insights.weakCards.length > 0) {
        const { data: deckRows } = await supabase
          .from('cards')
          .select('id, deck_id')
          .in('id', insights.weakCards.map((card) => card.cardId))
        if (seq !== insightsRequestSeq) return
        weakCardDecks = Object.fromEntries(
          ((deckRows ?? []) as Array<{ id: string; deck_id: string }>)
            .map((row) => [row.id, row.deck_id]),
        )
      }

      set({ insights, weakCardDecks, insightsGoalId: goalId })
    } catch (e) {
      if (seq !== insightsRequestSeq) return
      set({
        insightsError: toLearningError(e), insights: null, weakCardDecks: {},
        insightsGoalId: goalId,
      })
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
        .select('id, goal_id, card_id, concept_id, activity_id, action_type, provider, reason, payload, algorithm_version, status, created_at')
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
      set({ insightsError: toLearningError(e) })
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
  regeneratePlanCoach: async (goalId, timezone) => {
    set({ planError: null })
    try {
      const { data, error } = await supabase.rpc('get_plan_digest', {
        p_goal_id: goalId, p_timezone: timezone, p_days: 7,
      })
      if (error) throw error

      // The week goes into state BEFORE the coach decides anything, and independently of
      // what it decides. The coach is allowed to have nothing to say — that is its normal
      // answer — and the strip must not vanish along with it.
      set({ planWeek: derivePlanWeek(data as WeekDigest), planWeekGoalId: goalId })

      const suggestion: CoachSuggestion | null = planCoach(data as PlanDigest)
      // `null` means the window is too short to judge. Writing an empty set would clear a
      // suggestion the learner has not answered yet, for no reason.
      if (!suggestion) return false

      const { error: writeError } = await supabase.rpc('set_study_recommendations', {
        p_goal_id: goalId,
        p_items: [{
          action_type: suggestion.lever,
          // The evidence travels with the suggestion so the UI can say WHY without
          // recomputing it, and a stored row stays explainable months later.
          reason: `${suggestion.evidence.finishedDays}/${suggestion.evidence.windowDays} finished`,
          payload: { value: suggestion.value, evidence: suggestion.evidence },
        }],
        p_provider: 'algorithm',
        p_algorithm_version: PLAN_COACH_VERSION,
      })
      if (writeError) throw writeError
      await get().fetchRecommendations(goalId)
      return true
    } catch (e) {
      // Silent, as this action's own docblock has always said: "A coach that cannot be
      // produced is not worth an error on the learner's screen." It wrote to `planError`
      // anyway, so a failed coach claimed the PLAN had failed.
      set({ coachError: toLearningError(e) })
      return false
    }
  },

  applyPlanCoach: async (recommendationId) => {
    const row = get().recommendations.find((r) => r.id === recommendationId)
    if (!row?.goal_id) return false

    const value = (row.payload as { value?: number | null } | null)?.value
    const dial = PLAN_LEVER_DIAL[row.action_type as PlanLever]

    // A lever that changes no setting is encouragement, not configuration — accepting it
    // records the learner's answer and touches nothing else.
    if (dial && typeof value === 'number') {
      let ok: boolean
      if (dial === 'daily_minutes') {
        ok = await get().updateGoal({ goalId: row.goal_id, dailyMinutes: value })
      } else {
        /**
         * MERGED, and in the key the rest of the app actually uses.
         *
         * Two faults met here. `update_learning_goal` does `settings = COALESCE(p_settings,
         * settings)` — a whole-object REPLACE — so posting one key deleted every other one.
         * The one that mattered is `cadence`: accepting a coach suggestion silently reset the
         * learner's 주7일 schedule to the default, which is the setting that decides whether
         * they get a plan every day at all.
         *
         * And the key was `new_cards_per_day`, while `parseNewCardsPerDay` and both goal forms
         * use `newCardsPerDay`. So the lever wrote somewhere nothing reads: the learner
         * accepted "fewer new cards a day", lost their schedule, and their intake did not
         * change.
         */
        const current = get().goals.find((g) => g.id === row.goal_id)?.settings
        const settings = (current && typeof current === 'object' ? { ...current } : {}) as
          Record<string, unknown>
        settings.newCardsPerDay = value
        // Any legacy snake_case value would otherwise sit alongside the new one and win in
        // whichever reader still looks for it.
        delete settings.new_cards_per_day
        ok = await get().updateGoal({ goalId: row.goal_id, settings })
      }
      if (!ok) return false
    }
    return get().resolveRecommendation(recommendationId, 'accepted')
  },

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

  requestRemediation: async ({ action, goalId, attemptId, cardId, uiLang }) => {
    if (get().remediationBusyAttemptId) return false
    set({ remediationBusyAttemptId: attemptId, remediationError: null })
    try {
      const result = await callServerAI({
        kind: 'remediation',
        action,
        uiLang,
        goalId,
        attemptId,
        // The card is sent so the server can load the prompt and the declared answer field. An
        // absent card is not an error: `explain` can stand on the attempt alone.
        ...(cardId ? { cardIds: [cardId] } : {}),
      })
      const content = result.content as {
        summary?: unknown
        blocks?: unknown
        warnings?: unknown
      }
      // Re-checked here even though the server validated it: this store is what the screen
      // renders from, and a shape assertion at the boundary is what stops one bad response
      // becoming a blank card the learner has already paid for.
      const summary = typeof content.summary === 'string' ? content.summary.trim() : ''
      const blocks = Array.isArray(content.blocks)
        ? (content.blocks as Array<{ type?: unknown; content?: unknown }>)
          .filter((b) => b && typeof b.type === 'string')
          .map((b) => ({ type: String(b.type), content: b.content }))
        : []
      if (summary === '' && blocks.length === 0) throw { code: 'AI_INVALID_RESULT' }

      const view = {
        attemptId,
        action,
        summary,
        blocks,
        warnings: Array.isArray(content.warnings)
          ? (content.warnings as unknown[]).filter((w): w is string => typeof w === 'string')
          : [],
      }
      // Shown AND kept. The second half is what makes 닫기 survivable: the artifact is paid
      // for, so losing it to a button labelled "close" was a charge with nothing behind it.
      set({ remediation: view, remediationOwned: { ...get().remediationOwned, [attemptId]: view } })
      return true
    } catch (e) {
      // `callServerAI` throws `new Error(<code>)`, so the code is the MESSAGE. Anything else
      // reaching here is a client-side fault, which is not a code the learner can act on.
      const code = e instanceof Error && e.message ? e.message
        : typeof (e as { code?: unknown })?.code === 'string' ? String((e as { code: string }).code)
          : 'SERVER_ERROR'
      set({ remediationError: { code } })
      return false
    } finally {
      set({ remediationBusyAttemptId: null })
    }
  },

  loadRemediation: async ({ attemptId, action }) => {
    // Already known — including from this session's own purchase. A read per render would be a
    // request per keystroke on a screen that re-renders on every store write.
    if (get().remediationOwned[attemptId]) return true
    try {
      const { data, error } = await supabase
        .from('user_enrichments')
        .select('content')
        .eq('attempt_id', attemptId)
        .eq('action', action)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      // RLS scopes this to the owner; `user_id` is not filtered here because doing so would
      // imply the policy is optional.
      if (error || !data) return false

      const content = (data.content ?? {}) as {
        summary?: unknown
        blocks?: unknown
        warnings?: unknown
      }
      const summary = typeof content.summary === 'string' ? content.summary.trim() : ''
      const blocks = Array.isArray(content.blocks)
        ? (content.blocks as Array<{ type?: unknown; content?: unknown }>)
          .filter((b) => b && typeof b.type === 'string')
          .map((b) => ({ type: String(b.type), content: b.content }))
        : []
      // A row that renders to nothing is not something to offer as "already bought"; leaving
      // it out means the learner sees the normal paid button rather than an empty panel.
      if (summary === '' && blocks.length === 0) return false

      set({
        remediationOwned: {
          ...get().remediationOwned,
          [attemptId]: {
            attemptId,
            action,
            summary,
            blocks,
            warnings: Array.isArray(content.warnings)
              ? (content.warnings as unknown[]).filter((w): w is string => typeof w === 'string')
              : [],
          },
        },
      })
      return true
    } catch {
      // A failed read is not a failed purchase. Staying quiet leaves the paid button, which
      // the server now answers from storage anyway (mig 212) rather than charging again.
      return false
    }
  },

  showOwnedRemediation: (attemptId) => {
    const owned = get().remediationOwned[attemptId]
    if (!owned) return false
    set({ remediation: owned, remediationError: null })
    return true
  },

  dismissRemediation: () => set({ remediation: null, remediationError: null }),

  reset: () => {
    // Bump both generations so any response still in flight is recognised as superseded and
    // cannot repopulate the store after a logout.
    insightsRequestSeq++
    recommendationsRequestSeq++
    set({
      goals: [], goalsLoading: false, goalsError: null,
      plan: null, planItems: [], planCards: {}, planTemplateFields: {},
      planLoading: false, planGenerating: false,
      planError: null, planErrorFrom: null, attemptsError: null, coachError: null,
      remediation: null, remediationOwned: {},
      remediationBusyAttemptId: null, remediationError: null,
      planBlockedReason: null,
      // Both must go with the plan they describe. A surviving `planAbsentFor` would assert
      // "there is no plan today" about the account that just signed OUT, and a surviving
      // `autoPlanAttempted` would refuse to build one for the account that signed in.
      planAbsentFor: null, autoPlanAttempted: {},
      planExtending: false, planExtension: null,
      // The week strip describes ONE account's seven days. Left behind, it would survive a
      // logout in memory and draw the previous learner's week under the next one's goal —
      // masked in practice only by the `planWeekGoalId === goalId` guard, which is a
      // coincidence rather than a defence.
      planWeek: null, planWeekGoalId: null,
      recordingItemId: null, attempts: [], attemptsLoading: false,
      insights: null, weakCardDecks: {}, insightsLoading: false, insightsGoalId: null,
      insightsError: null,
      recommendations: [], recommendationsLoading: false, recommendationsGoalId: null,
      recommendationBusyId: null,
    })
  },
}))
