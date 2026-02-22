import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NoCardsDue } from '../NoCardsDue'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'noCards.srs.title': 'All Caught Up!',
        'noCards.srs.message': 'No cards due for review right now. Check back later!',
        'noCards.cramming.weakTitle': 'No Weak Cards',
        'noCards.cramming.weakMessage': 'All your cards are in good shape!',
        'noCards.cramming.dueSoonTitle': 'Nothing Due Soon',
        'noCards.cramming.dueSoonMessage': 'No cards are due for review within 3 days.',
        'noCards.generic.title': 'No Cards to Study',
        'noCards.generic.message': 'There are no cards matching your criteria.',
        'noCards.otherMode': 'Study Other Mode',
        'summary.backToDeck': 'Back to Deck',
      }
      return map[key] ?? key
    },
  }),
}))

describe('NoCardsDue', () => {
  const onBackToDeck = vi.fn()
  const onOtherMode = vi.fn()

  it('renders SRS empty state', () => {
    render(
      <NoCardsDue mode="srs" onBackToDeck={onBackToDeck} onOtherMode={onOtherMode} />
    )
    expect(screen.getByText('All Caught Up!')).toBeDefined()
    expect(screen.getByText('No cards due for review right now. Check back later!')).toBeDefined()
  })

  it('renders cramming weak empty state', () => {
    render(
      <NoCardsDue mode="cramming" crammingFilter={{ type: 'weak', maxEaseFactor: 1.8 }} onBackToDeck={onBackToDeck} onOtherMode={onOtherMode} />
    )
    expect(screen.getByText('No Weak Cards')).toBeDefined()
    expect(screen.getByText('All your cards are in good shape!')).toBeDefined()
  })

  it('renders cramming due_soon empty state', () => {
    render(
      <NoCardsDue mode="cramming" crammingFilter={{ type: 'due_soon', withinDays: 3 }} onBackToDeck={onBackToDeck} onOtherMode={onOtherMode} />
    )
    expect(screen.getByText('Nothing Due Soon')).toBeDefined()
    expect(screen.getByText('No cards are due for review within 3 days.')).toBeDefined()
  })

  it('renders generic empty state for other modes', () => {
    render(
      <NoCardsDue mode="random" onBackToDeck={onBackToDeck} onOtherMode={onOtherMode} />
    )
    expect(screen.getByText('No Cards to Study')).toBeDefined()
    expect(screen.getByText('There are no cards matching your criteria.')).toBeDefined()
  })

  it('calls onBackToDeck when "Back to Deck" button clicked', () => {
    onBackToDeck.mockClear()
    render(
      <NoCardsDue mode="srs" onBackToDeck={onBackToDeck} onOtherMode={onOtherMode} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back to Deck' }))
    expect(onBackToDeck).toHaveBeenCalledOnce()
  })

  it('calls onOtherMode when "Study Other Mode" button clicked', () => {
    onOtherMode.mockClear()
    render(
      <NoCardsDue mode="srs" onBackToDeck={onBackToDeck} onOtherMode={onOtherMode} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Study Other Mode' }))
    expect(onOtherMode).toHaveBeenCalledOnce()
  })
})
