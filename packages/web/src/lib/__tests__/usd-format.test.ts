import { describe, it, expect } from 'vitest'
import { formatUsdMicro, formatCount } from '@reeeeecall/shared/lib/ai/server-client'

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
})
