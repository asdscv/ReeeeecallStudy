/**
 * Domain error types for the learning engine.
 *
 * Typed errors enable exhaustive handling without leaking infrastructure details.
 * No framework/Supabase/Zustand imports.
 *
 * Nine further factories lived here — `notFoundError`, `unauthorizedError`, `conflictError`,
 * `staleStateError`, `duplicateError`, `unsupportedCapabilityError`, `quotaExceededError`,
 * `persistenceError`, `providerError` — with no caller anywhere. They described the failure
 * modes of a repository/port layer that was never wired to Supabase, and they went with it.
 * Add one back alongside the `throw` that needs it.
 */

// ─── Error codes ────────────────────────────────────────────────────────────

export type LearningErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_REGISTRY_ID'
  | 'DUPLICATE_REGISTRATION'

// ─── Base error ─────────────────────────────────────────────────────────────

export class LearningError extends Error {
  readonly code: LearningErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: LearningErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'LearningError'
    this.code = code
    this.details = details
    // Maintain prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─── Specialized error factories ────────────────────────────────────────────

/** Thrown by `buildDailyPlan` for a malformed activity mix, budget, or timestamp. */
export function validationError(message: string, details?: Record<string, unknown>): LearningError {
  return new LearningError('VALIDATION_ERROR', message, details)
}

/** Thrown by `LearningDomainRegistry.register` on a repeat id. */
export function duplicateRegistrationError(registryName: string, id: string): LearningError {
  return new LearningError(
    'DUPLICATE_REGISTRATION',
    `Duplicate registration in ${registryName}: "${id}"`,
    { registryName, id },
  )
}

/** Thrown by `LearningDomainRegistry.get` for an id this build does not ship. */
export function invalidRegistryIdError(registryName: string, id: string): LearningError {
  return new LearningError(
    'INVALID_REGISTRY_ID',
    `Unknown id in ${registryName}: "${id}"`,
    { registryName, id },
  )
}
