import { render } from '@testing-library/react'
import { StudyProgressBar } from '../StudyProgressBar'

describe('StudyProgressBar', () => {
  it('renders progress text as current/total', () => {
    const { container } = render(<StudyProgressBar current={3} total={10} />)
    expect(container.textContent).toContain('3/10')
  })

  it('renders a gradient bar that spans the full container width', () => {
    const { container } = render(<StudyProgressBar current={1} total={4} />)
    const gradientBar = container.querySelector('.bg-gradient-to-r')
    expect(gradientBar).toBeTruthy()
    // The gradient div should use absolute positioning to span full width
    expect(gradientBar?.className).toContain('absolute')
    expect(gradientBar?.className).toContain('inset-0')
  })

  it('clips gradient to the correct percentage via clipPath', () => {
    const { container } = render(<StudyProgressBar current={1} total={4} />)
    const gradientBar = container.querySelector('.bg-gradient-to-r') as HTMLElement
    // 1/4 = 25%, so clipPath should hide the right 75%
    expect(gradientBar.style.clipPath).toBe('inset(0 75% 0 0)')
  })

  it('shows full gradient at 100% progress', () => {
    const { container } = render(<StudyProgressBar current={10} total={10} />)
    const gradientBar = container.querySelector('.bg-gradient-to-r') as HTMLElement
    expect(gradientBar.style.clipPath).toBe('inset(0 0% 0 0)')
  })

  it('clips everything at 0% progress', () => {
    const { container } = render(<StudyProgressBar current={0} total={10} />)
    const gradientBar = container.querySelector('.bg-gradient-to-r') as HTMLElement
    expect(gradientBar.style.clipPath).toBe('inset(0 100% 0 0)')
  })

  it('handles total=0 without crashing', () => {
    const { container } = render(<StudyProgressBar current={0} total={0} />)
    const gradientBar = container.querySelector('.bg-gradient-to-r') as HTMLElement
    expect(gradientBar.style.clipPath).toBe('inset(0 100% 0 0)')
  })
})
