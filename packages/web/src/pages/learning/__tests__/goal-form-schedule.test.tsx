/**
 * The two schedule controls on the goal form.
 *
 * These are the only place a learner states how the plan should be paced, and both values are
 * read straight back by the planner — the rhythm divides every remaining-work figure, and the
 * intake limit is the one real throttle on future workload. A control that looks right and saves
 * nothing would be invisible: the plan would simply keep behaving as it did.
 */
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { GoalFormModal } from '../GoalFormModal'

const renderForm = (goal: Parameters<typeof GoalFormModal>[0]['goal'] = null) => {
  const onSubmit = vi.fn()
  render(<GoalFormModal goal={goal} onCancel={vi.fn()} onSubmit={onSubmit} submitting={false} />)
  return onSubmit
}

/** Fill the two required fields and submit. */
const submit = async () => {
  await userEvent.type(screen.getByRole('textbox', { name: /form\.goalTitle/i }), 'Goal')
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(screen.getByRole('button', { name: 'form.save' }))
}

beforeEach(() => { cleanup(); vi.clearAllMocks() })

describe('goal form — study rhythm', () => {
  it('defaults a new goal to every day and twenty new cards', () => {
    renderForm()

    // Both defaults are visible rather than implicit. A learner who never opens these controls
    // still has a stated pace they can go back and change, which is the difference between a
    // default and a hidden constant.
    expect(screen.getByRole('combobox', { name: /form\.studyDays/i })).toHaveValue('7')
    expect(screen.getByRole('spinbutton', { name: /form\.newCardsPerDay/i })).toHaveValue(20)
  })

  it('saves the rhythm in the general shape, not as "days per week"', async () => {
    const onSubmit = renderForm()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /form\.studyDays/i }), '3')
    await submit()

    // `{ cycleDays, studyDays }`, not `daysPerWeek: 3`. The cycle is fixed at 7 until there is a
    // control for it, but the STORED shape already says "7 days out of 10" — which is why
    // opening that up later is a second input rather than a migration.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ cadence: { cycleDays: 7, studyDays: 3 } }),
    }))
  })

  it('saves the intake limit', async () => {
    const onSubmit = renderForm()

    const field = screen.getByRole('spinbutton', { name: /form\.newCardsPerDay/i })
    await userEvent.clear(field)
    await userEvent.type(field, '5')
    await submit()

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ newCardsPerDay: 5 }),
    }))
  })

  it('accepts zero — "start nothing new, let me catch up"', async () => {
    const onSubmit = renderForm()

    const field = screen.getByRole('spinbutton', { name: /form\.newCardsPerDay/i })
    await userEvent.clear(field)
    await userEvent.type(field, '0')
    await submit()

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ newCardsPerDay: 0 }),
    }))
  })

  it('clamps as the learner types, not on submit', async () => {
    // A controlled number input that accepts a value it will later discard shows a figure the
    // plan never used. The learner should see the field refuse it.
    const onSubmit = renderForm()

    const field = screen.getByRole('spinbutton', { name: /form\.newCardsPerDay/i })
    await userEvent.clear(field)
    await userEvent.type(field, '5000')
    expect(field).toHaveValue(999)

    await submit()
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ newCardsPerDay: 999 }),
    }))
  })

  it('reads an existing goal\'s stored pace instead of resetting it', () => {
    renderForm({
      id: 'goal-1', domain_id: 'language', title: 'JLPT', target_date: null,
      daily_minutes: 30, status: 'active', target: {},
      settings: { cadence: { cycleDays: 7, studyDays: 4 }, newCardsPerDay: 7 },
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      decks: [{ deck_id: 'deck-1', importance: 0.5 }],
    } as never)

    // Opening the edit form must not silently rewrite a pace the learner chose.
    expect(screen.getByRole('combobox', { name: /form\.studyDays/i })).toHaveValue('4')
    expect(screen.getByRole('spinbutton', { name: /form\.newCardsPerDay/i })).toHaveValue(7)
  })
})
