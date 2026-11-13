import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * Sessions this week out of the goal, as a ring that fills — the one progress figure the research
 * ties to outcomes (completed sessions), so it gets the hero spot instead of a streak.
 */
export function WeekRing({ done, goal, size = 96, label, color = '#FFFFFF', track = 'rgba(255,255,255,0.18)' }: { done: number; goal: number; size?: number; label: string; color?: string; track?: string }) {
  const reduced = useReducedMotion()
  const target = Math.min(1, goal > 0 ? done / goal : 0)
  // Starts empty and fills on the next frame, so the ring visibly fills when the screen opens.
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setShown(target))
    return () => cancelAnimationFrame(id)
  }, [target, reduced])
  const k = reduced ? target : shown
  const stroke = Math.max(6, size * 0.1)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - k)}
          style={{ transition: 'stroke-dashoffset 1100ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none" aria-hidden="true">
        <span className="font-black tabular-nums" style={{ fontSize: size * 0.3 }}>
          {done}
          <span className="opacity-60" style={{ fontSize: size * 0.18 }}>/{goal}</span>
        </span>
      </div>
    </div>
  )
}
