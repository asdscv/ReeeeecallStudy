/**
 * ═══════════════════════════════════════════════════════
 * date-utils.ts — Timezone-safe date utilities
 *
 * 규칙:
 *   1. Supabase TIMESTAMPTZ → parseUTC()로 파싱 (bare ISO도 UTC 취급)
 *   2. 사용자에게 보여주는 날짜 → formatLocal*() 계열 사용
 *   3. DB 쿼리에 날짜 범위 → localDateToUTCRange() 사용
 *   4. "오늘" 날짜키 → todayDateKey()
 *   5. 차트 표시용 YYYY-MM-DD → formatDateKeyShort()
 * ═══════════════════════════════════════════════════════
 */

// ─── Core Parser ─────────────────────────────────────

/**
 * Parse a Supabase TIMESTAMPTZ string, ensuring UTC interpretation.
 *
 * Supabase may return timestamps without timezone info (e.g., '2026-02-15T06:00:00').
 * Since TIMESTAMPTZ stores UTC, we append 'Z' if no timezone indicator is present.
 */
export function parseUTC(timestamp: string): Date {
  let ts = timestamp
  // If datetime-like (has 'T') but no timezone indicator → append 'Z'
  if (ts.includes('T') && !ts.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(ts)) {
    ts += 'Z'
  }
  return new Date(ts)
}

// ─── Date Key Helpers ────────────────────────────────

/**
 * Format a Date object as a local YYYY-MM-DD string.
 */
export function dateToLocalKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Convert a Supabase UTC timestamp to a local YYYY-MM-DD string.
 */
export function utcToLocalDateKey(timestamp: string): string {
  return dateToLocalKey(parseUTC(timestamp))
}

/**
 * Get today's date as a local YYYY-MM-DD string.
 */
export function todayDateKey(): string {
  return dateToLocalKey(new Date())
}

/**
 * Convert a local YYYY-MM-DD string to a Date object (local midnight).
 * Useful for chart tick formatting and local date calculations.
 */
export function localDateKeyToDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

// ─── Query Helpers ───────────────────────────────────

/**
 * Convert a local YYYY-MM-DD to UTC ISO start/end range for Supabase queries.
 *
 * 로컬 "2026-02-15"를 선택하면:
 *   start = 로컬 2026-02-15 00:00:00 → UTC ISO
 *   end   = 로컬 2026-02-15 23:59:59.999 → UTC ISO
 */
export function localDateToUTCRange(localDate: string): { start: string; end: string } {
  const [year, month, day] = localDate.split('-').map(Number)
  const start = new Date(year, month - 1, day, 0, 0, 0, 0)
  const end = new Date(year, month - 1, day, 23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

/**
 * Get an ISO UTC string for N days ago (for Supabase range queries).
 */
export function daysAgoUTC(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

/**
 * Check if a Supabase UTC timestamp is in the past (≤ now).
 */
export function isPast(timestamp: string): boolean {
  return parseUTC(timestamp).getTime() <= Date.now()
}

// ─── Display Formatters ──────────────────────────────

/**
 * Format a Supabase UTC timestamp as a localized date string.
 * e.g., "2/15/2026" (en-US) or "2026. 2. 15." (ko-KR)
 */
export function formatLocalDate(timestamp: string, locale = 'en-US'): string {
  return parseUTC(timestamp).toLocaleDateString(locale)
}

/**
 * Format a Supabase UTC timestamp as a localized time string.
 * e.g., "3:30 PM" (en-US) or "오후 3:30" (ko-KR)
 */
export function formatLocalTime(
  timestamp: string,
  locale = 'en-US',
  options?: Intl.DateTimeFormatOptions,
): string {
  return parseUTC(timestamp).toLocaleTimeString(locale, options)
}

/**
 * Format a Supabase UTC timestamp as a localized date+time string.
 */
export function formatLocalDateTime(timestamp: string, locale = 'en-US'): string {
  return parseUTC(timestamp).toLocaleString(locale)
}

/**
 * Format a Supabase UTC timestamp as a relative time string using Intl.RelativeTimeFormat.
 * e.g., "3 hours ago" (en-US) or "3시간 전" (ko-KR), or localized date for 30+ days.
 */
export function formatRelativeTime(timestamp: string, locale = 'en-US'): string {
  const d = parseUTC(timestamp)
  const now = Date.now()
  const diffMs = now - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (diffMin < 1) return rtf.format(0, 'second')
  if (diffMin < 60) return rtf.format(-diffMin, 'minute')

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return rtf.format(-diffHour, 'hour')

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return rtf.format(-diffDay, 'day')

  return d.toLocaleDateString(locale)
}

/**
 * Format a YYYY-MM-DD date key as short "M/D" string (for chart ticks).
 * e.g., "2026-02-15" → "2/15"
 */
export function formatDateKeyShort(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number)
  return `${month}/${day}`
}
