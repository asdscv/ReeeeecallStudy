import { useEffect } from 'react'
import type { StudyMode } from '../types/database'
import { resolveKeyAction } from '../lib/keyboard-actions'

interface UseKeyboardShortcutsOptions {
  isFlipped: boolean
  mode: StudyMode
  onFlip: () => void
  onRate: (rating: string) => void
  onExit: () => void
  onUndo?: () => void
  onHelp?: () => void
}

export function useKeyboardShortcuts({
  isFlipped,
  mode,
  onFlip,
  onRate,
  onExit,
  onUndo,
  onHelp,
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

      const action = resolveKeyAction(e.key, isFlipped, mode, {
        ctrlKey: e.ctrlKey || e.metaKey,
      })
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
        case 'undo':
          e.preventDefault()
          onUndo?.()
          break
        case 'help':
          e.preventDefault()
          onHelp?.()
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isFlipped, mode, onFlip, onRate, onExit, onUndo, onHelp])
}
