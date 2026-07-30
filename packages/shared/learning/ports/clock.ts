/**
 * Clock port contract.
 *
 * Design §9.4: The planner uses the supplied clock only; tests use a fake clock.
 * No framework/Supabase/Zustand imports.
 */

export interface Clock {
  /** Returns the current time as an ISO 8601 string. */
  now(): string
}

/**
 * System clock implementation using Date.now().
 * Use FakeClock in tests for determinism.
 */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }
}
