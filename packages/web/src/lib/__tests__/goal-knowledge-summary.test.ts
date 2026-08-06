/**
 * goalKnowledgeSummary — the one reading of `get_goal_knowledge` all three surfaces share.
 *
 * The bug that made this necessary was reported by a learner who had studied exactly one card and
 * read "29장 중 1장 기억 / 확실 1 · 흔들림 18 · 미시작 10". Every number was right. The words were
 * not: `known` means "not past due", so one rating on an overdue card moves a card there, and the
 * headline divided by a different denominator than the bar beside it.
 */
import { describe, it, expect } from 'vitest'
import { goalKnowledgeSummary } from '@reeeeecall/shared/lib/goal-knowledge-summary'

describe('goalKnowledgeSummary', () => {
  it('divides by what has been studied, not by the whole goal', () => {
    // The learner's own numbers. 1/29 would be 3% and would describe cards nobody has opened as
    // if they had been failed.
    expect(goalKnowledgeSummary({ total: 29, known: 1, unknown: 18, unseen: 10 }))
      .toEqual({
        attempted: 19, withinWindow: 1, overdue: 18, unstudied: 10,
        percent: 5, notStarted: false,
      })
  })

  it('reports "not started" rather than 0% when nothing has been studied', () => {
    // 0 of 0 is not 0%. One is "no evidence yet", the other is a confident claim of total failure.
    expect(goalKnowledgeSummary({ total: 120, known: 0, unknown: 0, unseen: 120 }))
      .toMatchObject({ attempted: 0, percent: 0, notStarted: true })
  })

  it('is not fooled by a goal with no cards at all', () => {
    expect(goalKnowledgeSummary({ total: 0, known: 0, unknown: 0, unseen: 0 }))
      .toMatchObject({ attempted: 0, percent: 0, notStarted: true })
  })

  it('reads 100% only when every studied card is inside its window', () => {
    // Untouched cards must not hold the figure down: the sentence is about what has been studied,
    // and `unstudied` is stated separately rather than folded into the ratio.
    expect(goalKnowledgeSummary({ total: 50, known: 20, unknown: 0, unseen: 30 }))
      .toMatchObject({ percent: 100, unstudied: 30, notStarted: false })
  })

  it('rounds to whole percent', () => {
    expect(goalKnowledgeSummary({ total: 3, known: 1, unknown: 2, unseen: 0 }).percent).toBe(33)
    expect(goalKnowledgeSummary({ total: 3, known: 2, unknown: 1, unseen: 0 }).percent).toBe(67)
  })
})
