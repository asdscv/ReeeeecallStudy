import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ProductShowcase } from '../ProductShowcase'

afterEach(cleanup)
const setup = () => render(<MemoryRouter><ProductShowcase /></MemoryRouter>)

describe('public workspace sample', () => {
  it('filters decks and reviews the chosen sample without signing in', () => {
    setup()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'deckTwo' } })
    expect(screen.queryByRole('button', { name: /premium.deckOne/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /premium.deckTwo/ }))
    expect(screen.getByText('curiosity')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'showcase.study' }))
    expect(screen.getByRole('tab', { name: /showcase.review/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'showcase.reveal' }))
    expect(screen.getByText('premium.meaning2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Good' }))
    expect(screen.getByText('momentum')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'showcase.reveal' })).toBeInTheDocument()
  })

  it('supports keyboard tab navigation and links to existing game routes', () => {
    setup()
    const first = screen.getByRole('tab', { name: /showcase.decks/ })
    first.focus()
    fireEvent.keyDown(first, { key: 'End' })
    const games = screen.getByRole('tab', { name: /showcase.games/ })
    expect(games).toHaveFocus()
    expect(games).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/brain/play/schulte', '/brain/play/memoryGrid', '/brain/play/codeBreak'])
    fireEvent.keyDown(games, { key: 'ArrowRight' })
    expect(first).toHaveFocus()
    expect(first).toHaveAttribute('aria-selected', 'true')
  })
})
