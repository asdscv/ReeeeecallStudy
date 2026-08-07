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
  it('measures how far through the goal the learner is', () => {
    // 19 of 29 cards have been opened at least once. The old ratio was `withinWindow /
    // attempted` = 1/19 = 5%, which described the review backlog rather than progress and hit
    // 100% the moment nothing was overdue.
    expect(goalKnowledgeSummary({ total: 29, known: 1, unknown: 18, unseen: 10 }))
      .toEqual({
        total: 29, attempted: 19, withinWindow: 1, overdue: 18, unstudied: 10,
        percent: 66, behind: true, notStarted: false,
      })
  })

  it('never fills the bar while a card has not been opened', () => {
    // The defect this replaced: 17 studied, 12 never touched, nothing overdue — `withinWindow /
    // attempted` was 17/17 and drew a COMPLETE bar over a goal 59% of the way through.
    const summary = goalKnowledgeSummary({ total: 29, known: 17, unknown: 0, unseen: 12 })

    expect(summary.percent).toBe(59)
    expect(summary.behind).toBe(false)
  })

  it('fills the bar only when every card has been reached', () => {
    expect(goalKnowledgeSummary({ total: 29, known: 20, unknown: 9, unseen: 0 }).percent).toBe(100)
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

  it('reports being behind separately from progress', () => {
    // The two are independent: someone can be 90% through a goal and badly behind on reviews,
    // or 10% through with nothing overdue. The headline reads `behind`; the bar reads `percent`.
    expect(goalKnowledgeSummary({ total: 50, known: 20, unknown: 0, unseen: 30 }))
      .toMatchObject({ percent: 40, behind: false, unstudied: 30, notStarted: false })
    expect(goalKnowledgeSummary({ total: 50, known: 5, unknown: 40, unseen: 5 }))
      .toMatchObject({ percent: 90, behind: true })
  })

  it('rounds to whole percent', () => {
    expect(goalKnowledgeSummary({ total: 3, known: 1, unknown: 0, unseen: 2 }).percent).toBe(33)
    expect(goalKnowledgeSummary({ total: 3, known: 1, unknown: 1, unseen: 1 }).percent).toBe(67)
  })
})
