import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QuizRunPage } from '../QuizRunPage'

const { state } = vi.hoisted(() => ({ state: { run: null as null | Record<string, unknown> } }))
vi.mock('@reklue/shared/stores/quiz-store', () => ({
  useQuizStore: () => ({ run: state.run, loadRun: vi.fn(), itemRatings: {} }),
  QuizError: class extends Error {}, QUIZ_GRADE_ACTION: {},
  optionFlaws: () => [], optionAxes: () => [], QUIZ_FEEDBACK_REASONS: [],
}))
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
