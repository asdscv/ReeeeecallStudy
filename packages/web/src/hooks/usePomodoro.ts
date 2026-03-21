import { useState, useRef, useCallback, useEffect } from 'react'

export interface PomodoroState {
  timeLeft: number
  isRunning: boolean
  isBreak: boolean
  progress: number
  start: () => void
  pause: () => void
  reset: () => void
}

export function usePomodoro(focusMinutes = 25, breakMinutes = 5): PomodoroState {
  const focusSeconds = focusMinutes * 60
  const breakSeconds = breakMinutes * 60

  const [timeLeft, setTimeLeft] = useState(focusSeconds)
  const [isRunning, setIsRunning] = useState(false)
  const [isBreak, setIsBreak] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    setIsRunning(true)
  }, [])

  const pause = useCallback(() => {
    setIsRunning(false)
    clearTimer()
  }, [clearTimer])

  const reset = useCallback(() => {
    clearTimer()
    setIsRunning(false)
    setIsBreak(false)
    setTimeLeft(focusSeconds)
  }, [clearTimer, focusSeconds])

  useEffect(() => {
    if (!isRunning) {
      clearTimer()
      return
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // Timer done — switch phase
          setIsBreak(wasBreak => {
            const nextIsBreak = !wasBreak
            setTimeLeft(nextIsBreak ? breakSeconds : focusSeconds)
            return nextIsBreak
          })
          return 0 // will be overwritten by setTimeLeft above
        }
        return prev - 1
      })
    }, 1000)

    return clearTimer
  }, [isRunning, clearTimer, focusSeconds, breakSeconds])

  const totalSeconds = isBreak ? breakSeconds : focusSeconds
  const progress = totalSeconds > 0 ? ((totalSeconds - timeLeft) / totalSeconds) * 100 : 0

  return { timeLeft, isRunning, isBreak, progress, start, pause, reset }
}
