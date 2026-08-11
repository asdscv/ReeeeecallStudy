/**
 * `custom` is deliberately NOT in `TIME_PERIOD_OPTIONS`.
 *
 * That list is what `TimePeriodTabs` renders, and it is shared with the dashboard and the
 * deck page, which have no date pickers. Adding it there would put a chip on two screens that
 * cannot act on it; a screen opts in by passing the range props instead.
 */
export type TimePeriod = '1d' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'custom'

/** Inclusive, in `YYYY-MM-DD` local date keys — the same shape the charts group by. */
export interface DateRange {
  from: string
  to: string
}

export const TIME_PERIOD_OPTIONS: { value: TimePeriod; days: number }[] = [
  { value: '1d', days: 1 },
  { value: '1w', days: 7 },
  { value: '1m', days: 30 },
  { value: '3m', days: 90 },
  { value: '6m', days: 180 },
  { value: '1y', days: 365 },
  { value: '2y', days: 730 },
  { value: '5y', days: 1825 },
]

const PERIOD_DAYS_MAP = new Map(TIME_PERIOD_OPTIONS.map((o) => [o.value, o.days]))

export function periodToDays(period: TimePeriod): number {
  return PERIOD_DAYS_MAP.get(period) ?? 30
}

export function shouldShowHeatmap(period: TimePeriod): boolean {
  return period !== '1d' && period !== '1w'
}

/** Local `YYYY-MM-DD`, matching how the charts key their days. */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The window a period actually selects, as instants.
 *
 * Every preset means "the last N days ENDING TODAY", which the old `days` number expressed
 * implicitly. A custom range has two ends, so the window has to become a pair — and once it
 * is a pair, the presets can be described by it too, which keeps one filter instead of two.
 *
 * Both ends are inclusive of the whole local day: `from` at 00:00 and `to` at 23:59:59.999,
 * because a learner picking 8월 6일 as the end means all of the 6th, not up to its midnight.
 */
export function resolveRange(
  period: TimePeriod,
  custom: DateRange | null,
  now: Date = new Date(),
): { fromMs: number; toMs: number } | null {
  if (period === 'custom') {
    if (!custom?.from || !custom?.to) return null
    // Reversed input is a slip, not an error: swap the DATES, then build the boundaries.
    // Swapping the resolved instants instead would put 00:00 on the later day and 23:59 on
    // the earlier one — both ends wrong, and the window a day short at each edge.
    const [lo, hi] = custom.from <= custom.to
      ? [custom.from, custom.to]
      : [custom.to, custom.from]
    const from = new Date(`${lo}T00:00:00`)
    const to = new Date(`${hi}T23:59:59.999`)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
    return { fromMs: from.getTime(), toMs: to.getTime() }
  }

  const to = new Date(now)
  to.setHours(23, 59, 59, 999)
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - periodToDays(period) + 1)
  return { fromMs: from.getTime(), toMs: to.getTime() }
}

/** Whole days in a resolved window, inclusive — what the charts use to space their ticks. */
export function rangeDays(range: { fromMs: number; toMs: number }): number {
  return Math.max(1, Math.round((range.toMs - range.fromMs) / 86_400_000))
}
