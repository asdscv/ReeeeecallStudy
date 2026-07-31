// ─── Plan-date helpers (shared, Intl-optional) ───────────────────────────────
//
// A daily plan is keyed by (user, goal, plan_date), and the date has to be the one the USER
// thinks it is: a plan generated at 00:30 in Seoul is not yesterday's plan just because UTC
// disagrees. `save_daily_plan` stores the zone next to the date, so both have to come from
// the same place.
//
// WHY THIS IS IN SHARED NOW. Phase 1 put it in the web package because it used `Intl`, which
// shared code avoids — the mobile bundle runs on a Hermes build without full ICU, and that is
// exactly how "$1000000.00" once shipped to the wallet (see lib/format-number). Mobile needs
// the same plan date, so the logic moved here and was split in two:
//
//   * the DATE is computed from `Date`'s LOCAL getters — getFullYear/getMonth/getDate are
//     local-time based and need no ICU at all. This is the part that must be right, because
//     it decides which day's plan the user is looking at.
//   * the ZONE NAME is a label stored for the record. `Intl` is tried and, if it is missing
//     or throws (an ICU-less build), we fall back to the device's actual UTC offset. An
//     offset label is honest — it says what was used — whereas defaulting to "UTC" would
//     record a zone the user is not in.
export interface PlanDateContext {
  /** IANA zone when the runtime knows it, else a `UTC±HH:MM` offset label. */
  timezone: string
  /** `YYYY-MM-DD` as the device's local calendar sees it. */
  planDate: string
  /** ISO instant, injected in tests so a plan is reproducible. */
  now: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * `YYYY-MM-DD` for an instant in the DEVICE'S local calendar.
 *
 * Deliberately not `toISOString().slice(0, 10)` (that is UTC and would roll the day over at
 * the wrong moment) and not `toLocaleDateString` (Intl).
 */
export function localPlanDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The device's UTC offset as a label, e.g. `UTC+09:00`.
 *
 * `getTimezoneOffset()` returns minutes to ADD to local time to reach UTC, so its sign is
 * inverted relative to how offsets are written: Seoul reports -540 and is written +09:00.
 */
export function utcOffsetLabel(now: Date): string {
  const minutes = -now.getTimezoneOffset()
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** IANA zone if the runtime can say, else the offset label. Never empty (the RPC rejects ''). */
export function resolveTimezoneLabel(now: Date = new Date()): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone) return zone
  } catch {
    /* ICU-less build: fall through to the offset label */
  }
  return utcOffsetLabel(now)
}

/** Everything a plan write needs: the user's today, the zone label, and the instant. */
export function currentPlanContext(now: Date = new Date()): PlanDateContext {
  return {
    timezone: resolveTimezoneLabel(now),
    planDate: localPlanDate(now),
    now: now.toISOString(),
  }
}
