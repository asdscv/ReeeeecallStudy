export type TimePeriod = '1d' | '1w' | '1m' | '3m' | '6m' | '1y'

export const TIME_PERIOD_OPTIONS: { value: TimePeriod; label: string }[] = [
  { value: '1d', label: '1일' },
  { value: '1w', label: '1주' },
  { value: '1m', label: '1개월' },
  { value: '3m', label: '3개월' },
  { value: '6m', label: '6개월' },
  { value: '1y', label: '1년' },
]

export function periodToDays(period: TimePeriod): number {
  switch (period) {
    case '1d': return 1
    case '1w': return 7
    case '1m': return 30
    case '3m': return 90
    case '6m': return 180
    case '1y': return 365
  }
}

export function shouldShowHeatmap(period: TimePeriod): boolean {
  return period !== '1d' && period !== '1w'
}
