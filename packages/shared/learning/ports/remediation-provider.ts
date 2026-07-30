/**
 * RemediationProvider port contract.
 *
 * Design §11: AI remediation and enrichment port. The core only knows this contract;
 * infrastructure adapters connect to actual AI providers.
 * No framework/Supabase/Zustand imports.
 */

import type { EnrichmentAction } from '../domain/types.ts'
import type { Result } from '../domain/result.ts'
import type { LearningError } from '../domain/errors.ts'

// ─── Remediation request ────────────────────────────────────────────────────

export interface RemediationRequest {
  readonly action: EnrichmentAction
  readonly userId: string
  readonly goalId: string | null
  readonly activityId: string | null
  readonly cardIds: readonly string[]
  readonly conceptIds: readonly string[]
  readonly attemptId: string | null
  readonly count: number | null
  readonly uiLang: string
  /** Server-fetched context for prompt construction. */
  readonly context: RemediationContext
}

export interface RemediationContext {
  readonly goalTitle: string | null
  readonly conceptTitles: readonly string[]
  readonly activityStimulus: Record<string, unknown> | null
  readonly recentAttempts: readonly RemediationAttemptSummary[]
  readonly sourceRefs: readonly RemediationSourceRef[]
}

export interface RemediationAttemptSummary {
  readonly normalizedScore: number | null
  readonly outcome: string
  readonly feedback: Record<string, unknown> | null
  readonly createdAt: string
}

export interface RemediationSourceRef {
  readonly sourceId: string
  readonly title: string
  readonly citation: string | null
}

// ─── Remediation result ─────────────────────────────────────────────────────

export interface RemediationResult {
  readonly action: EnrichmentAction
  readonly summary: string
  readonly blocks: readonly RemediationBlock[]
  readonly citations: readonly RemediationCitation[]
  readonly confidence: number | null
  readonly warnings: readonly string[]
  readonly modelVersion: string
  readonly providerVersion: string
  readonly promptVersion: string
  readonly tokenCost: TokenCostInfo
}

export interface RemediationBlock {
  readonly type: string
  readonly content: unknown
}

export interface RemediationCitation {
  readonly sourceId: string
  readonly locator: string | null
}

export interface TokenCostInfo {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

// ─── Port interface ─────────────────────────────────────────────────────────

export interface RemediationProvider {
  /**
   * Generate remediation content for the given request.
   * The provider handles prompt construction, AI call, and result validation.
   */
  generate(request: RemediationRequest): Promise<Result<RemediationResult, LearningError>>

  /**
   * Evaluate a user's response using AI.
   * Used by the AI evaluator adapter.
   */
  evaluate(request: RemediationRequest): Promise<Result<RemediationResult, LearningError>>
}
