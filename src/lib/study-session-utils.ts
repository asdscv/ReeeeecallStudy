import type { Card, DeckStudyState, StudyMode } from '../types/database'

// ─── Study Mode Options ─────────────────────────────────────

export interface StudyModeOption {
  value: StudyMode
  emoji: string
  label: string
  desc: string
}

export const STUDY_MODE_OPTIONS: StudyModeOption[] = [
  { value: 'srs', emoji: '🧠', label: 'SRS (간격 반복)', desc: '복습 시기에 따라 자동으로 카드를 선별합니다' },
  { value: 'sequential_review', emoji: '🔄', label: '순차 복습', desc: '새 카드와 복습 카드를 순서대로 학습합니다' },
  { value: 'random', emoji: '🎲', label: '랜덤', desc: '카드를 무작위로 섞어 학습합니다' },
  { value: 'sequential', emoji: '➡️', label: '순차', desc: '카드를 순서대로 학습합니다' },
  { value: 'by_date', emoji: '📅', label: '일자별 학습', desc: '특정 날짜에 업로드한 카드만 학습합니다' },
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
