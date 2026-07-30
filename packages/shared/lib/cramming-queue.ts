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

export interface CrammingQueueSnapshot {
  queue: string[]
  cursor: number
  round: number
  cardStates: Map<string, CrammingCardState>
  roundUniqueTotal: number
  nextRoundMissed: Set<string>
}

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
 * Manages a cramming session as discrete rounds.
 *
 * Each unique card is rated exactly once per round. Cards rated `missed`
 * become the next round; cards rated `got_it` are permanently mastered.
 * The manager never modifies SRS state.
 */
export class CrammingQueueManager {
  private queue: string[] // fixed unique card IDs for the current round
  private cursor: number = 0
  private round: number = 1
  private readonly cardStates: Map<string, CrammingCardState>
  private readonly allCardIds: string[] // original unique set, first-seen order
  private readonly shouldShuffle: boolean
  private readonly timeLimitMs: number | null
  private readonly startTime: number
  private roundUniqueTotal: number
  private nextRoundMissed: Set<string> = new Set()

  constructor(cardIds: string[], config: CrammingConfig) {
    const uniqueCardIds = [...new Set(cardIds)]
    this.allCardIds = uniqueCardIds
    this.shouldShuffle = config.shuffleCards
    this.timeLimitMs = config.timeLimitMinutes != null ? config.timeLimitMinutes * 60 * 1000 : null
    this.startTime = Date.now()
    this.cardStates = new Map()

    for (const id of uniqueCardIds) {
      this.cardStates.set(id, {
        cardId: id,
        totalAttempts: 0,
        missedCount: 0,
        lastRating: null,
        masteredInRound: null,
      })
    }

    this.queue = this.shouldShuffle ? shuffleArray(uniqueCardIds) : [...uniqueCardIds]
    this.roundUniqueTotal = uniqueCardIds.length
  }

  /** Get the current card ID without side effects */
  currentCardId(): string | null {
    if (this.isSessionComplete()) return null
    if (this.cursor >= this.queue.length) return null
    return this.queue[this.cursor] ?? null
  }

  /** Rate the current card once and advance to the next card or round. */
  rateCard(rating: CrammingRating): void {
    if (this.isSessionComplete()) return

    const cardId = this.queue[this.cursor]
    if (!cardId) return

    const state = this.cardStates.get(cardId)!
    state.totalAttempts++
    state.lastRating = rating

    if (rating === 'missed') {
      state.missedCount++
      this.nextRoundMissed.add(cardId)
    } else if (state.masteredInRound === null) {
      state.masteredInRound = this.round
    }

    this.cursor++

    if (this.cursor >= this.queue.length && !this._isAllMasteredOrTimedOut()) {
      this._advanceRound()
    }
  }

  /** Check if all cards are mastered or time limit reached (without public side effects) */
  private _isAllMasteredOrTimedOut(): boolean {
    if (this.timeLimitMs != null) {
      const elapsed = Date.now() - this.startTime
      if (elapsed >= this.timeLimitMs) return true
    }
    return this.isAllMastered()
  }

  /** Advance with exactly the cards missed in the completed round. */
  private _advanceRound(): void {
    const missedIds = [...this.nextRoundMissed]
    if (missedIds.length === 0) return

    this.round++
    this.cursor = 0
    this.queue = this.shouldShuffle ? shuffleArray(missedIds) : missedIds
    this.roundUniqueTotal = missedIds.length
    this.nextRoundMissed = new Set()
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

  /** Number of cards not yet rated in the current round. */
  remainingInRound(): number {
    return Math.max(0, this.queue.length - this.cursor)
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
      .sort((a, b) => b.missedCount - a.missedCount || a.cardId.localeCompare(b.cardId))
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

  /** Create a snapshot of the current state for undo */
  snapshot(): CrammingQueueSnapshot {
    const cardStates = new Map<string, CrammingCardState>()
    for (const [k, v] of this.cardStates) {
      cardStates.set(k, { ...v })
    }
    return {
      queue: [...this.queue],
      cursor: this.cursor,
      round: this.round,
      cardStates,
      roundUniqueTotal: this.roundUniqueTotal,
      nextRoundMissed: new Set(this.nextRoundMissed),
    }
  }

  /** Restore from a snapshot */
  restore(snap: CrammingQueueSnapshot): void {
    this.queue = [...snap.queue]
    this.cursor = snap.cursor
    this.round = snap.round
    this.roundUniqueTotal = snap.roundUniqueTotal
    this.nextRoundMissed = new Set(snap.nextRoundMissed)
    this.cardStates.clear()
    for (const [k, v] of snap.cardStates) {
      this.cardStates.set(k, { ...v })
    }
  }
}
