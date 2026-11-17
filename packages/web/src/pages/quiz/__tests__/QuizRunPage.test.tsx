import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QuizRunPage } from '../QuizRunPage'

const { state, quote, gradeWithAi, loadRun } = vi.hoisted(() => ({
  state: { run: null as null | Record<string, unknown> },
  quote: vi.fn(async () => ({ price_micro: 10000 })),
  gradeWithAi: vi.fn(async () => {}), loadRun: vi.fn(async () => {}),
}))
vi.mock('@reklue/shared/stores/quiz-store', () => ({
  useQuizStore: () => ({ run: state.run, loadRun, quote, gradeWithAi, grading: false, itemRatings: {} }),
  QuizError: class extends Error {}, QUIZ_GRADE_ACTION: { short: 'grade_short', essay: 'grade_essay' },
  optionFlaws: () => [], optionAxes: () => [], QUIZ_FEEDBACK_REASONS: [],
}))
beforeEach(() => { vi.clearAllMocks(); state.run = null })
afterEach(cleanup)

describe('completed quiz navigation', () => {
  it('opens the result instead of allowing a completed sitting to be answered again', async () => {
    state.run = { run_id: 'finished', status: 'completed', items: [], item_count: 0, requested_count: 0 }
    render(<MemoryRouter initialEntries={['/quiz/finished']}><Routes>
      <Route path="/quiz/:runId" element={<QuizRunPage />} />
      <Route path="/quiz/:runId/result" element={<p>Saved result</p>} />
    </Routes></MemoryRouter>)
    expect(await screen.findByText('Saved result')).toBeInTheDocument()
  })

  it('does not redirect a different run while the requested run is loading', () => {
    state.run = { run_id: 'previous', status: 'completed', items: [], item_count: 0, requested_count: 0 }
    render(<MemoryRouter initialEntries={['/quiz/current']}><Routes>
      <Route path="/quiz/:runId" element={<QuizRunPage />} />
      <Route path="/quiz/:runId/result" element={<p>Saved result</p>} />
    </Routes></MemoryRouter>)
    expect(screen.queryByText('Saved result')).not.toBeInTheDocument()
  })
})


describe('saved written answers', () => {
  const savedAnswer = 'A previously submitted explanation'
  const savedRun = (score: number | null) => ({ run_id: 'current', status: 'in_progress', item_count: 1, requested_count: 1, items: [{
    item_id: 'saved-item', question_type: 'short', stem: 'Explain the concept',
    answered: true, status: score === null ? 'answered' : 'graded', score,
    response: { text: savedAnswer }, reference_answer: null, feedback: null,
  }] })
  const renderRun = () => render(<MemoryRouter initialEntries={['/quiz/current']}><Routes>
    <Route path="/quiz/:runId" element={<QuizRunPage />} />
  </Routes></MemoryRouter>)

  it('restores the submitted answer and quotes a retry without spending on reload', async () => {
    state.run = savedRun(null)
    renderRun()
    expect(screen.getByRole('textbox')).toHaveValue(savedAnswer)
    expect(screen.getByRole('textbox')).toBeDisabled()
    await waitFor(() => expect(quote).toHaveBeenCalledWith('grade_short', 1))
    expect(gradeWithAi).not.toHaveBeenCalled()
    const grade = screen.getByRole('button', { name: 'run.grade' })
    await waitFor(() => expect(grade).toBeEnabled())
    fireEvent.click(grade)
    await waitFor(() => expect(gradeWithAi).toHaveBeenCalledWith('saved-item', savedAnswer, 10000))
  })

  it('keeps a graded answer visible without buying or quoting another grade', () => {
    state.run = savedRun(1)
    renderRun()
    expect(screen.getByRole('textbox')).toHaveValue(savedAnswer)
    expect(quote).not.toHaveBeenCalled()
    expect(gradeWithAi).not.toHaveBeenCalled()
  })
})
