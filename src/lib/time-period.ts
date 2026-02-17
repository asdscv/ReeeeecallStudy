export type TimePeriod = '1d' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '5y'

export const TIME_PERIOD_OPTIONS: { value: TimePeriod; label: string; days: number }[] = [
  { value: '1d', label: '1일', days: 1 },
  { value: '1w', label: '1주', days: 7 },
  { value: '1m', label: '1개월', days: 30 },
  { value: '3m', label: '3개월', days: 90 },
  { value: '6m', label: '6개월', days: 180 },
  { value: '1y', label: '1년', days: 365 },
  { value: '2y', label: '2년', days: 730 },
  { value: '5y', label: '5년', days: 1825 },
]

const PERIOD_DAYS_MAP = new Map(TIME_PERIOD_OPTIONS.map((o) => [o.value, o.days]))

export function periodToDays(period: TimePeriod): number {
  return PERIOD_DAYS_MAP.get(period) ?? 30
}

export function shouldShowHeatmap(period: TimePeriod): boolean {
  return period !== '1d' && period !== '1w'
}
