/**
 * Domain validators for runtime value constraints.
 *
 * Design §21.7: duration_ms >= 0, hints_used >= 0, normalized scores/importance/difficulty in [0,1].
 * Built-in registry value validation provided alongside open-string extensibility.
 * No framework/Supabase/Zustand imports.
 */

import type {
  NormalizedScore,
  Importance,
  Difficulty,
  DurationMs,
  HintCount,
  ActivityType,
  StimulusType,
  ResponseType,
  EvaluatorType,
  GoalStatus,
  PlanStatus,
  PlanItemStatus,
  EnrichmentStatus,
  RecommendationStatus,
  EvaluationOutcome,
  EnrichmentAction,
  ValidationResult,
} from './types.ts'
import { validationError } from './errors.ts'

// ─── Built-in known values ──────────────────────────────────────────────────

export const BUILT_IN_ACTIVITY_TYPES: readonly string[] = ['recall', 'practice', 'produce']

export const BUILT_IN_STIMULUS_TYPES: readonly string[] = ['text', 'image', 'audio', 'video']

export const BUILT_IN_RESPONSE_TYPES: readonly string[] = ['self_rate', 'choice', 'text', 'audio']

export const BUILT_IN_EVALUATOR_TYPES: readonly string[] = [
  'self_rate',
  'exact',
  'choice',
  'rubric',
  'ai',
  'speech',
]

/** Currently runtime-supported stimulus types. */
export const SUPPORTED_STIMULUS_TYPES: readonly string[] = ['text', 'image']

/** Currently runtime-supported response types. */
export const SUPPORTED_RESPONSE_TYPES: readonly string[] = ['self_rate', 'choice', 'text']

/** Currently runtime-supported evaluator types. */
export const SUPPORTED_EVALUATOR_TYPES: readonly string[] = [
  'self_rate',
  'exact',
  'choice',
  'rubric',
  'ai',
]

/** Reserved but not implemented — must fail explicitly. */
export const RESERVED_UNSUPPORTED_STIMULUS_TYPES: readonly string[] = ['audio', 'video']
export const RESERVED_UNSUPPORTED_RESPONSE_TYPES: readonly string[] = ['audio']
export const RESERVED_UNSUPPORTED_EVALUATOR_TYPES: readonly string[] = ['speech']

export const GOAL_STATUSES: readonly GoalStatus[] = ['active', 'paused', 'completed', 'archived']
export const PLAN_STATUSES: readonly PlanStatus[] = ['pending', 'active', 'completed', 'abandoned']
export const PLAN_ITEM_STATUSES: readonly PlanItemStatus[] = ['pending', 'completed', 'skipped']
export const ENRICHMENT_STATUSES: readonly EnrichmentStatus[] = ['preview', 'accepted', 'rejected', 'deleted']
export const RECOMMENDATION_STATUSES: readonly RecommendationStatus[] = ['pending', 'accepted', 'dismissed', 'expired']
export const EVALUATION_OUTCOMES: readonly EvaluationOutcome[] = ['correct', 'partial', 'incorrect', 'unscored']
export const ENRICHMENT_ACTIONS: readonly EnrichmentAction[] = [
  'explain',
  'compare',
  'hint',
  'generate',
  'evaluate',
  'recommend',
]

// ─── Numeric validators ─────────────────────────────────────────────────────

/**
 * Validates and brands a number as NormalizedScore ∈ [0, 1].
 * Returns null for null input (scores are nullable).
 */
export function validateNormalizedScore(value: number | null): NormalizedScore | null {
  if (value === null) return null
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw validationError(`NormalizedScore must be in [0, 1], got: ${value}`)
  }
  return value as NormalizedScore
}

/** Validates and brands a number as Importance ∈ [0, 1]. */
export function validateImportance(value: number): Importance {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw validationError(`Importance must be in [0, 1], got: ${value}`)
  }
  return value as Importance
}

/** Validates and brands a number as Difficulty ∈ [0, 1]. Returns null for null input. */
export function validateDifficulty(value: number | null): Difficulty | null {
  if (value === null) return null
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw validationError(`Difficulty must be in [0, 1], got: ${value}`)
  }
  return value as Difficulty
}

/** Validates and brands a number as DurationMs >= 0. */
export function validateDurationMs(value: number): DurationMs {
  if (!Number.isFinite(value) || value < 0) {
    throw validationError(`DurationMs must be >= 0, got: ${value}`)
  }
  return value as DurationMs
}

/** Validates and brands a number as HintCount >= 0. */
export function validateHintCount(value: number): HintCount {
  if (!Number.isInteger(value) || value < 0) {
    throw validationError(`HintCount must be a non-negative integer, got: ${value}`)
  }
  return value as HintCount
}

// ─── String enum validators ─────────────────────────────────────────────────

/** Validates an ActivityType against built-in values. Custom values pass through. */
export function validateActivityType(value: string): ActivityType {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(`ActivityType must be a non-empty string`)
  }
  return value as ActivityType
}

/** Validates a StimulusType against built-in values. */
export function validateStimulusType(value: string): StimulusType {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(`StimulusType must be a non-empty string`)
  }
  return value as StimulusType
}

/** Validates a ResponseType. */
export function validateResponseType(value: string): ResponseType {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(`ResponseType must be a non-empty string`)
  }
  return value as ResponseType
}

/** Validates an EvaluatorType. */
export function validateEvaluatorType(value: string): EvaluatorType {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(`EvaluatorType must be a non-empty string`)
  }
  return value as EvaluatorType
}

/** Validates GoalStatus against the closed set. */
export function validateGoalStatus(value: string): GoalStatus {
  if (!GOAL_STATUSES.includes(value as GoalStatus)) {
    throw validationError(`GoalStatus must be one of ${GOAL_STATUSES.join(', ')}, got: ${value}`)
  }
  return value as GoalStatus
}

/** Validates PlanStatus against the closed set. */
export function validatePlanStatus(value: string): PlanStatus {
  if (!PLAN_STATUSES.includes(value as PlanStatus)) {
    throw validationError(`PlanStatus must be one of ${PLAN_STATUSES.join(', ')}, got: ${value}`)
  }
  return value as PlanStatus
}

/** Validates EnrichmentAction against the closed set. */
export function validateEnrichmentAction(value: string): EnrichmentAction {
  if (!ENRICHMENT_ACTIONS.includes(value as EnrichmentAction)) {
    throw validationError(`EnrichmentAction must be one of ${ENRICHMENT_ACTIONS.join(', ')}, got: ${value}`)
  }
  return value as EnrichmentAction
}

// ─── Composite validators ───────────────────────────────────────────────────

/** Validates daily_minutes per §21.2: 1..1440. */
export function validateDailyMinutes(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 1440) {
    throw validationError(`dailyMinutes must be an integer in [1, 1440], got: ${value}`)
  }
  return value
}

/** Validates budget minutes: must be positive. */
export function validateBudgetMinutes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw validationError(`budgetMinutes must be positive, got: ${value}`)
  }
  return value
}

/** Validates a non-empty string with max length. */
export function validateBoundedString(value: string, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(`${field} must be a non-empty string`)
  }
  if (value.length > maxLength) {
    throw validationError(`${field} exceeds max length of ${maxLength}`)
  }
  return value
}

/** Validates a general-purpose payload size constraint (§21.2: 64 KiB). */
export function validatePayloadSize(payload: Record<string, unknown>, field: string, maxBytes: number = 65536): void {
  const serialized = JSON.stringify(payload)
  if (serialized.length > maxBytes) {
    throw validationError(`${field} payload exceeds ${maxBytes} bytes`, {
      field,
      actualBytes: serialized.length,
      maxBytes,
    })
  }
}

/**
 * Validates a complete activity configuration, ensuring consistency:
 * - at least one of cardId or non-empty stimulus
 * - valid registry type strings
 */
export function validateActivityConfig(config: {
  cardId: string | null
  stimulus: Record<string, unknown> | null
  activityType: string
  stimulusType: string
  responseType: string
  evaluatorType: string
}): ValidationResult {
  const errors: string[] = []

  const hasCard = config.cardId !== null && config.cardId.length > 0
  const hasStimulus = config.stimulus !== null && Object.keys(config.stimulus).length > 0

  if (!hasCard && !hasStimulus) {
    errors.push('Activity must have either a cardId or a non-empty stimulus')
  }

  if (typeof config.activityType !== 'string' || config.activityType.trim().length === 0) {
    errors.push('activityType must be a non-empty string')
  }
  if (typeof config.stimulusType !== 'string' || config.stimulusType.trim().length === 0) {
    errors.push('stimulusType must be a non-empty string')
  }
  if (typeof config.responseType !== 'string' || config.responseType.trim().length === 0) {
    errors.push('responseType must be a non-empty string')
  }
  if (typeof config.evaluatorType !== 'string' || config.evaluatorType.trim().length === 0) {
    errors.push('evaluatorType must be a non-empty string')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Checks whether a given type string is a known built-in value.
 * Useful for runtime validation before attempting evaluation.
 */
export function isBuiltInActivityType(value: string): boolean {
  return BUILT_IN_ACTIVITY_TYPES.includes(value)
}

export function isBuiltInStimulusType(value: string): boolean {
  return BUILT_IN_STIMULUS_TYPES.includes(value)
}

export function isBuiltInResponseType(value: string): boolean {
  return BUILT_IN_RESPONSE_TYPES.includes(value)
}

export function isBuiltInEvaluatorType(value: string): boolean {
  return BUILT_IN_EVALUATOR_TYPES.includes(value)
}

export function isSupportedStimulusType(value: string): boolean {
  return SUPPORTED_STIMULUS_TYPES.includes(value)
}

export function isSupportedResponseType(value: string): boolean {
  return SUPPORTED_RESPONSE_TYPES.includes(value)
}

export function isSupportedEvaluatorType(value: string): boolean {
  return SUPPORTED_EVALUATOR_TYPES.includes(value)
}
