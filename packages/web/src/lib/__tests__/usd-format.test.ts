import { describe, it, expect } from 'vitest'
import { formatUsdMicro, formatCount } from '@reeeeecall/shared/lib/ai/server-client'
import { formatProductPrice } from '@reeeeecall/shared/lib/pricing'

// Regression guard for thousands grouping. Both helpers group WITHOUT Intl on purpose:
// toLocaleString('en-US', …) silently drops separators on a Hermes build without full
// ICU, which is how a wallet balance shipped to the UI as "$1000000.00". Asserting the
// exact strings keeps anyone from "simplifying" back to toLocaleString.
describe('formatUsdMicro', () => {
  it('groups thousands in large balances', () => {
    expect(formatUsdMicro(1_000_000_000_000)).toBe('$1,000,000.00')
    expect(formatUsdMicro(999_998_520_000)).toBe('$999,998.52')
  })

  it('leaves sub-1000 amounts ungrouped', () => {
    expect(formatUsdMicro(1_480_000)).toBe('$1.48')
    expect(formatUsdMicro(0)).toBe('$0.00')
  })

  it('keeps 4 decimals below a cent so tiny spends never floor to $0.00', () => {
    expect(formatUsdMicro(600)).toBe('$0.0006')
  })

  it('prefixes a sign for ledger deltas', () => {
    expect(formatUsdMicro(-990_000, { sign: true })).toBe('−$0.99')
    expect(formatUsdMicro(990_000, { sign: true })).toBe('+$0.99')
  })
})

describe('formatCount', () => {
  it('groups plain counts', () => {
    expect(formatCount(771)).toBe('771')
    expect(formatCount(3_000)).toBe('3,000')
    expect(formatCount(100_000)).toBe('100,000')
    expect(formatCount(675_219_445)).toBe('675,219,445')
  })

  it('handles zero and negatives', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(-1_234)).toBe('−1,234')
  })

  it('never leaks a non-finite value into the UI', () => {
    expect(formatCount(NaN)).toBe('0')
    expect(formatCount(Infinity)).toBe('0')
  })
})

// formatProductPrice renders on the MOBILE paywall/plan cards too, so it carries the same
// Intl-free requirement as the helpers above — it used to call toLocaleString('en-US', …).
describe('formatProductPrice', () => {
  it('groups thousands without Intl', () => {
    expect(formatProductPrice({ priceKrw: 0, priceUsdCents: 1_234_567_89 })).toBe('$1,234,567.89')
    expect(formatProductPrice({ priceKrw: 0, priceUsdCents: 1_999 })).toBe('$19.99')
  })

  it('always shows exactly two decimals', () => {
    expect(formatProductPrice({ priceKrw: 0, priceUsdCents: 500 })).toBe('$5.00')
  })

  it('falls back to grouped ₩ when a row has no USD price', () => {
    expect(formatProductPrice({ priceKrw: 1_500_000, priceUsdCents: null })).toBe('₩1,500,000')
  })
})

/**
 * Two decimals for whole cents, four when there is more to say.
 *
 * The wallet showed "$1,000,000.00" while the spend beside it showed "−$0.0012": the balance
 * could not be seen to move by the amount that had just left it. The rule used to be "under a
 * cent gets four decimals", which is not the same question — $12.3456 is well over a cent and
 * was still being rounded away.
 */
describe('decimals follow the amount, not its size', () => {
  it('keeps whole cents at two', () => {
    expect(formatUsdMicro(1_000_000_000_000)).toBe('$1,000,000.00')
    expect(formatUsdMicro(100_000)).toBe('$0.10')   // one AI card since mig 230
    expect(formatUsdMicro(400_000)).toBe('$0.40')   // one essay grading
    expect(formatUsdMicro(0)).toBe('$0.00')
  })

  it('shows four when the amount is not a whole cent', () => {
    expect(formatUsdMicro(1_200)).toBe('$0.0012')
    expect(formatUsdMicro(12_345_600)).toBe('$12.3456')
    // The case the old rule got wrong: over a cent, so it took the two-decimal branch and
    // rounded a real difference out of existence.
    expect(formatUsdMicro(123_400)).toBe('$0.1234')
  })

  it('still signs a ledger delta', () => {
    expect(formatUsdMicro(-1_200, { sign: true })).toBe('−$0.0012')
    expect(formatUsdMicro(100_000, { sign: true })).toBe('+$0.10')
  })
})
