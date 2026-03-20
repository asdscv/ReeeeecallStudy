import type { StudyMode } from '../types/database'

export type KeyAction =
  | { type: 'flip' }
  | { type: 'rate'; rating: string }
  | { type: 'exit' }
  | { type: 'pause' }
  | { type: 'undo' }
  | { type: 'help' }
  | null

/**
 * Pure function: resolve a keyboard event into a study action.
 * Returns null if the key should be ignored.
 */
export function resolveKeyAction(
  key: string,
  isFlipped: boolean,
  mode: StudyMode,
  options?: { ctrlKey?: boolean; isPaused?: boolean },
): KeyAction {
  const ctrlKey = options?.ctrlKey ?? false
  const isPaused = options?.isPaused ?? false

  // Help toggle always available
  if (key === '?') return { type: 'help' }

  // Undo: Ctrl+Z
  if (ctrlKey && (key === 'z' || key === 'Z')) return { type: 'undo' }

  if (key === 'Escape') return { type: 'exit' }

  // When paused, only Space resumes (no flipping or rating)
  if (isPaused) {
    if (key === ' ') return { type: 'pause' }
    return null
  }

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

  // Non-SRS modes (sequential_review, random, sequential, by_date)
  if (key === 'ArrowRight' || key === ' ') return { type: 'rate', rating: 'known' }
  if (key === 'ArrowLeft') return { type: 'rate', rating: 'unknown' }

  return null
}
