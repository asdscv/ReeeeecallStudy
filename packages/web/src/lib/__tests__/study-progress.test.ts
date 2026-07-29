import { describe, expect, it } from 'vitest'
import { calculateStudyProgress } from '@reeeeecall/shared/lib/study-progress'

describe('calculateStudyProgress', () => {
  it('uses ordinary card completion for non-cramming modes', () => {
    expect(calculateStudyProgress('srs', 3, 10)).toBe(30)
  })

  it('uses mastery percentage for cramming instead of attempts/unique cards', () => {
    expect(calculateStudyProgress('cramming', 3, 2, 50)).toBe(50)
  })

  it('never exceeds 100 or drops below zero', () => {
    expect(calculateStudyProgress('random', 3, 2)).toBe(100)
    expect(calculateStudyProgress('cramming', 0, 2, 150)).toBe(100)
    expect(calculateStudyProgress('cramming', 0, 2, -10)).toBe(0)
  })

  it('returns zero for an empty session or non-finite values', () => {
    expect(calculateStudyProgress('srs', 1, 0)).toBe(0)
    expect(calculateStudyProgress('srs', NaN, 2)).toBe(0)
  })
})
