import { useEffect, useRef } from 'react'
import { computeScrollMilestone } from '../lib/scroll-depth'

/**
 * Tracks the maximum scroll depth milestone reached.
 * Returns a ref whose .current holds the max milestone (0–100).
 */
export function useScrollDepthTracking() {
  const maxMilestoneRef = useRef(0)

  useEffect(() => {
    let ticking = false

    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const scrollTop = window.scrollY
        const documentHeight = document.documentElement.scrollHeight
        const viewportHeight = window.innerHeight
        const milestone = computeScrollMilestone(scrollTop, documentHeight, viewportHeight)
        if (milestone > maxMilestoneRef.current) {
          maxMilestoneRef.current = milestone
        }
        ticking = false
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    // Check initial position (page may already be scrolled)
    onScroll()

    return () => {
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  return maxMilestoneRef
}
