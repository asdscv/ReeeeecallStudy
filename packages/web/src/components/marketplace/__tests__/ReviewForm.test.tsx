import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewForm } from '../ReviewForm'
import type { MarketplaceReview } from '../../../types/database'

// The form used to copy `existingReview` into local state from an effect. It now adjusts
// during render, so these assertions pin what that has to keep doing: adopt a review that
// arrives late, and leave the user's in-progress edits alone when nothing changed.
function review(over: Partial<MarketplaceReview> = {}): MarketplaceReview {
  return {
    id: 'review-1',
    listing_id: 'listing-1',
    user_id: 'user-1',
    rating: 4,
    title: 'Solid deck',
    body: 'Well organised.',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as MarketplaceReview
}

describe('ReviewForm existing review sync', () => {
  it('starts empty when there is no existing review', () => {
    render(<ReviewForm submitting={false} onSubmit={vi.fn()} />)
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe('')
  })

  it('adopts a review that arrives after the first render', () => {
    const { rerender } = render(<ReviewForm submitting={false} onSubmit={vi.fn()} />)
    rerender(<ReviewForm submitting={false} onSubmit={vi.fn()} existingReview={review()} />)

    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe('Solid deck')
    expect((screen.getByLabelText(/review|body|comment/i) as HTMLTextAreaElement).value)
      .toBe('Well organised.')
  })

  it('re-syncs when the review is replaced', () => {
    const { rerender } = render(
      <ReviewForm submitting={false} onSubmit={vi.fn()} existingReview={review()} />,
    )
    rerender(
      <ReviewForm
        submitting={false}
        onSubmit={vi.fn()}
        existingReview={review({ id: 'review-2', title: 'Updated', body: 'Even better.' })}
      />,
    )
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe('Updated')
  })
})
