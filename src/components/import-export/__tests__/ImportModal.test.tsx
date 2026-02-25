import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ImportProgressBar } from '../ImportProgressBar'

describe('ImportProgressBar', () => {
  it('should render progress bar with correct percentage', () => {
    render(<ImportProgressBar done={35} total={69} label="Importing..." />)

    expect(screen.getByRole('progressbar')).toBeDefined()
    expect(screen.getByText('51%')).toBeDefined()
    expect(screen.getByText('35 / 69')).toBeDefined()
    expect(screen.getByText('Importing...')).toBeDefined()
  })

  it('should show 0% when done is 0', () => {
    render(<ImportProgressBar done={0} total={69} label="Importing..." />)

    expect(screen.getByText('0%')).toBeDefined()
    expect(screen.getByText('0 / 69')).toBeDefined()
  })

  it('should show 100% when done equals total', () => {
    render(<ImportProgressBar done={69} total={69} label="Importing..." />)

    expect(screen.getByText('100%')).toBeDefined()
    expect(screen.getByText('69 / 69')).toBeDefined()
  })

  it('should set correct width style on progress bar fill', () => {
    const { container } = render(<ImportProgressBar done={50} total={100} label="Importing..." />)

    const fill = container.querySelector('[role="progressbar"]') as HTMLElement
    expect(fill.style.width).toBe('50%')
  })

  it('should set aria attributes correctly', () => {
    render(<ImportProgressBar done={25} total={50} label="Importing..." />)

    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('25')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('50')
  })

  it('should handle total of 0 gracefully (no division by zero)', () => {
    render(<ImportProgressBar done={0} total={0} label="Importing..." />)

    expect(screen.getByText('0%')).toBeDefined()
    expect(screen.getByText('0 / 0')).toBeDefined()
  })
})
