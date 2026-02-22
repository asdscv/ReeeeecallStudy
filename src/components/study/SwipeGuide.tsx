import { useState, useEffect } from 'react'
import {
  getActionColor,
  getActionLabel,
  type SwipeDirectionMap,
  type SwipeAction,
} from '../../lib/study-input-settings'

interface SwipeGuideProps {
  directions: SwipeDirectionMap
  visible: boolean
}

type Direction = 'left' | 'right' | 'up' | 'down'

const DIRECTION_CONFIG: Record<Direction, { arrow: string; position: string }> = {
  left:  { arrow: '←', position: 'left-3 top-1/2 -translate-y-1/2' },
  right: { arrow: '→', position: 'right-3 top-1/2 -translate-y-1/2' },
  up:    { arrow: '↑', position: 'top-3 left-1/2 -translate-x-1/2' },
  down:  { arrow: '↓', position: 'bottom-3 left-1/2 -translate-x-1/2' },
}

export function SwipeGuide({ directions, visible }: SwipeGuideProps) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!visible) { setShow(false); return }
    setShow(true)
    const timer = setTimeout(() => setShow(false), 2000)
    return () => clearTimeout(timer)
  }, [visible])

  const entries = (Object.keys(DIRECTION_CONFIG) as Direction[]).filter(
    (dir) => directions[dir] !== '',
  )

  if (entries.length === 0) return null

  return (
    <>
      {entries.map((dir) => {
        const action = directions[dir] as Exclude<SwipeAction, ''>
        const { arrow, position } = DIRECTION_CONFIG[dir]
        const label = getActionLabel(action)

        return (
          <div
            key={dir}
            className={`absolute pointer-events-none flex items-center gap-1 transition-opacity duration-500 ${position}`}
            style={{ opacity: show ? 0.25 : 0, color: getActionColor(action, 1) }}
          >
            <span className="text-base sm:text-lg font-bold">{arrow}</span>
            <span className="hidden sm:inline text-[10px] font-semibold uppercase">{label}</span>
          </div>
        )
      })}
    </>
  )
}
