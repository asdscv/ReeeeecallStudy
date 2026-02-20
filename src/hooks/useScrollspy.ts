import { useEffect, useState } from 'react'

export function useScrollspy(
  sectionIds: string[],
  options?: { rootMargin?: string },
) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const ratioMap = new Map<string, number>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratioMap.set(entry.target.id, entry.intersectionRatio)
        }

        let bestId: string | null = null
        let bestRatio = 0
        for (const id of sectionIds) {
          const ratio = ratioMap.get(id) ?? 0
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestId = id
          }
        }

        if (bestId) setActiveId(bestId)
      },
      {
        rootMargin: options?.rootMargin ?? '-10% 0px -60% 0px',
        threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
      },
    )

    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[]

    elements.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [sectionIds, options?.rootMargin])

  return activeId
}
