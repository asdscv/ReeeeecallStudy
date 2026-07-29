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
export type StimulusType = 'text' | 'image' | 'audio' | 'video' | (string & {})

/** Response media: self_rate, choice, text, audio, plus future extension. */
export type ResponseType = 'self_rate' | 'choice' | 'text' | 'audio' | (string & {})

/** Evaluator method: self_rate, exact, choice, rubric, ai, speech, plus future. */
export type EvaluatorType = 'self_rate' | 'exact' | 'choice' | 'rubric' | 'ai' | 'speech' | (string & {})

/** Universal enrichment/remediation actions. */
export type EnrichmentAction = 'explain' | 'compare' | 'hint' | 'generate' | 'evaluate' | 'recommend'

/** Goal lifecycle status. */
export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived'

/** Daily plan lifecycle. */
export type PlanStatus = 'pending' | 'active' | 'completed' | 'abandoned'

/** Plan item status. */
export type PlanItemStatus = 'pending' | 'completed' | 'skipped'

/** Recommendation status. */
export type RecommendationStatus = 'pending' | 'accepted' | 'dismissed' | 'expired'

/** Enrichment review status. */
export type EnrichmentStatus = 'preview' | 'accepted' | 'rejected' | 'deleted'

/** Evaluation outcome. */
export type EvaluationOutcome = 'correct' | 'partial' | 'incorrect' | 'unscored'

// ─── Value objects ──────────────────────────────────────────────────────────

/** Normalized score constrained to [0, 1]. */
export type NormalizedScore = number & { readonly __brand: 'NormalizedScore' }

/** Importance weight constrained to [0, 1]. */
export type Importance = number & { readonly __brand: 'Importance' }

/** Difficulty constrained to [0, 1]. */
export type Difficulty = number & { readonly __brand: 'Difficulty' }

/** Non-negative duration in milliseconds. */
export type DurationMs = number & { readonly __brand: 'DurationMs' }

/** Non-negative hint count. */
export type HintCount = number & { readonly __brand: 'HintCount' }

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

export interface ContentSource {
  readonly id: string
  readonly ownerUserId: string | null
  readonly domainId: string
  readonly sourceType: string
  readonly title: string
  readonly sourceUri: string | null
  readonly citation: string | null
  readonly metadata: Record<string, unknown>
  readonly createdAt: string
  readonly updatedAt: string
}

export interface LearningConcept {
  readonly id: string
  readonly ownerUserId: string | null
  readonly domainId: string
  readonly conceptKey: string
  readonly title: string
  readonly description: string | null
  readonly sourceId: string | null
  readonly metadata: Record<string, unknown>
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

export interface AnswerAttempt {
  readonly id: string
  readonly userId: string
  readonly goalId: string | null
  readonly activityId: string | null
  readonly cardId: string | null
  readonly planItemId: string | null
  readonly clientAttemptId: string
  readonly activityType: ActivityType
  readonly responseType: ResponseType
  readonly evaluatorType: EvaluatorType
  readonly response: Record<string, unknown>
  readonly normalizedScore: NormalizedScore | null
  readonly evaluatorResult: Record<string, unknown> | null
  readonly feedback: Record<string, unknown> | null
  readonly hintsUsed: HintCount
  readonly durationMs: DurationMs
  readonly evaluatorVersion: string
  readonly createdAt: string
}

export interface DailyPlan {
  readonly id: string
  readonly userId: string
  readonly goalId: string
  readonly planDate: string
  readonly timezone: string
  readonly algorithmVersion: string
  readonly inputFingerprint: string
  readonly status: PlanStatus
  readonly budgetMinutes: number
  readonly completedMinutes: number
  readonly completedItems: number
  readonly totalItems: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DailyPlanItem {
  readonly id: string
  readonly planId: string
  readonly position: number
  readonly activityId: string | null
  readonly cardId: string | null
  readonly conceptId: string | null
  readonly activityType: ActivityType
  readonly stimulusType: StimulusType
  readonly responseType: ResponseType
  readonly evaluatorType: EvaluatorType
  readonly reasonCode: string
  readonly priority: number
  readonly estimatedMinutes: number
  readonly status: PlanItemStatus
  readonly completionAttemptId: string | null
  readonly payload: Record<string, unknown>
}

export interface StudyRecommendation {
  readonly id: string
  readonly userId: string
  readonly goalId: string | null
  readonly conceptId: string | null
  readonly cardId: string | null
  readonly activityId: string | null
  readonly actionType: string
  readonly provider: 'planner' | 'ai'
  readonly reason: string
  readonly payload: Record<string, unknown>
  readonly algorithmVersion: string | null
  readonly modelVersion: string | null
  readonly promptVersion: string | null
  readonly status: RecommendationStatus
  readonly expiresAt: string | null
  readonly createdAt: string
}

export interface UserEnrichment {
  readonly id: string
  readonly userId: string
  readonly goalId: string | null
  readonly conceptId: string | null
  readonly cardId: string | null
  readonly activityId: string | null
  readonly action: EnrichmentAction
  readonly requestFingerprint: string | null
  readonly content: Record<string, unknown>
  readonly sourceRefs: ReadonlyArray<string>
  readonly modelVersion: string | null
  readonly provider: string | null
  readonly promptVersion: string | null
  readonly status: EnrichmentStatus
  readonly createdAt: string
  readonly acceptedAt: string | null
}

// ─── Structured feedback ────────────────────────────────────────────────────

export interface StructuredFeedback {
  readonly summary: string
  readonly details?: ReadonlyArray<FeedbackDetail>
}

export interface FeedbackDetail {
  readonly criterionId?: string
  readonly label: string
  readonly score?: number
  readonly maxScore?: number
  readonly comment?: string
}

// ─── Rubric ─────────────────────────────────────────────────────────────────

export interface RubricCriterion {
  readonly id: string
  readonly label: string
  readonly weight: number
  readonly maxScore: number
  readonly requiredEvidence?: string
}

export interface RubricResult {
  readonly criteria: ReadonlyArray<RubricCriterionResult>
  readonly totalScore: number
  readonly maxTotalScore: number
  readonly normalizedScore: NormalizedScore
}

export interface RubricCriterionResult {
  readonly criterionId: string
  readonly score: number
  readonly maxScore: number
  readonly comment?: string
}

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

export interface PlannerDiagnostics {
  readonly candidateCount: number
  readonly selectedCount: number
  readonly excludedUnsupported: number
  readonly reasonCodes: Readonly<Record<string, number>>
}

// ─── Goal relevance context ─────────────────────────────────────────────────

export interface GoalRelevanceContext {
  readonly goal: LearningGoal
  readonly conceptId: string | null
  readonly activityType: ActivityType
  readonly importance: Importance | null
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
}

// ─── Domain adapter ─────────────────────────────────────────────────────────

export interface ContentValidator {
  readonly id: string
  validate(content: Record<string, unknown>): ValidationResult
}

export interface PromptPolicy {
  readonly requireSourceGrounding: boolean
  readonly educationalWarning: string | null
  readonly maxPromptTokens: number
}

export interface LearningDomainAdapter {
  readonly id: string
  readonly version: string
  readonly supportedActivityTypes: readonly string[]
  readonly defaultPlanMix: Readonly<Record<string, number>>
  validateActivity(activity: LearningActivity): ValidationResult
  scoreGoalRelevance(context: GoalRelevanceContext): number
  readonly contentValidators?: readonly ContentValidator[]
  readonly promptPolicy?: PromptPolicy
}
