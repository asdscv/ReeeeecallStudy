import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePomodoro } from '../usePomodoro'

describe('usePomodoro', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes with focusMinutes * 60 seconds', () => {
    const { result } = renderHook(() => usePomodoro(25, 5))
    expect(result.current.timeLeft).toBe(25 * 60)
    expect(result.current.isRunning).toBe(false)
    expect(result.current.isBreak).toBe(false)
  })

  it('initializes with custom focus minutes', () => {
    const { result } = renderHook(() => usePomodoro(10, 3))
    expect(result.current.timeLeft).toBe(10 * 60)
  })

  it('counts down when started', () => {
    const { result } = renderHook(() => usePomodoro(25, 5))

    act(() => {
      result.current.start()
    })

    expect(result.current.isRunning).toBe(true)

    act(() => {
      vi.advanceTimersByTime(3000) // 3 seconds
    })

    expect(result.current.timeLeft).toBe(25 * 60 - 3)
  })

  it('switches to break after focus ends', () => {
    const { result } = renderHook(() => usePomodoro(1, 1)) // 1 min focus, 1 min break

    act(() => {
      result.current.start()
    })

    // Advance past focus period (60 seconds)
    act(() => {
      vi.advanceTimersByTime(60 * 1000)
    })

    expect(result.current.isBreak).toBe(true)
    // Should now be counting break time
    expect(result.current.timeLeft).toBeLessThanOrEqual(60)
  })

  it('resets correctly', () => {
    const { result } = renderHook(() => usePomodoro(25, 5))

    act(() => {
      result.current.start()
    })

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(result.current.timeLeft).toBeLessThan(25 * 60)

    act(() => {
      result.current.reset()
    })

    expect(result.current.timeLeft).toBe(25 * 60)
    expect(result.current.isRunning).toBe(false)
    expect(result.current.isBreak).toBe(false)
  })

  it('pauses the timer', () => {
    const { result } = renderHook(() => usePomodoro(25, 5))

    act(() => {
      result.current.start()
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    const timeAtPause = result.current.timeLeft

    act(() => {
      result.current.pause()
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.timeLeft).toBe(timeAtPause)
    expect(result.current.isRunning).toBe(false)
  })

  it('calculates progress correctly', () => {
    const { result } = renderHook(() => usePomodoro(1, 1)) // 1 min = 60 sec

    expect(result.current.progress).toBe(0)

    act(() => {
      result.current.start()
    })

    act(() => {
      vi.advanceTimersByTime(30 * 1000) // 30 seconds of 60
    })

    // progress = (60 - 30) / 60 * 100 = 50%
    expect(result.current.progress).toBe(50)
  })
})
