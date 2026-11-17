import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReducedMotion } from 'motion/react'
import { AppPreviewSection } from '../AppPreviewSection'

vi.mock('motion/react', () => ({
  useReducedMotion: vi.fn(() => false),
  motion: {
    button: ({ animate, transition: _transition, ...props }: ComponentProps<'button'> & { animate: { rotateY: number }; transition: unknown }) => <button {...props} data-rotation={animate.rotateY} />,
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(useReducedMotion).mockReturnValue(false)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const front = () => screen.getByRole('button', { name: 'premium.flipAnswer' })
const back = () => screen.getByRole('button', { name: 'premium.flipBack' })

describe('public card experience', () => {
  it('turns the card over on click and enables the recall choices', () => {
    render(<AppPreviewSection />)
    expect(front()).toHaveAttribute('data-rotation', '0')
    expect(screen.getByRole('button', { name: 'Good' })).toBeDisabled()
    fireEvent.click(front())
    expect(back()).toHaveAttribute('data-rotation', '180')
    expect(screen.getByRole('button', { name: 'Good' })).toBeEnabled()
    fireEvent.click(back())
    expect(front()).toHaveAttribute('data-rotation', '0')
  })

  it('plays automatically, and stays still after pause', () => {
    render(<AppPreviewSection />)
    act(() => vi.advanceTimersByTime(4200))
    expect(back()).toHaveAttribute('data-rotation', '180')
    fireEvent.click(screen.getByRole('button', { name: 'premium.pause' }))
    act(() => vi.advanceTimersByTime(12600))
    expect(back()).toHaveAttribute('data-rotation', '180')
    fireEvent.click(screen.getByRole('button', { name: 'premium.play' }))
    act(() => vi.advanceTimersByTime(4200))
    expect(front()).toHaveAttribute('data-rotation', '0')
  })

  it('moves between example cards and resets to the front', () => {
    render(<AppPreviewSection />)
    fireEvent.click(front())
    fireEvent.click(screen.getByRole('button', { name: 'Good' }))
    expect(front()).toHaveTextContent('curiosity')
    expect(screen.getByRole('button', { name: 'Good' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'premium.previousCard' }))
    expect(front()).toHaveTextContent('serendipity')
    fireEvent.click(screen.getByRole('button', { name: 'premium.previousCard' }))
    expect(front()).toHaveTextContent('momentum')
    fireEvent.click(screen.getByRole('button', { name: 'premium.nextCard' }))
    expect(front()).toHaveTextContent('serendipity')
  })

  it('leaves autoplay off when reduced motion is requested, while allowing a manual flip', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    render(<AppPreviewSection />)
    act(() => vi.advanceTimersByTime(12600))
    expect(front()).toHaveAttribute('data-rotation', '0')
    expect(screen.getByRole('button', { name: 'premium.play' })).toBeDisabled()
    fireEvent.click(front())
    expect(back()).toHaveAttribute('data-rotation', '180')
  })
})
