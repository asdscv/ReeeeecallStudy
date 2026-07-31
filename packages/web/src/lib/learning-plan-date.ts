// ─── Plan-date helpers (web) ─────────────────────────────────────────────────
//
// A daily plan is keyed by (user, goal, plan_date) and the date has to be the one the
// USER thinks it is — a plan generated at 00:30 in Seoul is not yesterday's plan just
// because UTC disagrees. `save_daily_plan` stores the zone alongside the date, so both
// have to come from the same place.
//
// This lives in the web package, not in shared: `Intl` is deliberately avoided in
// shared code because the mobile bundle runs on an ICU-less Hermes build (see
// shared/lib/format-number). Mobile will supply its own zone in the parity phase.
import type { PlanContext } from '../stores/learning-store'

/** The browser's IANA zone, or UTC when the runtime will not say. */
export function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * `YYYY-MM-DD` for an instant in a given zone.
 * `en-CA` is used because its short date format IS ISO order; formatting to parts and
 * reassembling would be the alternative, and this is the same trick used elsewhere in
 * the web app for date keys.
 */
export function planDateFor(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/** The full context a plan write needs: zone, the user's today, and the instant. */
export function currentPlanContext(now: Date = new Date()): PlanContext {
  const timezone = resolveTimezone()
  return { timezone, planDate: planDateFor(now, timezone), now: now.toISOString() }
}
