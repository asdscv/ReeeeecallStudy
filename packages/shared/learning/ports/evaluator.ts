/**
 * Evaluator port contract.
 *
 * Design §10.1: The evaluator interface is a port that deterministic and AI implementations share.
 * No framework/Supabase/Zustand imports.
 */

import type {
  NormalizedScore,
  EvaluationOutcome,
  StructuredFeedback,
  RubricResult,
  EvaluatorType,
  ActivityType,
  ResponseType,
} from '../domain/types.ts'

// ─── Evaluation input ───────────────────────────────────────────────────────

export interface EvaluationInput {
  readonly activityType: ActivityType
  readonly responseType: ResponseType
  readonly evaluatorType: EvaluatorType
  /** The user's response payload. */
  readonly response: Record<string, unknown>
  /** Expected response / correct answer (from activity config). */
  readonly expectedResponse: Record<string, unknown> | null
  /** Rubric criteria (for rubric evaluator). */
  readonly rubric: Record<string, unknown> | null
  /** Activity-specific evaluator config. */
  readonly config: Record<string, unknown>
}

// ─── Evaluation result ──────────────────────────────────────────────────────

export interface EvaluationResult {
  readonly normalizedScore: NormalizedScore | null
  readonly outcome: EvaluationOutcome
  readonly feedback: StructuredFeedback
  readonly rubricResult?: RubricResult
  readonly evaluatorType: string
  readonly evaluatorVersion: string
}

// ─── Evaluator interface ────────────────────────────────────────────────────

export interface Evaluator {
  readonly type: string
  readonly version: string
  evaluate(input: EvaluationInput): Promise<EvaluationResult> | EvaluationResult
}
