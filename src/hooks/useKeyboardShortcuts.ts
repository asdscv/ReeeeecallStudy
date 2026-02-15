import { useEffect } from 'react'
import type { StudyMode } from '../types/database'

interface UseKeyboardShortcutsOptions {
  isFlipped: boolean
  mode: StudyMode
  onFlip: () => void
  onRate: (rating: string) => void
  onExit: () => void
}

export function useKeyboardShortcuts({
  isFlipped,
  mode,
  onFlip,
  onRate,
  onExit,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if inside an input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      if (e.key === 'Escape') {
        onExit()
        return
      }

      if (!isFlipped) {
        // Front side: flip
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onFlip()
        }
      } else {
        // Back side: rate
        if (mode === 'srs') {
          if (e.key === '1') onRate('again')
          else if (e.key === '2') onRate('hard')
          else if (e.key === '3') onRate('good')
          else if (e.key === '4') onRate('easy')
        } else {
          // Non-SRS modes
          if (e.key === 'ArrowRight' || e.key === ' ') {
            e.preventDefault()
            if (mode === 'sequential_review') {
              onRate('known')
            } else {
              onRate('next')
            }
          }
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isFlipped, mode, onFlip, onRate, onExit])
}
