import { describe, it, expect } from 'vitest'
import {
  periodToDays,
  shouldShowHeatmap,
  TIME_PERIOD_OPTIONS,
  type TimePeriod,
} from '../time-period'

describe('periodToDays', () => {
  it.each<[TimePeriod, number]>([
    ['1d', 1],
    ['1w', 7],
    ['1m', 30],
    ['3m', 90],
    ['6m', 180],
    ['1y', 365],
  ])('maps %s → %d', (period, expected) => {
    expect(periodToDays(period)).toBe(expected)
  })
})

describe('shouldShowHeatmap', () => {
  it('returns false for 1d and 1w', () => {
    expect(shouldShowHeatmap('1d')).toBe(false)
    expect(shouldShowHeatmap('1w')).toBe(false)
  })

  it('returns true for 1m, 3m, 6m, 1y', () => {
    expect(shouldShowHeatmap('1m')).toBe(true)
    expect(shouldShowHeatmap('3m')).toBe(true)
    expect(shouldShowHeatmap('6m')).toBe(true)
    expect(shouldShowHeatmap('1y')).toBe(true)
  })
})

describe('TIME_PERIOD_OPTIONS', () => {
  it('has 6 options', () => {
    expect(TIME_PERIOD_OPTIONS).toHaveLength(6)
  })

  it('each option has value and label', () => {
    for (const opt of TIME_PERIOD_OPTIONS) {
      expect(opt.value).toBeTruthy()
      expect(opt.label).toBeTruthy()
    }
  })
})
