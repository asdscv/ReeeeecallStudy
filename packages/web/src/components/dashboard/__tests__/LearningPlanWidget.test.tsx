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
    knowledge: { 'goal-1': { total: 120, known: 55, unknown: 20, unseen: 45 } },
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

    expect(screen.getByText(/progress\.knownNow/)).toBeInTheDocument()
    expect(screen.queryByText(/progress\.knownAtTarget/)).not.toBeInTheDocument()
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

  it('measures progress against the whole goal, not against what was attempted', () => {
    // 55 of 120. Dividing by attempted cards (known + unknown = 75) put a 73% bar next to the
    // words "55 of 120".
    renderWidget()

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', String(Math.round((55 / 120) * 100)))
  })

  it('renders nothing when there is no plannable goal', () => {
    // A tile that exists only to advertise an unused feature is an ad.
    const { container } = (() => { renderWidget({ goals: [] }); return { container: document.body } })()
    expect(container.textContent).toBe('')
  })
})
