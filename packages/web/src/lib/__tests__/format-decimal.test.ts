/**
 * formatDecimal — the Intl-free formatter for values that are deliberately fractional.
 *
 * The bug this protects against was visible on a simulator: a plan item estimated at half a
 * minute rendered as "~0 min". The mobile app overrides i18next's `{{x, number}}` with
 * `formatCount`, which TRUNCATES — correct for a card count, a false statement for an
 * estimate. `{{x, decimal}}` exists so the two cases cannot be confused again.
 */
import { describe, it, expect } from 'vitest'
import { formatCount, formatDecimal } from '@reeeeecall/shared/lib/format-number'

describe('formatDecimal', () => {
  it('keeps the fraction that formatCount throws away', () => {
    expect(formatCount(0.5)).toBe('0')       // the old behaviour, still correct for counts
    expect(formatDecimal(0.5)).toBe('0.5')   // "~0.5 min", not "~0 min"
    expect(formatDecimal(4.2)).toBe('4.2')
  })

  it('does not add a decimal to a whole number', () => {
    // "1 min" reads better than "1.0 min", and the same string serves both cases.
    expect(formatDecimal(1)).toBe('1')
    expect(formatDecimal(20)).toBe('20')
    expect(formatDecimal(2.0)).toBe('2')
  })

  it('rounds to one place rather than truncating', () => {
    expect(formatDecimal(0.06)).toBe('0.1')
    expect(formatDecimal(0.04)).toBe('0')
    expect(formatDecimal(1.25)).toBe('1.3')
  })

  it('groups thousands, like the count formatter', () => {
    expect(formatDecimal(1234.5)).toBe('1,234.5')
    expect(formatDecimal(1234567)).toBe('1,234,567')
  })

  it('renders a real minus sign for negatives', () => {
    expect(formatDecimal(-0.5)).toBe('−0.5')
    expect(formatDecimal(-1234.5)).toBe('−1,234.5')
  })

  it('never renders NaN or Infinity to a user', () => {
    expect(formatDecimal(Number.NaN)).toBe('0')
    expect(formatDecimal(Number.POSITIVE_INFINITY)).toBe('0')
    expect(formatDecimal(Number.NEGATIVE_INFINITY)).toBe('0')
  })

  it('honours an explicit precision', () => {
    expect(formatDecimal(1.234, 2)).toBe('1.23')
    expect(formatDecimal(1.5, 0)).toBe('2')
  })
})
