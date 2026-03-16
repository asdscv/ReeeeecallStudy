import { describe, it, expect } from 'vitest'
import { getSessionSummaryType } from '../study-summary-type'

describe('getSessionSummaryType', () => {
  it('returns "no-cards" when totalCards is 0', () => {
    expect(getSessionSummaryType(0, 0)).toBe('no-cards')
  })

  it('returns "partial" when cardsStudied < totalCards', () => {
    expect(getSessionSummaryType(10, 3)).toBe('partial')
    expect(getSessionSummaryType(10, 0)).toBe('partial')
    expect(getSessionSummaryType(10, 9)).toBe('partial')
  })

  it('returns "complete" when cardsStudied >= totalCards', () => {
    expect(getSessionSummaryType(10, 10)).toBe('complete')
    expect(getSessionSummaryType(10, 12)).toBe('complete')
    expect(getSessionSummaryType(1, 1)).toBe('complete')
  })
})
