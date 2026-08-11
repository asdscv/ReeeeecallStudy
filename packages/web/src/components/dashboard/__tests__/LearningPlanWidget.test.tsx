/**
 * The one-line learning-plan tile on the dashboard.
 *
 * What these pin is that the NUMBER and the SENTENCE answer the same question. The widget
 * shipped for a while asking the server "what will this learner still know on their target
 * date" and then labelling the answer "known now" — two different questions, one line of text,
 * and no way for a learner to tell which they were reading.
 *
 * That is not a cosmetic mismatch. Judged at a deadline, a learner who had studied 55 cards read
 * "0 of 120 cards known", because every SRS interval was shorter than the time remaining. The
 * forecast is worth showing one day, with its assumption written beside it. It is not the line
 * that tells someone where they stand.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockState } = vi.hoisted(() => ({ mockState: { current: {} as Record<string, unknown> } }))
vi.mock('../../../stores/learning-store', () => ({
  useLearningStore: (selector?: (s: unknown) => unknown) =>
    (selector ? selector(mockState.current) : mockState.current),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Key + args, so a test can assert WHICH sentence rendered and with what.
    t: (key: string, args?: Record<string, unknown>) =>
      (args ? `${key}(${JSON.stringify(args)})` : key),
  }),
}))

import { LearningPlanWidget } from '../LearningPlanWidget'
import { goalKnowledgeSummary } from '@reeeeecall/shared/lib/goal-knowledge-summary'

const goal = (over: Record<string, unknown> = {}) => ({
  id: 'goal-1', domain_id: 'language', title: 'JLPT N2', target_date: null,
  daily_minutes: 20, status: 'active', target: {}, settings: {},
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  decks: [], ...over,
})

const fetchGoalKnowledge = vi.fn()
const renderWidget = (over: Record<string, unknown> = {}) => {
  mockState.current = {
    goals: [goal()],
    // `overdue` is its own field now, not `unknown`: cards in a learning step land in
    // `unknown` and are not late. Twenty here are genuinely late.
    knowledge: { 'goal-1': { total: 120, known: 55, unknown: 20, unseen: 45, overdue: 20, dueNow: 20 } },
    fetchGoals: vi.fn(),
    fetchGoalKnowledge,
    ...over,
  }
  return render(<MemoryRouter><LearningPlanWidget /></MemoryRouter>)
}

beforeEach(() => { cleanup(); vi.clearAllMocks() })

describe('LearningPlanWidget — the number and the sentence agree', () => {
  it('asks what the learner knows NOW, even when the goal has a deadline', () => {
    // The regression. A target date must not silently turn this into a forecast: the label
    // beside it says "now", and `get_goal_knowledge` answers whatever moment it is handed.
    renderWidget({ goals: [goal({ target_date: '2026-12-31' })] })

    const [, judgedAt] = fetchGoalKnowledge.mock.calls[0] as [string, string]
    expect(judgedAt).not.toContain('2026-12-31')
    // A real instant, not a date-only string — the RPC takes a timestamptz.
    expect(Number.isNaN(Date.parse(judgedAt))).toBe(false)
  })

  it('always labels the figure as the present', () => {
    renderWidget({ goals: [goal({ target_date: '2026-12-31' })] })

    // Either present-tense headline is fine — what must never appear is the forecast one, which
    // answered "what will you still know on the target date" while being labelled "known now".
    expect(screen.getByText(/progress\.(behind|studied)/)).toBeInTheDocument()
    expect(screen.queryByText(/progress\.knownAtTarget/)).not.toBeInTheDocument()
  })

  it('leads with the backlog when there is one', () => {
    // 20 overdue. "Behind on reviews" is the one state with something to do today, so it takes
    // the sentence and the progress figure moves to the bar.
    renderWidget()

    expect(screen.getByText(/progress\.behind/)).toHaveTextContent('"count":20')
    expect(screen.queryByText(/progress\.studied/)).not.toBeInTheDocument()
  })

  it('names the goal total once nothing is overdue', () => {
    // Without a backlog the old sentence degenerated to "55 of 55 are within their window" —
    // true, vacuous, and silent about the 45 cards never opened.
    renderWidget({ knowledge: { 'goal-1': { total: 120, known: 75, unknown: 0, unseen: 45, overdue: 0, dueNow: 0 } } })

    const line = screen.getByText(/progress\.studied/)
    expect(line).toHaveTextContent('"total":120')
    expect(line).toHaveTextContent('"attempted":75')
  })

  it('says "not started" rather than a confident 0% for an untouched goal', () => {
    // 0 of 0 is not 0%. A goal nobody has opened has no ratio to report, and printing one would
    // be a measurement where there is no evidence.
    renderWidget({ knowledge: { 'goal-1': { total: 120, known: 0, unknown: 0, unseen: 120 } } })

    expect(screen.getByText(/progress\.notStarted/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('still counts the days left, which is what a deadline is for', () => {
    // Dropping the forecast must not drop the deadline itself — "how long do I have" is a fact
    // about the calendar, not a claim about memory.
    renderWidget({ goals: [goal({ target_date: '2099-01-01' })] })

    expect(screen.getByText(/progress\.daysLeft/)).toBeInTheDocument()
  })

  it('reads the clock once, so a re-render does not re-issue the RPC', () => {
    // The loop this prevents needs a SECOND render to appear: `Date.now()` read during render
    // produces a new `judgedAt` each pass, the effect's dependency changes, and the request
    // fires again — forever, on any parent re-render. Rendering once proves nothing, which is
    // how the first version of this test passed against the bug it was written for.
    const { rerender } = renderWidget()
    rerender(<MemoryRouter><LearningPlanWidget /></MemoryRouter>)
    rerender(<MemoryRouter><LearningPlanWidget /></MemoryRouter>)

    expect(fetchGoalKnowledge).toHaveBeenCalledTimes(1)
  })

  it('draws the bar on the goal, and never fills it early', () => {
    // The bar is `attempted / total` — 75 of 120 cards opened, 63%. Two earlier versions of this
    // test pinned it to 55/120 and then 55/75, each matching whatever the sentence said at the
    // time; the second one reached 100% as soon as nothing was overdue, over a goal with 45
    // cards never touched. A progress bar may only fill when there is nothing left to reach.
    renderWidget()

    expect(screen.getByRole('progressbar'))
      .toHaveAttribute('aria-valuenow', String(Math.round((75 / 120) * 100)))
  })

  it('does not fill the bar for a goal with untouched cards', () => {
    renderWidget({ knowledge: { 'goal-1': { total: 120, known: 75, unknown: 0, unseen: 45, overdue: 0, dueNow: 0 } } })

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '63')
    expect(bar).not.toHaveAttribute('aria-valuenow', '100')
  })

  it('agrees with the plan screen, which reads the same numbers', () => {
    // The tile divided by `total` while the plan screen divided by attempted, so one goal's
    // numbers drew a 46% bar on the dashboard and a 73% bar one click away. Both call
    // `goalKnowledgeSummary` now; this pins the tile to it.
    renderWidget()

    expect(screen.getByRole('progressbar'))
      .toHaveAttribute('aria-valuenow', String(goalKnowledgeSummary(
        { total: 120, known: 55, unknown: 20, unseen: 45 },
      ).percent))
  })

  it('renders nothing when there is no plannable goal', () => {
    // A tile that exists only to advertise an unused feature is an ad.
    const { container } = (() => { renderWidget({ goals: [] }); return { container: document.body } })()
    expect(container.textContent).toBe('')
  })
})
