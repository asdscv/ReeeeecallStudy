/**
 * Domain error types for the modular learning engine.
 *
 * Typed errors enable exhaustive handling without leaking infrastructure details.
 * No framework/Supabase/Zustand imports.
 */

// ─── Error codes ────────────────────────────────────────────────────────────

export type LearningErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'CONFLICT'
  | 'STALE_STATE'
  | 'DUPLICATE'
  | 'UNSUPPORTED_CAPABILITY'
  | 'BUDGET_EXHAUSTED'
  | 'QUOTA_EXCEEDED'
  | 'PROVIDER_ERROR'
  | 'INVALID_REGISTRY_ID'
  | 'DUPLICATE_REGISTRATION'
  | 'PERSISTENCE_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'

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

export function validationError(message: string, details?: Record<string, unknown>): LearningError {
  return new LearningError('VALIDATION_ERROR', message, details)
}

export function notFoundError(entity: string, id: string): LearningError {
  return new LearningError('NOT_FOUND', `${entity} not found: ${id}`, { entity, id })
}

export function unauthorizedError(message: string): LearningError {
  return new LearningError('UNAUTHORIZED', message)
}

export function conflictError(message: string, details?: Record<string, unknown>): LearningError {
  return new LearningError('CONFLICT', message, details)
}

export function staleStateError(message: string, details?: Record<string, unknown>): LearningError {
  return new LearningError('STALE_STATE', message, details)
}

export function duplicateError(message: string, details?: Record<string, unknown>): LearningError {
  return new LearningError('DUPLICATE', message, details)
}

export function unsupportedCapabilityError(capability: string, type: string): LearningError {
  return new LearningError(
    'UNSUPPORTED_CAPABILITY',
    `Unsupported ${capability}: ${type}. Register an adapter before use.`,
    { capability, type },
  )
}

export function quotaExceededError(resource: string, limit: number): LearningError {
  return new LearningError('QUOTA_EXCEEDED', `Quota exceeded for ${resource} (limit: ${limit})`, {
    resource,
    limit,
  })
}

export function duplicateRegistrationError(registryName: string, id: string): LearningError {
  return new LearningError(
    'DUPLICATE_REGISTRATION',
    `Duplicate registration in ${registryName}: "${id}"`,
    { registryName, id },
  )
}

export function invalidRegistryIdError(registryName: string, id: string): LearningError {
  return new LearningError(
    'INVALID_REGISTRY_ID',
    `Unknown id in ${registryName}: "${id}"`,
    { registryName, id },
  )
}

export function persistenceError(message: string, details?: Record<string, unknown>): LearningError {
  return new LearningError('PERSISTENCE_ERROR', message, details)
}

export function providerError(message: string, details?: Record<string, unknown>): LearningError {
  return new LearningError('PROVIDER_ERROR', message, details)
}
