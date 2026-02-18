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

// ─── Sequential Review Queue Builder ────────────────────────

interface SeqCard {
  id: string
  sort_position: number
  srs_status: 'new' | 'learning' | 'review' | 'suspended'
}

/**
 * Build the sequential review queue with wrap-around support.
 *
 * Logic:
 * 1. Fetch new cards (srs_status='new') starting from new_start_pos
 * 2. Fetch review cards (non-new, non-suspended) starting from review_start_pos
 * 3. If no new cards AND no review cards from current positions, wrap around to 0
 * 4. Returns { newCards, reviewCards } for the session
 */
export function buildSequentialReviewQueue<T extends SeqCard>(
  allCards: T[],
  state: Pick<DeckStudyState, 'new_start_pos' | 'review_start_pos'>,
  newBatchSize: number,
  reviewBatchSize: number,
): { newCards: T[]; reviewCards: T[] } {
  if (allCards.length === 0) {
    return { newCards: [], reviewCards: [] }
  }

  const sorted = [...allCards].sort((a, b) => a.sort_position - b.sort_position)

  // --- New cards ---
  const newCards = sorted
    .filter(c => c.srs_status === 'new' && c.sort_position >= state.new_start_pos)
    .slice(0, newBatchSize)

  // --- Review cards ---
  const reviewable = sorted.filter(c => c.srs_status !== 'new' && c.srs_status !== 'suspended')

  let reviewCards: T[]

  if (newCards.length > 0) {
    // Have new cards — review the window [review_start_pos, new_start_pos)
    reviewCards = reviewable
      .filter(c => c.sort_position >= state.review_start_pos && c.sort_position < state.new_start_pos)
      .slice(0, reviewBatchSize)
  } else {
    // No new cards — review from review_start_pos onward
    reviewCards = reviewable
      .filter(c => c.sort_position >= state.review_start_pos)
      .slice(0, reviewBatchSize)

    // If no review cards found, wrap around to beginning
    if (reviewCards.length === 0 && reviewable.length > 0) {
      reviewCards = reviewable.slice(0, reviewBatchSize)
    }
  }

  return { newCards, reviewCards }
}

// ─── Position Computation ───────────────────────────────────

/**
 * Compute new positions for sequential_review mode after a session ends.
 *
 * Enhanced with wrap-around:
 * - When new cards exist: advance new_start_pos, shift review window
 * - When only review cards: advance review_start_pos past studied cards
 * - When positions exceed maxCardPosition: wrap to 0
 *
 * @param maxCardPosition - Maximum sort_position across all cards in the deck (for wrap detection)
 */
export function computeSequentialReviewPositions(
  queue: Pick<Card, 'sort_position' | 'srs_status'>[],
  currentState: Pick<DeckStudyState, 'new_start_pos' | 'review_start_pos'>,
  maxCardPosition?: number,
): { new_start_pos: number; review_start_pos: number } {
  if (queue.length === 0) {
    return {
      new_start_pos: currentState.new_start_pos,
      review_start_pos: currentState.review_start_pos,
    }
  }

  const newCards = queue.filter(c => c.srs_status === 'new')

  if (newCards.length > 0) {
    // Normal case: advance past new cards
    const newMaxPos = Math.max(...newCards.map(c => c.sort_position)) + 1
    return {
      new_start_pos: newMaxPos,
      review_start_pos: currentState.new_start_pos,
    }
  }

  // No new cards in queue — only review cards were studied
  // Advance review_start_pos past the studied review cards
  const maxStudiedPos = Math.max(...queue.map(c => c.sort_position))
  const nextReviewPos = maxStudiedPos + 1

  // Wrap around if we've gone past all cards
  const shouldWrap = maxCardPosition !== undefined && nextReviewPos > maxCardPosition

  return {
    new_start_pos: currentState.new_start_pos,
    review_start_pos: shouldWrap ? 0 : nextReviewPos,
  }
}
