/**
 * Result type for domain operations.
 *
 * A discriminated union that forces callers to handle both success and failure paths.
 * No framework/Supabase/Zustand imports.
 */

import type { LearningError } from './errors.ts'

// ─── Result type ────────────────────────────────────────────────────────────

export type Result<T, E = LearningError> = Success<T> | Failure<E>

export interface Success<T> {
  readonly ok: true
  readonly value: T
}

export interface Failure<E = LearningError> {
  readonly ok: false
  readonly error: E
}

// ─── Constructors ───────────────────────────────────────────────────────────

export function ok<T>(value: T): Success<T> {
  return { ok: true, value }
}

export function fail<E = LearningError>(error: E): Failure<E> {
  return { ok: false, error }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Unwrap a Result, throwing the error if it failed. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value
  throw result.error
}

/** Map the success value of a Result. */
export function mapResult<T, U, E = LearningError>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  if (result.ok) return ok(fn(result.value))
  return result
}
