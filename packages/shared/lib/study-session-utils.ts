import type { Card, DeckStudyState, StudyMode } from '../types/database'

// ─── Study Mode Options ─────────────────────────────────────

export interface StudyModeOption {
  value: StudyMode
  emoji: string
  label: string
  desc: string
  detail: string
}

export const STUDY_MODE_OPTIONS: StudyModeOption[] = [
  { value: 'srs', emoji: '🧠', label: 'study:modes.srs.label', desc: 'study:modes.srs.description', detail: 'study:modes.srs.detail' },
  { value: 'sequential_review', emoji: '🔄', label: 'study:modes.sequential_review.label', desc: 'study:modes.sequential_review.description', detail: 'study:modes.sequential_review.detail' },
  { value: 'random', emoji: '🎲', label: 'study:modes.random.label', desc: 'study:modes.random.description', detail: 'study:modes.random.detail' },
  { value: 'sequential', emoji: '➡️', label: 'study:modes.sequential.label', desc: 'study:modes.sequential.description', detail: 'study:modes.sequential.detail' },
  { value: 'by_date', emoji: '📅', label: 'study:modes.by_date.label', desc: 'study:modes.by_date.description', detail: 'study:modes.by_date.detail' },
  { value: 'cramming', emoji: '⚡', label: 'study:modes.cramming.label', desc: 'study:modes.cramming.description', detail: 'study:modes.cramming.detail' },
]

// ─── Batch Size ─────────────────────────────────────────────

export const DEFAULT_BATCH_SIZE = 20
export const MIN_BATCH_SIZE = 1
export const MAX_BATCH_SIZE = 1000

/** Whether a study mode supports user-configurable batch size. */
export function isBatchSizeConfigurable(mode: StudyMode): boolean {
  return mode !== 'srs' && mode !== 'by_date' && mode !== 'cramming'
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
    if (state.new_start_pos > state.review_start_pos) {
      // Normal: review the window [review_start_pos, new_start_pos)
      reviewCards = reviewable
        .filter(c => c.sort_position >= state.review_start_pos && c.sort_position < state.new_start_pos)
        .slice(0, reviewBatchSize)
    } else {
      // Initial state or positions overlap: review from review_start_pos with no upper bound
      reviewCards = reviewable
        .filter(c => c.sort_position >= state.review_start_pos)
        .slice(0, reviewBatchSize)
    }
  } else {
    // No new cards — review from review_start_pos onward
    reviewCards = reviewable
      .filter(c => c.sort_position >= state.review_start_pos)
      .slice(0, reviewBatchSize)

    // Wrap around: if we got fewer than the batch size, fill from the beginning
    if (reviewCards.length < reviewBatchSize && reviewable.length > 0) {
      const remaining = reviewBatchSize - reviewCards.length
      const selectedIds = new Set(reviewCards.map(c => c.id))
      const wrapCards = reviewable
        .filter(c => !selectedIds.has(c.id))
        .slice(0, remaining)
      reviewCards = [...reviewCards, ...wrapCards]
    }
  }

  return { newCards, reviewCards }
}

// ─── Per-Card Position Advance ──────────────────────────────

/**
 * Compute the next sequential_review position after a single card is rated.
 *
 * - For new cards: advance new_start_pos (never wrap — exceeding max signals "all consumed")
 * - For review/learning cards: advance review_start_pos (wrap to 0 when past maxCardPosition)
 */
export function advanceSequentialReviewPosition(
  card: Pick<Card, 'sort_position' | 'srs_status'>,
  maxCardPosition: number,
): { new_start_pos?: number; review_start_pos?: number } {
  const nextPos = card.sort_position + 1
  if (card.srs_status === 'new') {
    return { new_start_pos: nextPos }  // never wrap
  }
  return { review_start_pos: nextPos > maxCardPosition ? 0 : nextPos }
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
    // Advance past new cards — do NOT wrap to 0 (exceeding max signals "all new cards consumed")
    const newMaxPos = Math.max(...newCards.map(c => c.sort_position)) + 1
    // Track review cards actually studied in this session
    const reviewCards = queue.filter(c => c.srs_status !== 'new')
    let reviewPos: number
    if (reviewCards.length > 0) {
      reviewPos = Math.max(...reviewCards.map(c => c.sort_position)) + 1
    } else {
      reviewPos = currentState.new_start_pos
    }
    return {
      new_start_pos: newMaxPos,
      review_start_pos: reviewPos,
    }
  }

  // No new cards in queue — only review cards were studied
  // Detect if the queue contains wrapped-around cards (positions before review_start_pos)
  const wrappedCards = queue.filter(c => c.sort_position < currentState.review_start_pos)

  if (wrappedCards.length > 0) {
    // Queue wrapped around — next position is after the last wrapped card
    const maxWrappedPos = Math.max(...wrappedCards.map(c => c.sort_position))
    return {
      new_start_pos: currentState.new_start_pos,
      review_start_pos: maxWrappedPos + 1,
    }
  }

  // No wrap — advance past studied cards
  const maxStudiedPos = Math.max(...queue.map(c => c.sort_position))
  const nextReviewPos = maxStudiedPos + 1

  // Wrap around if we've gone past all cards
  const shouldWrap = maxCardPosition !== undefined && nextReviewPos > maxCardPosition

  return {
    new_start_pos: currentState.new_start_pos,
    review_start_pos: shouldWrap ? 0 : nextReviewPos,
  }
}
