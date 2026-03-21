import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePomodoro } from '../../hooks/usePomodoro'

export interface PomodoroTimerProps {
  onBreakStart: () => void
  onBreakEnd: () => void
  compact?: boolean
}

function playBeep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.value = 0.3
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.stop(ctx.currentTime + 0.5)
    setTimeout(() => ctx.close(), 600)
  } catch {
    // Audio not available
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function PomodoroTimer({ onBreakStart, onBreakEnd, compact = false }: PomodoroTimerProps) {
  const { t } = useTranslation('common')
  const { timeLeft, isRunning, isBreak, progress, start, pause, reset } = usePomodoro(25, 5)
  const prevIsBreak = useRef(isBreak)
  const [expanded, setExpanded] = useState(!compact)

  // Detect phase transition
  useEffect(() => {
    if (prevIsBreak.current !== isBreak) {
      playBeep()
      if (isBreak) {
        onBreakStart()
      } else {
        onBreakEnd()
      }
      prevIsBreak.current = isBreak
    }
  }, [isBreak, onBreakStart, onBreakEnd])

  const radius = expanded ? 54 : 28
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (progress / 100) * circumference
  const strokeWidth = expanded ? 6 : 4
  const viewSize = (radius + strokeWidth) * 2
  const center = radius + strokeWidth

  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-4 right-4 z-50 bg-white dark:bg-gray-800 rounded-full shadow-lg p-2 flex items-center gap-2 border border-gray-200 dark:border-gray-700 hover:shadow-xl transition-shadow"
        title={t('pomodoro.focus')}
      >
        <svg width={viewSize} height={viewSize}>
          <circle
            cx={center} cy={center} r={radius}
            fill="none"
            stroke={isBreak ? '#10b981' : '#e5e7eb'}
            strokeWidth={strokeWidth}
          />
          <circle
            cx={center} cy={center} r={radius}
            fill="none"
            stroke={isBreak ? '#10b981' : '#3b82f6'}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${center} ${center})`}
          />
          <text x={center} y={center} textAnchor="middle" dominantBaseline="central"
            className="text-[10px] font-mono fill-gray-700 dark:fill-gray-300">
            {formatTime(timeLeft)}
          </text>
        </svg>
      </button>
    )
  }

  return (
    <div className={`${compact ? 'fixed bottom-4 right-4 z-50' : ''} bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 flex flex-col items-center gap-3 w-56`}>
      {compact && (
        <button
          onClick={() => setExpanded(false)}
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-xs"
        >
          &minus;
        </button>
      )}
      <div className={`text-xs font-medium uppercase tracking-wider ${isBreak ? 'text-green-600' : 'text-blue-600'}`}>
        {isBreak ? t('pomodoro.break') : t('pomodoro.focus')}
      </div>
      <svg width={viewSize} height={viewSize}>
        <circle
          cx={center} cy={center} r={radius}
          fill="none"
          stroke={isBreak ? '#d1fae5' : '#dbeafe'}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center} cy={center} r={radius}
          fill="none"
          stroke={isBreak ? '#10b981' : '#3b82f6'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform={`rotate(-90 ${center} ${center})`}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
        <text x={center} y={center} textAnchor="middle" dominantBaseline="central"
          className="text-lg font-mono font-bold fill-gray-800 dark:fill-gray-200">
          {formatTime(timeLeft)}
        </text>
      </svg>
      <div className="flex gap-2">
        {!isRunning ? (
          <button
            onClick={start}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('pomodoro.start')}
          </button>
        ) : (
          <button
            onClick={pause}
            className="px-3 py-1 text-sm bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
          >
            {t('pomodoro.pause')}
          </button>
        )}
        <button
          onClick={reset}
          className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          {t('pomodoro.reset')}
        </button>
      </div>
    </div>
  )
}
