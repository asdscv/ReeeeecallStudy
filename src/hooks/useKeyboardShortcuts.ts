import { useEffect } from 'react'
import type { StudyMode } from '../types/database'
import { resolveKeyAction } from '../lib/keyboard-actions'

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

      const action = resolveKeyAction(e.key, isFlipped, mode)
      if (!action) return

      switch (action.type) {
        case 'exit':
          onExit()
          break
        case 'flip':
          e.preventDefault()
          onFlip()
          break
        case 'rate':
          e.preventDefault()
          onRate(action.rating)
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isFlipped, mode, onFlip, onRate, onExit])
}
