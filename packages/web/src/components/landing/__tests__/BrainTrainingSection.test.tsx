import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { BrainTrainingSection } from '../BrainTrainingSection'

const { auth } = vi.hoisted(() => ({ auth: { user: null as null | { id: string } } }))
vi.mock('../../../stores/auth-store', () => ({ useAuthStore: () => auth.user }))
beforeEach(() => { auth.user = null })

afterEach(cleanup)
const setup = () => render(<MemoryRouter><BrainTrainingSection /></MemoryRouter>)

describe('visible brain training section', () => {
  it('uses the real nine-number board, supports correct order, completion and a new board', () => {
    setup()
    const board = screen.getByRole('group', { name: 'brainLanding.board' })
    const initial = within(board).getAllByRole('button').map(button => button.textContent)
    expect([...initial].sort()).toEqual(['1','2','3','4','5','6','7','8','9'])
    fireEvent.click(within(board).getByRole('button', { name: '9' }))
    expect(screen.getByRole('status')).toHaveTextContent('brainLanding.wrong')
    expect(within(board).getByRole('button', { name: '9' })).toBeEnabled()
    for (let number = 1; number <= 9; number++) {
      const button = within(board).getByRole('button', { name: String(number) })
      fireEvent.click(button)
      expect(button).toBeDisabled()
    }
    expect(screen.getByRole('status')).toHaveTextContent('brainLanding.complete')
    fireEvent.click(screen.getByRole('button', { name: 'brainLanding.reset' }))
    expect(within(board).getAllByRole('button').every(button => !button.hasAttribute('disabled'))).toBe(true)
    expect(within(board).getAllByRole('button').map(button => button.textContent)).not.toEqual(initial)
  })

  it('takes a signed-in visitor straight to the active games', () => {
    auth.user = { id: 'visitor' }
    setup()
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/brain', '/brain/play/memoryGrid', '/brain/play/codeBreak', '/brain/play/schulte',
    ])
  })

  it('shows brain content without opening a tab and points to active games', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'brainLanding.title' })).toBeVisible()
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      ...['/brain', '/brain/play/memoryGrid', '/brain/play/codeBreak', '/brain/play/schulte'].map(path => `/auth/login?redirect=${encodeURIComponent(path)}`),
    ])
  })
})
