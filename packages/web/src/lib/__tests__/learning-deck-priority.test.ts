/**
 * Deck priority — the missing product concept behind `goalRelevance`.
 *
 * Both clients hard-coded `importance: 0.5`, so a fifth of the ranking weight (0.20) has been a
 * constant for every learner since the feature shipped. These pin the two decisions that make
 * the control honest rather than decorative.
 */
import { describe, expect, it } from 'vitest'
import {
  DECK_PRIORITY_LEVELS, DEFAULT_DECK_PRIORITY,
  importanceForPriority, priorityForImportance,
} from '@reeeeecall/shared/lib/learning-deck-priority'

describe('importanceForPriority', () => {
  it('never reaches 0 or 1', () => {
    // "Low priority" must not mean "never show me this" — a learner who wants that removes the
    // deck, which is a different and reversible action. An importance of 0 would silently bury
    // cards they are still due to review, and 1 would let one deck swamp a six-signal ranking.
    for (const level of DECK_PRIORITY_LEVELS) {
      const value = importanceForPriority(level)
      expect(value, level).toBeGreaterThan(0)
      expect(value, level).toBeLessThan(1)
    }
  })

  it('orders low < normal < high, and keeps normal on the old default', () => {
    expect(importanceForPriority('low')).toBeLessThan(importanceForPriority('normal'))
    expect(importanceForPriority('normal')).toBeLessThan(importanceForPriority('high'))
    // Every goal written before this control existed stored 0.5. Changing what `normal` means
    // would silently re-rank every existing learner's plan.
    expect(importanceForPriority('normal')).toBe(0.5)
  })

  it('spans enough to matter, without dominating', () => {
    // goalRelevance is 0.20 of the weight, so the full span moves a card's score by ~0.10 —
    // comparable to the entire range of a 0.10-weight feature. Smaller would be theatre.
    const span = importanceForPriority('high') - importanceForPriority('low')
    expect(span * 0.2).toBeCloseTo(0.1, 6)
  })

  it('stays inside the column CHECK (0..1), which rejects rather than clamps', () => {
    for (const level of DECK_PRIORITY_LEVELS) {
      expect(importanceForPriority(level)).toBeGreaterThanOrEqual(0)
      expect(importanceForPriority(level)).toBeLessThanOrEqual(1)
    }
  })
})

describe('priorityForImportance', () => {
  it('round-trips every level', () => {
    for (const level of DECK_PRIORITY_LEVELS) {
      expect(priorityForImportance(importanceForPriority(level))).toBe(level)
    }
  })

  it('opens an existing goal on normal, because that is what was stored', () => {
    expect(priorityForImportance(0.5)).toBe('normal')
  })

  it('snaps a value from another client to the nearest level, not to the default', () => {
    // The column is a free 0..1 numeric. Falling back to `normal` would silently discard what
    // the learner chose the moment they press save.
    expect(priorityForImportance(0.8)).toBe('high')
    expect(priorityForImportance(0.3)).toBe('low')
    expect(priorityForImportance(0.99)).toBe('high')
    expect(priorityForImportance(0.01)).toBe('low')
  })

  it('breaks an exact tie downward rather than by iteration order', () => {
    // 0.375 is equidistant from low (0.25) and normal (0.5). Deterministic, and it never
    // silently promotes a deck the learner did not promote.
    expect(priorityForImportance(0.375)).toBe('low')
    expect(priorityForImportance(0.625)).toBe('normal')
  })

  it('falls back only when there is nothing to be near', () => {
    for (const bad of [null, undefined, Number.NaN, -0.5, 1.5]) {
      expect(priorityForImportance(bad as never), String(bad)).toBe(DEFAULT_DECK_PRIORITY)
    }
  })
})
