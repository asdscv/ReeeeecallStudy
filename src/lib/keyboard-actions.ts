import type { StudyMode } from '../types/database'

export type KeyAction =
  | { type: 'flip' }
  | { type: 'rate'; rating: string }
  | { type: 'exit' }
  | null

/**
 * Pure function: resolve a keyboard event into a study action.
 * Returns null if the key should be ignored.
 */
export function resolveKeyAction(
  key: string,
  isFlipped: boolean,
  mode: StudyMode,
): KeyAction {
  if (key === 'Escape') return { type: 'exit' }

  if (!isFlipped) {
    if (key === ' ' || key === 'Enter') return { type: 'flip' }
    return null
  }

  // Back side — rate
  if (mode === 'srs') {
    if (key === '1') return { type: 'rate', rating: 'again' }
    if (key === '2') return { type: 'rate', rating: 'hard' }
    if (key === '3') return { type: 'rate', rating: 'good' }
    if (key === '4') return { type: 'rate', rating: 'easy' }
    return null
  }

  // Cramming mode
  if (mode === 'cramming') {
    if (key === 'ArrowRight' || key === ' ') return { type: 'rate', rating: 'got_it' }
    if (key === 'ArrowLeft') return { type: 'rate', rating: 'missed' }
    return null
  }

  // Non-SRS modes
  if (key === 'ArrowRight' || key === ' ') {
    if (mode === 'sequential_review') return { type: 'rate', rating: 'known' }
    return { type: 'rate', rating: 'next' }
  }

  if (key === 'ArrowLeft') {
    if (mode === 'sequential_review') return { type: 'rate', rating: 'unknown' }
    return null
  }

  return null
}
