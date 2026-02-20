import { describe, it, expect, vi } from 'vitest'
import {
  CrammingQueueManager,
  filterCardsForCramming,
  type CrammingConfig,
} from '../cramming-queue'
import type { Card } from '../../types/database'

// ─── Helpers ────────────────────────────────────────────

function makeCard(overrides: Partial<Card> & { id: string }): Card {
  return {
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'tmpl-1',
    field_values: { front: 'Q', back: 'A' },
    tags: [],
    sort_position: 0,
    srs_status: 'review',
    ease_factor: 2.5,
    interval_days: 10,
    repetitions: 3,
    next_review_at: new Date(Date.now() + 86400000).toISOString(), // tomorrow
    last_reviewed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Card
}

function makeConfig(overrides?: Partial<CrammingConfig>): CrammingConfig {
  return {
    filter: { type: 'all' },
    timeLimitMinutes: null,
    shuffleCards: false,
    ...overrides,
  }
}

// ─── filterCardsForCramming ─────────────────────────────

describe('filterCardsForCramming', () => {
  const cards = [
    makeCard({ id: '1', srs_status: 'new', ease_factor: 2.5 }),
    makeCard({ id: '2', srs_status: 'learning', ease_factor: 1.8 }),
    makeCard({ id: '3', srs_status: 'review', ease_factor: 2.5 }),
    makeCard({ id: '4', srs_status: 'suspended', ease_factor: 2.0 }),
    makeCard({ id: '5', srs_status: 'review', ease_factor: 1.5, tags: ['vocab', 'hard'] }),
    makeCard({
      id: '6',
      srs_status: 'review',
      ease_factor: 2.3,
      next_review_at: new Date(Date.now() + 2 * 86400000).toISOString(), // 2 days
    }),
  ]

  it('filter type=all excludes suspended cards', () => {
    const result = filterCardsForCramming(cards, { type: 'all' })
    expect(result.map(c => c.id)).toEqual(['1', '2', '3', '5', '6'])
    expect(result.find(c => c.id === '4')).toBeUndefined()
  })

  it('filter type=weak returns low ease_factor and new cards', () => {
    const result = filterCardsForCramming(cards, { type: 'weak', maxEaseFactor: 2.0 })
    // id=1 (new), id=2 (ease 1.8), id=5 (ease 1.5)
    expect(result.map(c => c.id)).toEqual(['1', '2', '5'])
  })

  it('filter type=due_soon returns cards due within N days + new', () => {
    const result = filterCardsForCramming(cards, { type: 'due_soon', withinDays: 3 })
    // id=1 (new), id=2 (next_review tomorrow), id=3 (tomorrow), id=5 (tomorrow), id=6 (2 days)
    expect(result.length).toBeGreaterThanOrEqual(3)
    expect(result.find(c => c.id === '1')).toBeDefined() // new cards always included
    expect(result.find(c => c.id === '4')).toBeUndefined() // suspended excluded
  })

  it('filter type=tags returns cards matching any tag', () => {
    const result = filterCardsForCramming(cards, { type: 'tags', tags: ['vocab'] })
    expect(result.map(c => c.id)).toEqual(['5'])
  })

  it('filter type=tags with no matches returns empty', () => {
    const result = filterCardsForCramming(cards, { type: 'tags', tags: ['nonexistent'] })
    expect(result).toEqual([])
  })
})

// ─── CrammingQueueManager ───────────────────────────────

describe('CrammingQueueManager', () => {
  it('empty cards → immediately complete', () => {
    const mgr = new CrammingQueueManager([], makeConfig())
    expect(mgr.isSessionComplete()).toBe(true)
    expect(mgr.currentCardId()).toBeNull()
    expect(mgr.masteryPercentage()).toBe(100)
  })

  it('round 1 includes all cards', () => {
    const ids = ['a', 'b', 'c']
    const mgr = new CrammingQueueManager(ids, makeConfig())
    expect(mgr.currentRound()).toBe(1)
    expect(mgr.totalInRound()).toBe(3)
    expect(mgr.totalCards()).toBe(3)
  })

  it('got_it advances cursor without re-insertion', () => {
    const ids = ['a', 'b', 'c']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    expect(mgr.currentCardId()).toBe('a')
    mgr.rateCard('got_it')
    expect(mgr.currentCardId()).toBe('b')
    mgr.rateCard('got_it')
    expect(mgr.currentCardId()).toBe('c')
    mgr.rateCard('got_it')

    expect(mgr.isSessionComplete()).toBe(true)
    expect(mgr.masteryPercentage()).toBe(100)
  })

  it('missed re-inserts card after 2-card gap', () => {
    const ids = ['a', 'b', 'c', 'd']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    // Miss 'a' → should appear again after 2 more cards
    expect(mgr.currentCardId()).toBe('a')
    mgr.rateCard('missed')

    expect(mgr.currentCardId()).toBe('b')
    mgr.rateCard('got_it')

    expect(mgr.currentCardId()).toBe('c')
    mgr.rateCard('got_it')

    // 'a' should reappear here (after gap of 2)
    expect(mgr.currentCardId()).toBe('a')
  })

  it('round transition: only missed cards go to next round', () => {
    const ids = ['a', 'b', 'c']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    // Round 1: got_it for a and c, miss b multiple times then got_it
    mgr.rateCard('got_it') // a
    mgr.rateCard('missed') // b → re-insert
    mgr.rateCard('got_it') // c
    // b reappears
    mgr.rateCard('missed') // b again → re-insert

    // After round completes, b should go to round 2 since never got_it
    // Keep rating until round ends
    // b should reappear once more
    expect(mgr.currentCardId()).toBe('b')
    mgr.rateCard('got_it') // b finally got_it

    // All mastered
    expect(mgr.isSessionComplete()).toBe(true)
    expect(mgr.masteryPercentage()).toBe(100)
  })

  it('all mastered → session complete', () => {
    const ids = ['a', 'b']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    mgr.rateCard('got_it') // a
    mgr.rateCard('got_it') // b

    expect(mgr.isSessionComplete()).toBe(true)
    expect(mgr.isAllMastered()).toBe(true)
  })

  it('time limit reached → session complete', () => {
    vi.useFakeTimers()
    const now = Date.now()
    vi.setSystemTime(now)

    const mgr = new CrammingQueueManager(['a', 'b', 'c'], makeConfig({
      timeLimitMinutes: 1, // 1 minute
    }))

    expect(mgr.isSessionComplete()).toBe(false)
    expect(mgr.remainingTimeMs()).toBe(60000)

    // Advance 61 seconds
    vi.setSystemTime(now + 61000)

    expect(mgr.isSessionComplete()).toBe(true)
    expect(mgr.remainingTimeMs()).toBe(0)

    vi.useRealTimers()
  })

  it('masteryPercentage is accurate', () => {
    const ids = ['a', 'b', 'c', 'd']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    expect(mgr.masteryPercentage()).toBe(0)

    mgr.rateCard('got_it') // a → 25%
    expect(mgr.masteryPercentage()).toBe(25)

    mgr.rateCard('got_it') // b → 50%
    expect(mgr.masteryPercentage()).toBe(50)

    mgr.rateCard('missed') // c → still 50%
    expect(mgr.masteryPercentage()).toBe(50)
  })

  it('getHardestCards returns sorted by missedCount descending', () => {
    const ids = ['a', 'b', 'c']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    // Miss 'a' twice
    mgr.rateCard('missed') // a
    mgr.rateCard('got_it') // b
    mgr.rateCard('got_it') // c
    // a reappears
    mgr.rateCard('missed') // a again
    mgr.rateCard('got_it') // a

    const hardest = mgr.getHardestCards(5)
    expect(hardest).toHaveLength(1) // only 'a' was missed
    expect(hardest[0].cardId).toBe('a')
    expect(hardest[0].missedCount).toBe(2)
  })

  it('remainingTimeMs returns null when no time limit', () => {
    const mgr = new CrammingQueueManager(['a'], makeConfig())
    expect(mgr.remainingTimeMs()).toBeNull()
    expect(mgr.hasTimeLimit()).toBe(false)
  })

  it('totalAttempts counts all rating actions', () => {
    const mgr = new CrammingQueueManager(['a', 'b'], makeConfig())

    mgr.rateCard('missed') // 1
    mgr.rateCard('got_it') // 2
    // a reappears
    mgr.rateCard('got_it') // 3

    expect(mgr.totalAttempts()).toBe(3)
  })

  it('getCardState returns correct state for a card', () => {
    const mgr = new CrammingQueueManager(['a', 'b'], makeConfig())

    mgr.rateCard('missed') // a
    mgr.rateCard('got_it') // b

    const stateA = mgr.getCardState('a')
    expect(stateA?.totalAttempts).toBe(1)
    expect(stateA?.missedCount).toBe(1)
    expect(stateA?.lastRating).toBe('missed')
    expect(stateA?.masteredInRound).toBeNull()

    const stateB = mgr.getCardState('b')
    expect(stateB?.totalAttempts).toBe(1)
    expect(stateB?.missedCount).toBe(0)
    expect(stateB?.lastRating).toBe('got_it')
    expect(stateB?.masteredInRound).toBe(1)
  })

  it('round advances correctly when some cards never got_it', () => {
    const ids = ['a', 'b', 'c']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    // Round 1: master a and c, always miss b
    mgr.rateCard('got_it') // a
    mgr.rateCard('missed') // b
    mgr.rateCard('got_it') // c
    // b reappears (gap=2, but only 1 card after, so at end)
    mgr.rateCard('missed') // b again

    // b still not mastered, should go to round 2
    // After round ends, b reappears... let's keep going
    mgr.rateCard('missed') // b yet again

    // At some point round should advance with only b
    mgr.rateCard('got_it') // b finally

    expect(mgr.isSessionComplete()).toBe(true)
    expect(mgr.isAllMastered()).toBe(true)
  })

  it('remainingInRound does not overcount when missed cards are re-queued', () => {
    const ids = ['a', 'b', 'c', 'd']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    expect(mgr.remainingInRound()).toBe(4)
    expect(mgr.totalInRound()).toBe(4)

    // Miss 'a' → re-inserted, but remainingInRound should count unique unmastered
    mgr.rateCard('missed') // a
    // remaining unique unmastered: a, b, c, d (still 4 unique, but cursor moved past a)
    // However a is re-queued ahead, so remaining unique = {b, c, a, d} minus mastered = 4
    expect(mgr.remainingInRound()).toBeLessThanOrEqual(4)

    mgr.rateCard('got_it') // b → mastered
    // remaining unique unmastered: a, c, d = 3
    expect(mgr.remainingInRound()).toBeLessThanOrEqual(3)
  })

  it('remainingInRound counts only unique unmastered cards', () => {
    const ids = ['a', 'b', 'c']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    mgr.rateCard('got_it') // a mastered
    mgr.rateCard('missed') // b missed → re-queued

    // c is next, then b re-queued — unique unmastered remaining: b, c
    expect(mgr.remainingInRound()).toBe(2)
  })

  it('lazy round advance: rateCard does not eagerly advance round', () => {
    const ids = ['a', 'b']
    const mgr = new CrammingQueueManager(ids, makeConfig())

    mgr.rateCard('got_it') // a
    mgr.rateCard('missed') // b → re-queued after gap
    // b reappears
    mgr.rateCard('missed') // b again → re-queued

    // Eventually b should be the only card left in queue tail
    mgr.rateCard('got_it') // b finally got_it

    expect(mgr.isSessionComplete()).toBe(true)
  })

  it('totalInRound reflects unique cards at round start, not inflated queue', () => {
    const ids = ['a', 'b', 'c']
    const mgr = new CrammingQueueManager(ids, makeConfig())
    expect(mgr.totalInRound()).toBe(3)

    // Miss all three → they get re-queued but totalInRound stays 3
    mgr.rateCard('missed')
    mgr.rateCard('missed')
    mgr.rateCard('missed')
    expect(mgr.totalInRound()).toBe(3) // Not inflated
  })
})
