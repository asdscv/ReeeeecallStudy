/**
 * recallPercent — the one number from the memory model a learner ever sees.
 *
 * The assertion that matters is the null one. Everything upstream is careful to say "we cannot
 * estimate this card" as `null` rather than 0, and this is the last place that distinction can
 * be thrown away: a new card rendering "0% chance you remember this" would be both alarming and
 * false, and it is a one-character mistake (`?? 0`) away at every step.
 */
import { describe, expect, it } from 'vitest'
import { recallPercent } from '@reeeeecall/shared/lib/learning-recall-display'

describe('recallPercent', () => {
  it('renders a probability as whole percent', () => {
    expect(recallPercent(0.9)).toBe(90)
    expect(recallPercent(0.5237)).toBe(52)
    expect(recallPercent(1)).toBe(100)
    expect(recallPercent(0)).toBe(0)
  })

  it('says NOTHING for a card with no forgetting curve, never 0%', () => {
    // `null` reaches here from `estimateMemory` for a new or never-reviewed card. Rendering it
    // as 0 would tell the learner they have certainly forgotten something they never studied.
    expect(recallPercent(null)).toBeNull()
    expect(recallPercent(undefined)).toBeNull()
    expect(recallPercent(Number.NaN)).toBeNull()
  })

  it('clamps rather than emitting an impossible percentage', () => {
    expect(recallPercent(1.4)).toBe(100)
    expect(recallPercent(-0.2)).toBe(0)
  })

  it('rounds to whole percent, because the input does not support more', () => {
    // Stability is bridged from an SM-2 interval — a scheduler's choice, not a fitted
    // measurement. A decimal place would advertise precision that is not there.
    expect(recallPercent(0.905)).toBe(91)
    expect(recallPercent(0.9049)).toBe(90)
    expect(Number.isInteger(recallPercent(0.33333) as number)).toBe(true)
  })
})
