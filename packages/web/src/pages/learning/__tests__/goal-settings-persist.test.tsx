/**
 * The hop where the pacing answers used to die.
 *
 * `goal-form-schedule.test.tsx` asserts the MODAL calls `onSubmit` with
 * `settings: { cadence, newCardsPerDay }` — and it always did. The page that receives that
 * callback then rebuilt the payload field by field and simply left `settings` out, so every
 * goal in production stored `settings = {}`: `parseNewCardsPerDay` reads that as "uncapped",
 * `parseCadence` as "every day", and the intake limit had therefore never throttled a single
 * plan. Nothing caught it because no test spanned the two files — the modal test stops at the
 * exact prop boundary the value was lost at.
 *
 * So these two drive the PAGE and assert on the STORE.
 */
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const createGoal = vi.fn(async () => 'goal-new')
const updateGoal = vi.fn(async () => true)

const goals: Array<Record<string, unknown>> = []

vi.mock('../../../stores/auth-store', () => ({ useAuthStore: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../stores/deck-store', () => ({
  useDeckStore: () => ({
    decks: [{ id: 'deck-1', name: 'Deck one' }],
    stats: [{
      deck_id: 'deck-1', deck_name: 'Deck one', total_cards: 40,
      new_cards: 30, review_cards: 8, learning_cards: 2, last_studied: null,
    }],
    fetchDecks: vi.fn(), fetchStats: vi.fn(),
  }),
}))
vi.mock('../../../stores/confirm-store', () => ({
  useConfirmStore: (selector: (s: unknown) => unknown) =>
    selector({ confirm: vi.fn(async () => true) }),
}))
vi.mock('../../../stores/learning-store', () => ({
  useLearningStore: () => ({
    goals, goalsLoading: false, goalsError: null,
    fetchGoals: vi.fn(), createGoal, updateGoal, archiveGoal: vi.fn(),
  }),
}))

import { LearningGoalsPage } from '../LearningGoalsPage'

const renderPage = () =>
  render(<MemoryRouter><LearningGoalsPage /></MemoryRouter>)

beforeEach(() => { cleanup(); vi.clearAllMocks(); goals.length = 0 })

describe('goal pacing reaches the store', () => {
  it('sends settings on create', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'goals.create' }))
    await userEvent.type(screen.getByRole('textbox', { name: /form\.goalTitle/i }), 'Goal')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /form\.studyDays/i }), '3')
    await userEvent.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(createGoal).toHaveBeenCalled())
    expect(createGoal).toHaveBeenCalledWith(expect.objectContaining({
      settings: { cadence: { cycleDays: 7, studyDays: 3 }, newCardsPerDay: 20 },
    }))
  })

  it('sends settings on edit', async () => {
    goals.push({
      id: 'goal-1', domain_id: 'language', title: 'Existing', target_date: null,
      daily_minutes: 20, status: 'active', target: {},
      settings: { cadence: { cycleDays: 7, studyDays: 4 }, newCardsPerDay: 7 },
      created_at: '', updated_at: '', decks: [{ deck_id: 'deck-1', importance: 0.5 }],
    })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'goals.edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(updateGoal).toHaveBeenCalled())
    expect(updateGoal).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'goal-1',
      settings: { cadence: { cycleDays: 7, studyDays: 4 }, newCardsPerDay: 7 },
    }))
  })
})
