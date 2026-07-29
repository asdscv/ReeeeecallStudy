import { calculateSRS, type SrsRating, type SrsCardData, type SrsResult } from './srs'
import type { SrsSettings } from '../types/database'

// ─── Types ──────────────────────────────────────────────────

export interface QueueCard extends SrsCardData {
  id: string
}

export interface SrsDelayedQueueCard {
  card: QueueCard
  dueAt: number
  sequence: number
}

export interface SrsQueueSnapshot {
  queue: QueueCard[]
  cursor: number
  studied: number
  delayedQueue: SrsDelayedQueueCard[]
  nextSequence: number
}

// ─── SrsQueueManager ───────────────────────────────────────

/**
 * Manages the immediately eligible and timestamp-delayed cards in an SRS session.
 *
 * Key behaviors:
 * - Initial due learning cards precede review cards, which precede new cards
 * - A learning result is delayed until its persisted next_review_at timestamp
 * - Due delayed cards are promoted ahead of waiting review/new cards
 * - Future-only delayed work does not keep the current session open
 * - Tracks rating actions for session statistics
 */
export class SrsQueueManager {
  private queue: QueueCard[]
  private cursor = 0
  private studied = 0
  private delayedQueue: SrsDelayedQueueCard[] = []
  private nextSequence = 0
  private readonly originalCount: number
  private readonly srsSettings?: SrsSettings
  private readonly clock: () => number

  constructor(cards: QueueCard[], srsSettings?: SrsSettings, clock: () => number = Date.now) {
    this.srsSettings = srsSettings
    this.clock = clock
    this.originalCount = cards.length

    // Sort: due learning first, then review, then new. Array#sort is stable, so
    // source ordering remains deterministic inside each status group.
    this.queue = [...cards].sort((a, b) => {
      const order = { learning: 0, review: 1, new: 2, suspended: 3 }
      return (order[a.srs_status] ?? 3) - (order[b.srs_status] ?? 3)
    })
  }

  /** Get the current immediately eligible card without advancing. */
  currentCard(): QueueCard | null {
    this.promoteDueCards()
    if (this.cursor >= this.queue.length) return null
    return this.queue[this.cursor]
  }

  /**
   * Consume the current card. Only an explicit learning result schedules another
   * presentation; the rating string itself never implies an early requeue.
   */
  rateCard(_rating: SrsRating | string, result?: SrsResult): void {
    const card = this.currentCard()
    if (!card) return

    this.studied++
    this.cursor++

    if (result?.srs_status !== 'learning') return

    const dueAt = Date.parse(result.next_review_at)
    if (!Number.isFinite(dueAt)) return

    this.delayedQueue.push({
      card: {
        ...card,
        ease_factor: result.ease_factor,
        interval_days: result.interval_days,
        repetitions: result.repetitions,
        srs_status: result.srs_status,
      },
      dueAt,
      sequence: this.nextSequence++,
    })
    this.delayedQueue.sort((a, b) => a.dueAt - b.dueAt || a.sequence - b.sequence)
  }

  /** Get the SRS calculation result for a hypothetical rating on the current card. */
  getSrsResult(rating: SrsRating): SrsResult | null {
    const card = this.currentCard()
    if (!card) return null
    return calculateSRS(card, rating, this.srsSettings)
  }

  /** Number of cards eligible at the current clock instant. */
  remaining(): number {
    this.promoteDueCards()
    return Math.max(0, this.queue.length - this.cursor)
  }

  /** Whether no card is eligible without waiting for a future timestamp. */
  isComplete(): boolean {
    this.promoteDueCards()
    return this.cursor >= this.queue.length
  }

  /** Number of rating actions in this session. */
  studiedCount(): number {
    return this.studied
  }

  /** Original number of unique cards loaded into the queue. */
  totalCards(): number {
    return this.originalCount
  }

  /** Create an independent snapshot of ready and delayed state for undo. */
  snapshot(): SrsQueueSnapshot {
    return {
      queue: this.queue.map(card => ({ ...card })),
      cursor: this.cursor,
      studied: this.studied,
      delayedQueue: this.delayedQueue.map(entry => ({
        ...entry,
        card: { ...entry.card },
      })),
      nextSequence: this.nextSequence,
    }
  }

  /** Restore ready and delayed state from an undo snapshot. */
  restore(snap: SrsQueueSnapshot): void {
    this.queue = snap.queue.map(card => ({ ...card }))
    this.cursor = snap.cursor
    this.studied = snap.studied
    this.delayedQueue = snap.delayedQueue.map(entry => ({
      ...entry,
      card: { ...entry.card },
    }))
    this.nextSequence = snap.nextSequence
  }

  private promoteDueCards(): void {
    if (this.delayedQueue.length === 0) return

    const now = this.clock()
    let dueCount = 0
    while (dueCount < this.delayedQueue.length && this.delayedQueue[dueCount].dueAt <= now) {
      dueCount++
    }
    if (dueCount === 0) return

    const dueCards = this.delayedQueue.splice(0, dueCount).map(entry => entry.card)
    this.queue.splice(this.cursor, 0, ...dueCards)
  }
}
