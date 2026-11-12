import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'

/** A number that counts up to its value — the score on the results screen. */
export function useCountUp(target: number, ms = 900): number {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (reduced) return
    let id = 0
    const start = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))))
      if (k < 1) id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [target, ms, reduced])
  return reduced ? target : value
}
