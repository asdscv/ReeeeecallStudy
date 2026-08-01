/**
 * Core domain types for the modular learning engine.
 *
 * Design §4, §6.1: Validated strings with branded intersection for extensibility.
 * No framework/Supabase/Zustand imports.
 */

// ─── Extensible string types ────────────────────────────────────────────────

/** Activity classes: recall, practice, produce, plus future extension. */
export type ActivityType = 'recall' | 'practice' | 'produce' | (string & {})

/** Stimulus media: text, image, audio, video, plus future extension. */
type StimulusType = 'text' | 'image' | 'audio' | 'video' | (string & {})

/** Response media: self_rate, choice, text, audio, plus future extension. */
type ResponseType = 'self_rate' | 'choice' | 'text' | 'audio' | (string & {})

/** Evaluator method: self_rate, exact, choice, rubric, ai, speech, plus future. */
type EvaluatorType = 'self_rate' | 'exact' | 'choice' | 'rubric' | 'ai' | 'speech' | (string & {})

/** Goal lifecycle status. */
type GoalStatus = 'active' | 'paused' | 'completed' | 'archived'

// ─── Value objects ──────────────────────────────────────────────────────────

/** Difficulty constrained to [0, 1]. */
export type Difficulty = number & { readonly __brand: 'Difficulty' }

// ─── Entities ───────────────────────────────────────────────────────────────

export interface LearningGoal {
  readonly id: string
  readonly userId: string
  readonly domainId: string
  readonly title: string
  readonly targetDate: string | null
  readonly dailyMinutes: number
  readonly status: GoalStatus
  readonly target: Record<string, unknown>
  readonly settings: Record<string, unknown>
  readonly createdAt: string
  readonly updatedAt: string
}

export interface LearningActivity {
  readonly id: string
  readonly ownerUserId: string | null
  readonly conceptId: string | null
  readonly cardId: string | null
  readonly sourceId: string | null
  readonly activityType: ActivityType
  readonly stimulusType: StimulusType
  readonly responseType: ResponseType
  readonly evaluatorType: EvaluatorType
  readonly title: string
  readonly instructions: string | null
  readonly stimulus: Record<string, unknown> | null
  readonly expectedResponse: Record<string, unknown> | null
  readonly rubric: Record<string, unknown> | null
  readonly config: Record<string, unknown>
  readonly difficulty: Difficulty | null
  readonly contentVersion: number
  readonly createdAt: string
  readonly updatedAt: string
}

// ─── Structured feedback ────────────────────────────────────────────────────

// ─── Rubric ─────────────────────────────────────────────────────────────────

// ─── Planner types ──────────────────────────────────────────────────────────

export interface PlannerCandidate {
  readonly candidateId: string
  readonly activityId: string | null
  readonly cardId: string | null
  readonly conceptId: string | null
  readonly activityType: ActivityType
  readonly dueUrgency: number
  readonly recentFailure: number
  readonly responseTimePenalty: number
  readonly goalRelevance: number
  readonly contentImportance: number
  /**
   * How much a review right now is worth given the estimated forgetting curve, 0..1,
   * peaking below certainty (see `application/memory.ts`).
   *
   * Optional AND nullable on purpose: `undefined` (a caller that does not compute it) and
   * `null` (a card whose memory state cannot be estimated — new, never reviewed, no interval)
   * mean the same thing to the planner, which renormalises the remaining weights instead of
   * substituting a neutral value. A number here is never a guess.
   */
  readonly reviewValue?: number | null
  /**
   * Estimated probability the learner can recall this item right now, 0..1.
   *
   * Carried for EXPLANATION, never for scoring. `reviewValue` is the ranking feature and is
   * derived from this; adding this to the planner's `FEATURES` as well would count the same
   * evidence twice, and would do it with the wrong shape — recall probability is monotone in
   * time while a review's value is not a straight function of it.
   *
   * It exists on the candidate because it is the one number in this whole model a learner can
   * read without being taught anything ("you have about a 40% chance of remembering this"), and
   * the plan row is where that belongs. Same optional-and-nullable discipline as `reviewValue`:
   * a number here is never a guess.
   */
  readonly retrievability?: number | null
  readonly estimatedMinutes: number
  readonly difficulty: Difficulty | null
}

export interface PlannerInput {
  readonly goal: LearningGoal
  readonly candidates: readonly PlannerCandidate[]
  readonly budgetMinutes: number
  readonly activityMix?: Readonly<Record<string, number>>
  readonly now: string
  readonly timezone: string
  readonly algorithmVersion: string
}

export interface PlannerOutput {
  readonly items: readonly PlannedItem[]
  readonly algorithmVersion: string
  readonly inputFingerprint: string
  readonly totalMinutes: number
  readonly mixUsed: Readonly<Record<string, number>>
  readonly diagnostics: PlannerDiagnostics
}

export interface PlannedItem {
  readonly candidateId: string
  readonly activityId: string | null
  readonly cardId: string | null
  readonly conceptId: string | null
  readonly activityType: ActivityType
  readonly priority: number
  readonly estimatedMinutes: number
  readonly reasonCode: string
  readonly position: number
}

interface PlannerDiagnostics {
  readonly candidateCount: number
  readonly selectedCount: number
  readonly excludedUnsupported: number
  readonly reasonCodes: Readonly<Record<string, number>>
}

// ─── Goal relevance context ─────────────────────────────────────────────────

// ─── Domain adapter ─────────────────────────────────────────────────────────

/**
 * What a learning domain is allowed to decide.
 *
 * Both members are read by `learning-store` on every plan build, via
 * `activityMixForDomain` / `supportedActivityTypesForDomain`. Nothing else belongs here: an
 * adapter that declares something no caller reads is indistinguishable from an adapter that
 * lies, and this interface had four such members.
 *
 * Removed, and why — `validateActivity` and `contentValidators` validated a `LearningActivity`
 * that is never persisted (`create_private_activity` / `create_private_source` have zero
 * callers, and production holds 0 rows in `learning_activities`, `learning_concepts`, and
 * `content_sources`). `scoreGoalRelevance` was shadowed by `learning_goal_decks.importance`,
 * which is what the ranker actually reads, and would have been a constant anyway because every
 * candidate `buildCandidatesFromCards` emits is `recall`. `promptPolicy.requireSourceGrounding`
 * was declared true by exactly one domain and made its remediation UNSATISFIABLE — see
 * `supabase/functions/_shared/ai-remediation.ts`.
 *
 * Add a member back when a caller exists, not before.
 */
export interface LearningDomainAdapter {
  readonly id: string
  readonly version: string
  readonly supportedActivityTypes: readonly string[]
  readonly defaultPlanMix: Readonly<Record<string, number>>
}
