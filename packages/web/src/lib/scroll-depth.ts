export const SCROLL_MILESTONES = [0, 25, 50, 75, 100] as const

/**
 * Compute the highest scroll milestone reached.
 * Returns the nearest lower milestone (0, 25, 50, 75, 100).
 */
export function computeScrollMilestone(
  scrollTop: number,
  documentHeight: number,
  viewportHeight: number,
): number {
  // Guard against 0-height documents
  if (documentHeight <= 0) return 0

  // If page fits in viewport, user sees 100%
  if (documentHeight <= viewportHeight) return 100

  const scrollable = documentHeight - viewportHeight
  if (scrollable <= 0) return 100

  const ratio = Math.min(1, Math.max(0, scrollTop / scrollable))
  const percent = ratio * 100

  // Find highest milestone <= percent
  let milestone = 0
  for (const m of SCROLL_MILESTONES) {
    if (percent >= m) milestone = m
  }
  return milestone
}
