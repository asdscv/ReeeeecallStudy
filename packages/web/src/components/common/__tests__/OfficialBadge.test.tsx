import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { OfficialBadge } from '../OfficialBadge'

describe('OfficialBadge', () => {
  it('renders with data-testid="official-badge"', () => {
    render(<OfficialBadge />)
    expect(screen.getByTestId('official-badge')).toBeInTheDocument()
  })

  it('shows label text', () => {
    render(<OfficialBadge />)
    expect(screen.getByTestId('official-badge')).toHaveTextContent('officialBadge.label')
  })

  it('uses sm size classes by default', () => {
    render(<OfficialBadge />)
    const badge = screen.getByTestId('official-badge')
    expect(badge.className).toContain('text-xs')
    expect(badge.className).toContain('px-1.5')
  })

  it('uses md size classes when specified', () => {
    render(<OfficialBadge size="md" />)
    const badge = screen.getByTestId('official-badge')
    expect(badge.className).toContain('text-sm')
    expect(badge.className).toContain('px-2')
  })

  it('accepts custom className', () => {
    render(<OfficialBadge className="my-custom-class" />)
    const badge = screen.getByTestId('official-badge')
    expect(badge.className).toContain('my-custom-class')
  })

  it('contains SVG icon', () => {
    render(<OfficialBadge />)
    const badge = screen.getByTestId('official-badge')
    expect(badge.querySelector('svg')).toBeInTheDocument()
  })

  it('has role="status" for accessibility', () => {
    render(<OfficialBadge />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('has aria-label for screen readers', () => {
    render(<OfficialBadge />)
    const badge = screen.getByTestId('official-badge')
    expect(badge).toHaveAttribute('aria-label', 'officialBadge.tooltip')
  })
})
