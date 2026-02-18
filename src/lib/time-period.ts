export type TimePeriod = '1d' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '5y'

export const TIME_PERIOD_OPTIONS: { value: TimePeriod; label: string; days: number }[] = [
  { value: '1d', label: 'common:timePeriod.oneDay', days: 1 },
  { value: '1w', label: 'common:timePeriod.oneWeek', days: 7 },
  { value: '1m', label: 'common:timePeriod.oneMonth', days: 30 },
  { value: '3m', label: 'common:timePeriod.threeMonths', days: 90 },
  { value: '6m', label: 'common:timePeriod.sixMonths', days: 180 },
  { value: '1y', label: 'common:timePeriod.oneYear', days: 365 },
  { value: '2y', label: 'common:timePeriod.twoYears', days: 730 },
  { value: '5y', label: 'common:timePeriod.fiveYears', days: 1825 },
]

const PERIOD_DAYS_MAP = new Map(TIME_PERIOD_OPTIONS.map((o) => [o.value, o.days]))

export function periodToDays(period: TimePeriod): number {
  return PERIOD_DAYS_MAP.get(period) ?? 30
}

export function shouldShowHeatmap(period: TimePeriod): boolean {
  return period !== '1d' && period !== '1w'
}
