import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { SwipeGuide } from '../SwipeGuide'
import type { SwipeDirectionMap } from '../../../lib/study-input-settings'

// The hint opacity used to be driven by a setState inside an effect. It is now adjusted
// during render (the timed fade-out stays in a timer callback), so these assertions pin
// the user-visible timing the refactor had to preserve.
const DIRECTIONS = {
  left: 'again',
  right: 'good',
  up: 'easy',
  down: 'hard',
} as unknown as SwipeDirectionMap

/** The hints are always mounted; `show` drives their opacity. */
function hintOpacity(): string {
  const hint = screen.getByText('\u2190').parentElement as HTMLElement
  return hint.style.opacity
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SwipeGuide visibility', () => {
  it('is transparent until visible turns true', () => {
    render(<SwipeGuide directions={DIRECTIONS} visible={false} />)
    expect(hintOpacity()).toBe('0')
  })

  it('fades in as soon as visible turns true', () => {
    const { rerender } = render(<SwipeGuide directions={DIRECTIONS} visible={false} />)
    rerender(<SwipeGuide directions={DIRECTIONS} visible />)
    expect(hintOpacity()).toBe('0.25')
  })

  it('fades out two seconds later', () => {
    vi.useFakeTimers()
    const { rerender } = render(<SwipeGuide directions={DIRECTIONS} visible={false} />)
    rerender(<SwipeGuide directions={DIRECTIONS} visible />)
    expect(hintOpacity()).toBe('0.25')

    act(() => { vi.advanceTimersByTime(1_999) })
    expect(hintOpacity()).toBe('0.25')
    act(() => { vi.advanceTimersByTime(1) })
    expect(hintOpacity()).toBe('0')
  })

  it('hides immediately when visible turns false', () => {
    const { rerender } = render(<SwipeGuide directions={DIRECTIONS} visible />)
    expect(hintOpacity()).toBe('0.25')
    rerender(<SwipeGuide directions={DIRECTIONS} visible={false} />)
    expect(hintOpacity()).toBe('0')
  })
})
