import type { StudyMode } from '../types/database'

export type KeyAction =
  | { type: 'flip' }
  | { type: 'rate'; rating: string }
  | { type: 'exit' }
  | { type: 'undo' }
  | { type: 'help' }
  | null

/**
 * Pure function: resolve a keyboard event into a study action.
 * Returns null if the key should be ignored.
 *
 * Space/Enter = always flip (front↔back, both directions)
 * 1/2/3/4 = SRS rating (back side only)
 * Arrow keys = non-SRS rating (back side only)
 */
export function resolveKeyAction(
  key: string,
  isFlipped: boolean,
  mode: StudyMode,
  options?: { ctrlKey?: boolean },
): KeyAction {
  const ctrlKey = options?.ctrlKey ?? false

  // Help toggle always available
  if (key === '?') return { type: 'help' }

  // Undo: Ctrl+Z
  if (ctrlKey && (key === 'z' || key === 'Z')) return { type: 'undo' }

  if (key === 'Escape') return { type: 'exit' }

  // Space/Enter = flip (both directions: front→back AND back→front)
  if (key === ' ' || key === 'Enter') return { type: 'flip' }

  // Rating keys only work when card is flipped (back side)
  if (!isFlipped) return null

  // SRS mode: 1/2/3/4
  if (mode === 'srs') {
    if (key === '1') return { type: 'rate', rating: 'again' }
    if (key === '2') return { type: 'rate', rating: 'hard' }
    if (key === '3') return { type: 'rate', rating: 'good' }
    if (key === '4') return { type: 'rate', rating: 'easy' }
    return null
  }

  // Cramming mode: Arrow keys
  if (mode === 'cramming') {
    if (key === 'ArrowRight') return { type: 'rate', rating: 'got_it' }
    if (key === 'ArrowLeft') return { type: 'rate', rating: 'missed' }
    return null
  }

  // Non-SRS modes: Arrow keys
  if (key === 'ArrowRight') return { type: 'rate', rating: 'known' }
  if (key === 'ArrowLeft') return { type: 'rate', rating: 'unknown' }

  return null
}
