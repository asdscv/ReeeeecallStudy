import { calculateSRS, type SrsRating, type SrsCardData, type SrsResult } from './srs'
import type { SrsSettings } from '../types/database'

// ─── Constants ──────────────────────────────────────────────

/** How many cards to skip before showing a requeued "again" card */
const REQUEUE_GAP = 3

/** Maximum number of times a single card can be requeued (prevents infinite loops) */
const MAX_REQUEUE_PER_CARD = 3

// ─── Types ──────────────────────────────────────────────────

export interface QueueCard extends SrsCardData {
  id: string
}

// ─── SrsQueueManager ───────────────────────────────────────

/**
 * Manages a dynamic SRS study queue within a single session.
 *
 * Key behaviors:
 * - Cards rated "again" are re-inserted into the queue after a gap
 * - Learning cards are prioritized over review cards, which are prioritized over new cards
 * - Each card has a maximum requeue limit to prevent infinite loops
 * - Tracks study count for session statistics
 */
export class SrsQueueManager {
  private queue: QueueCard[]
  private cursor: number = 0
  private studied: number = 0
  private readonly requeueCount = new Map<string, number>()
  private readonly originalCount: number
  private readonly srsSettings?: SrsSettings

  constructor(cards: QueueCard[], srsSettings?: SrsSettings) {
    this.srsSettings = srsSettings
    this.originalCount = cards.length

    // Sort: learning first, then review, then new
    this.queue = [...cards].sort((a, b) => {
      const order = { learning: 0, review: 1, new: 2, suspended: 3 }
      return (order[a.srs_status] ?? 3) - (order[b.srs_status] ?? 3)
    })
  }

  /** Get the current card without advancing */
  currentCard(): QueueCard | null {
    if (this.cursor >= this.queue.length) return null
    return this.queue[this.cursor]
  }

  /** Rate the current card and advance. "again" cards are requeued. */
  rateCard(rating: SrsRating | string): void {
    const card = this.currentCard()
    if (!card) return

    this.studied++

    if (rating === 'again') {
      const count = this.requeueCount.get(card.id) ?? 0
      if (count < MAX_REQUEUE_PER_CARD) {
        this.requeueCount.set(card.id, count + 1)
        // Re-insert after REQUEUE_GAP cards (or at end if fewer cards remain)
        const insertAt = Math.min(this.cursor + 1 + REQUEUE_GAP, this.queue.length)
        this.queue.splice(insertAt, 0, card)
      }
    }

    this.cursor++
  }

  /** Get the SRS calculation result for a hypothetical rating on the current card */
  getSrsResult(rating: SrsRating): SrsResult | null {
    const card = this.currentCard()
    if (!card) return null
    return calculateSRS(card, rating, this.srsSettings)
  }

  /** Number of remaining cards (including requeued) */
  remaining(): number {
    return Math.max(0, this.queue.length - this.cursor)
  }

  /** Whether all cards have been processed */
  isComplete(): boolean {
    return this.cursor >= this.queue.length
  }

  /** Number of cards studied (each rating action counts as 1) */
  studiedCount(): number {
    return this.studied
  }

  /** Original number of unique cards loaded into the queue */
  totalCards(): number {
    return this.originalCount
  }
}
