// ── Intl-free number formatting ─────────────────────────────────────────────
// React Native's Hermes can ship WITHOUT full ICU. On such a build every Intl-backed
// formatter — `toLocaleString`, and i18next's `{{n, number}}` (which routes through
// Intl.NumberFormat) — SILENTLY drops thousands separators. No throw, no warning: a
// wallet balance just reaches the UI as "$1000000.00".
//
// Everything here is plain string/regex work, so it behaves identically on web, on a
// full-ICU Hermes build, and on an ICU-less one. Prefer these over `toLocaleString()`
// for any number a user reads on mobile.

/**
 * Comma-group the integer part of an already-formatted decimal string.
 * `"1234567.89"` → `"1,234,567.89"`. A fractional part, if present, is left alone.
 */
export function groupThousands(s: string): string {
  const dot = s.indexOf('.')
  const int = dot < 0 ? s : s.slice(0, dot)
  const frac = dot < 0 ? '' : s.slice(dot)
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac
}

/**
 * Comma-group a plain count (card counts, quotas, XP). Truncates to an integer and
 * renders a leading minus for negatives. Non-finite/nullish input renders `"0"`.
 */
export function formatCount(n: number): string {
  const v = Math.trunc(Number.isFinite(n) ? n : 0)
  return (v < 0 ? '−' : '') + groupThousands(String(Math.abs(v)))
}
