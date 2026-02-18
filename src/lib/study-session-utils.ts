import type { Card, DeckStudyState, StudyMode } from '../types/database'

// ─── Study Mode Options ─────────────────────────────────────

export interface StudyModeOption {
  value: StudyMode
  emoji: string
  label: string
  desc: string
}

export const STUDY_MODE_OPTIONS: StudyModeOption[] = [
  { value: 'srs', emoji: '🧠', label: 'study:modes.srs.label', desc: 'study:modes.srs.description' },
  { value: 'sequential_review', emoji: '🔄', label: 'study:modes.sequential_review.label', desc: 'study:modes.sequential_review.description' },
  { value: 'random', emoji: '🎲', label: 'study:modes.random.label', desc: 'study:modes.random.description' },
  { value: 'sequential', emoji: '➡️', label: 'study:modes.sequential.label', desc: 'study:modes.sequential.description' },
  { value: 'by_date', emoji: '📅', label: 'study:modes.by_date.label', desc: 'study:modes.by_date.description' },
]

// ─── Batch Size ─────────────────────────────────────────────

export const DEFAULT_BATCH_SIZE = 20
export const MIN_BATCH_SIZE = 1
export const MAX_BATCH_SIZE = 200

/** Whether a study mode supports user-configurable batch size. */
export function isBatchSizeConfigurable(mode: StudyMode): boolean {
  return mode !== 'srs' && mode !== 'by_date'
}

/** Clamp batch size to valid range. */
export function clampBatchSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE
  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, Math.round(value)))
}

// ─── Sequential Review ──────────────────────────────────────

/**
 * Compute new positions for sequential_review mode after a session ends.
 *
 * Sliding window logic:
 *   - new_start_pos advances past the new cards studied
 *   - review_start_pos shifts to the previous new_start_pos,
 *     so the next session reviews the batch just learned
 */
export function computeSequentialReviewPositions(
  queue: Pick<Card, 'sort_position' | 'srs_status'>[],
  currentState: Pick<DeckStudyState, 'new_start_pos' | 'review_start_pos'>,
): { new_start_pos: number; review_start_pos: number } {
  if (queue.length === 0) {
    return {
      new_start_pos: currentState.new_start_pos,
      review_start_pos: currentState.review_start_pos,
    }
  }

  const newCards = queue.filter(c => c.srs_status === 'new')
  const newMaxPos = newCards.length > 0
    ? Math.max(...newCards.map(c => c.sort_position)) + 1
    : currentState.new_start_pos

  return {
    new_start_pos: newMaxPos,
    review_start_pos: currentState.new_start_pos,
  }
}
