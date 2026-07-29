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

// ─── Sequential Queue Builders ──────────────────────────────

interface SeqCard {
  id: string
  sort_position: number
  srs_status: 'new' | 'learning' | 'review' | 'suspended'
}

function compareSequentialCards(a: SeqCard, b: SeqCard): number {
  if (a.sort_position !== b.sort_position) return a.sort_position - b.sort_position
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

function stableUnique<T extends SeqCard>(cards: T[]): T[] {
  const seen = new Set<string>()
  return [...cards]
    .sort(compareSequentialCards)
    .filter(card => {
      if (seen.has(card.id)) return false
      seen.add(card.id)
      return true
    })
}

/** Take at least requested cards without splitting the boundary position group. */
function takeTieSafe<T extends SeqCard>(sortedCards: T[], requested: number): T[] {
  if (sortedCards.length === 0 || requested <= 0) return []

  const limit = Math.floor(requested)
  if (limit >= sortedCards.length) return [...sortedCards]

  const boundaryPosition = sortedCards[limit - 1].sort_position
  let end = limit
  while (end < sortedCards.length && sortedCards[end].sort_position === boundaryPosition) {
    end++
  }
  return sortedCards.slice(0, end)
}

/** Select from cursor onward, then wrap once before cursor if the batch is short. */
function selectCyclicTieSafe<T extends SeqCard>(cards: T[], cursor: number, requested: number): T[] {
  if (requested <= 0) return []

  const sorted = stableUnique(cards)
  const primary = sorted.filter(card => card.sort_position >= cursor)
  const selected = takeTieSafe(primary, requested)
  if (selected.length >= requested) return selected

  const selectedIds = new Set(selected.map(card => card.id))
  const beforeCursor = sorted.filter(
    card => card.sort_position < cursor && !selectedIds.has(card.id),
  )
  const wrapped = takeTieSafe(beforeCursor, requested - selected.length)
  return [...selected, ...wrapped]
}

/** Build a plain sequential queue with stable, tie-safe, one-wrap selection. */
export function buildSequentialQueue<T extends SeqCard>(
  allCards: T[],
  cursor: number,
  batchSize: number,
): T[] {
  const eligible = allCards.filter(card => card.srs_status !== 'suspended')
  return selectCyclicTieSafe(eligible, cursor, batchSize)
}

/**
 * Build the sequential review queue with stable, tie-safe wrap-around support.
 * New and review cursors each get one cyclic pass; no ID can repeat in a result.
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

  const newEligible = allCards.filter(card => card.srs_status === 'new')
  const newCards = selectCyclicTieSafe(newEligible, state.new_start_pos, newBatchSize)

  const reviewable = allCards.filter(
    card => card.srs_status !== 'new' && card.srs_status !== 'suspended',
  )
  const reviewWindow = newCards.length > 0 && state.new_start_pos > state.review_start_pos
    ? reviewable.filter(card => card.sort_position < state.new_start_pos)
    : reviewable
  const reviewCards = selectCyclicTieSafe(
    reviewWindow,
    state.review_start_pos,
    reviewBatchSize,
  )

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

// ─── Plain Sequential Position Computation ──────────────────

/** Compute the next plain sequential cursor without skipping a partially studied tie group. */
export function computeSequentialPosition(
  queue: Pick<Card, 'sort_position'>[],
  cardsStudied: number,
  currentCursor: number,
  maxCardPosition: number,
): number {
  const studiedCount = Math.max(0, Math.min(queue.length, Math.floor(cardsStudied)))
  const nextUnstudied = queue[studiedCount]
  if (nextUnstudied) return nextUnstudied.sort_position

  const studiedCards = queue.slice(0, studiedCount)
  if (studiedCards.length === 0) return currentCursor

  const wrappedCards = studiedCards.filter(card => card.sort_position < currentCursor)
  const nextPosition = wrappedCards.length > 0
    ? Math.max(...wrappedCards.map(card => card.sort_position)) + 1
    : Math.max(...studiedCards.map(card => card.sort_position)) + 1
  return nextPosition > maxCardPosition ? 0 : nextPosition
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
function computeStudiedSequentialReviewPositions(
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

/**
 * Compute sequential-review cursors from the cards actually studied, while
 * retaining the next unstudied tie position on an early exit.
 */
export function computeSequentialReviewPositions(
  queue: Pick<Card, 'sort_position' | 'srs_status'>[],
  currentState: Pick<DeckStudyState, 'new_start_pos' | 'review_start_pos'>,
  maxCardPosition?: number,
  cardsStudied: number = queue.length,
): { new_start_pos: number; review_start_pos: number } {
  const studiedCount = Math.max(0, Math.min(queue.length, Math.floor(cardsStudied)))
  const studiedCards = queue.slice(0, studiedCount)
  const positions = computeStudiedSequentialReviewPositions(
    studiedCards,
    currentState,
    maxCardPosition,
  )
  const nextUnstudied = queue[studiedCount]
  if (!nextUnstudied) return positions

  if (nextUnstudied.srs_status === 'new') {
    return { ...positions, new_start_pos: nextUnstudied.sort_position }
  }
  return { ...positions, review_start_pos: nextUnstudied.sort_position }
}
