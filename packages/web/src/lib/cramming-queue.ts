import type { Card } from '../types/database'

// ─── Types ──────────────────────────────────────────────

export type CrammingFilter =
  | { type: 'all' }
  | { type: 'weak'; maxEaseFactor: number }
  | { type: 'due_soon'; withinDays: number }
  | { type: 'tags'; tags: string[] }

export type CrammingRating = 'got_it' | 'missed'

export interface CrammingConfig {
  filter: CrammingFilter
  timeLimitMinutes: number | null
  shuffleCards: boolean
}

export interface CrammingCardState {
  cardId: string
  totalAttempts: number
  missedCount: number
  lastRating: CrammingRating | null
  masteredInRound: number | null
}

export interface CrammingHardCard {
  cardId: string
  missedCount: number
  frontText: string
}

// ─── Constants ──────────────────────────────────────────

/** How many cards to skip before showing a re-inserted "missed" card */
const REQUEUE_GAP = 2

// ─── Filter ─────────────────────────────────────────────

export function filterCardsForCramming(cards: Card[], filter: CrammingFilter): Card[] {
  const nonSuspended = cards.filter(c => c.srs_status !== 'suspended')

  switch (filter.type) {
    case 'all':
      return nonSuspended

    case 'weak':
      return nonSuspended.filter(c =>
        c.ease_factor <= filter.maxEaseFactor || c.srs_status === 'new'
      )

    case 'due_soon': {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() + filter.withinDays)
      const cutoffStr = cutoff.toISOString()
      return nonSuspended.filter(c =>
        c.srs_status === 'new' || (c.next_review_at && c.next_review_at <= cutoffStr)
      )
    }

    case 'tags':
      return nonSuspended.filter(c =>
        c.tags && filter.tags.some(tag => c.tags.includes(tag))
      )
  }
}

// ─── Shuffle ────────────────────────────────────────────

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

// ─── CrammingQueueManager ───────────────────────────────

/**
 * Manages a cramming study session with round-based mastery.
 *
 * Key behaviors:
 * - Round 1: all filtered cards (optionally shuffled)
 * - Within a round: "missed" cards are re-inserted after REQUEUE_GAP cards
 * - Round transition: only cards that were never "got_it" in the round move to next round
 * - Session completes when all cards are mastered OR time limit reached
 * - Does NOT modify SRS state
 */
export class CrammingQueueManager {
  private queue: string[] // card IDs (may contain duplicates from re-queue)
  private cursor: number = 0
  private round: number = 1
  private readonly cardStates: Map<string, CrammingCardState>
  private readonly allCardIds: string[] // original full set
  private readonly shouldShuffle: boolean
  private readonly timeLimitMs: number | null
  private readonly startTime: number
  private roundUniqueTotal: number // unique cards at start of round

  constructor(cardIds: string[], config: CrammingConfig) {
    this.allCardIds = [...cardIds]
    this.shouldShuffle = config.shuffleCards
    this.timeLimitMs = config.timeLimitMinutes != null ? config.timeLimitMinutes * 60 * 1000 : null
    this.startTime = Date.now()
    this.cardStates = new Map()

    for (const id of cardIds) {
      this.cardStates.set(id, {
        cardId: id,
        totalAttempts: 0,
        missedCount: 0,
        lastRating: null,
        masteredInRound: null,
      })
    }

    // Initialize round 1 queue
    this.queue = this.shouldShuffle ? shuffleArray(cardIds) : [...cardIds]
    this.roundUniqueTotal = cardIds.length
  }

  /** Get the current card ID without advancing */
  currentCardId(): string | null {
    if (this.isSessionComplete()) return null
    if (this.cursor >= this.queue.length) {
      // Round ended, transition to next round (single-path: only here)
      this._advanceRound()
      if (this.cursor >= this.queue.length) return null
    }
    return this.queue[this.cursor] ?? null
  }

  /** Rate the current card and advance */
  rateCard(rating: CrammingRating): void {
    const cardId = this.queue[this.cursor]
    if (!cardId) return

    const state = this.cardStates.get(cardId)!
    state.totalAttempts++
    state.lastRating = rating

    if (rating === 'missed') {
      state.missedCount++
      // Re-insert after REQUEUE_GAP cards
      const insertAt = Math.min(this.cursor + 1 + REQUEUE_GAP, this.queue.length)
      this.queue.splice(insertAt, 0, cardId)
    } else {
      // got_it
      if (state.masteredInRound === null) {
        state.masteredInRound = this.round
      }
    }

    this.cursor++
    // Round advancement is handled lazily by currentCardId()
  }

  /** Advance to the next round with only unmastered cards */
  private _advanceRound(): void {
    const unmasteredIds = this.allCardIds.filter(id => {
      const state = this.cardStates.get(id)!
      return state.masteredInRound === null
    })

    if (unmasteredIds.length === 0) return // All mastered

    this.round++
    this.cursor = 0
    this.queue = this.shouldShuffle ? shuffleArray(unmasteredIds) : [...unmasteredIds]
    this.roundUniqueTotal = unmasteredIds.length
  }

  /** Whether the session is complete (all mastered or time limit reached) */
  isSessionComplete(): boolean {
    if (this.timeLimitMs != null) {
      const elapsed = Date.now() - this.startTime
      if (elapsed >= this.timeLimitMs) return true
    }

    return this.isAllMastered()
  }

  /** Current round number */
  currentRound(): number {
    return this.round
  }

  /** Number of unique unmastered cards remaining in current round */
  remainingInRound(): number {
    // Count unique card IDs from cursor onwards that haven't been mastered yet
    const remaining = new Set<string>()
    for (let i = this.cursor; i < this.queue.length; i++) {
      const id = this.queue[i]
      const state = this.cardStates.get(id)
      if (state && state.masteredInRound === null) {
        remaining.add(id)
      }
    }
    return remaining.size
  }

  /** Total unique cards in current round at start */
  totalInRound(): number {
    return this.roundUniqueTotal
  }

  /** Percentage of all cards that have been mastered (0-100) */
  masteryPercentage(): number {
    if (this.allCardIds.length === 0) return 100
    const mastered = this.allCardIds.filter(id => {
      const state = this.cardStates.get(id)!
      return state.masteredInRound !== null
    }).length
    return Math.round((mastered / this.allCardIds.length) * 100)
  }

  /** Get the top N hardest cards (by missedCount descending) */
  getHardestCards(n: number = 5): CrammingCardState[] {
    return [...this.cardStates.values()]
      .filter(s => s.missedCount > 0)
      .sort((a, b) => b.missedCount - a.missedCount)
      .slice(0, n)
  }

  /** Remaining time in milliseconds (null if no time limit) */
  remainingTimeMs(): number | null {
    if (this.timeLimitMs == null) return null
    const elapsed = Date.now() - this.startTime
    return Math.max(0, this.timeLimitMs - elapsed)
  }

  /** Total number of unique cards in the session */
  totalCards(): number {
    return this.allCardIds.length
  }

  /** Total number of rating actions performed */
  totalAttempts(): number {
    let sum = 0
    for (const state of this.cardStates.values()) {
      sum += state.totalAttempts
    }
    return sum
  }

  /** Get card state by ID */
  getCardState(cardId: string): CrammingCardState | undefined {
    return this.cardStates.get(cardId)
  }

  /** Whether time limit is enabled */
  hasTimeLimit(): boolean {
    return this.timeLimitMs != null
  }

  /** Whether all cards are mastered (ignoring time) */
  isAllMastered(): boolean {
    return this.allCardIds.every(id => {
      const state = this.cardStates.get(id)!
      return state.masteredInRound !== null
    })
  }
}
