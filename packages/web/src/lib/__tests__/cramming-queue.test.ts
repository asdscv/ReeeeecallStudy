import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  CrammingQueueManager,
  filterCardsForCramming,
  type CrammingConfig,
} from '../cramming-queue'
import { CrammingQueueManager as SharedCrammingQueueManager } from '@reeeeecall/shared/lib/cramming-queue'
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
    next_review_at: new Date(Date.now() + 86400000).toISOString(),
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

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

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
      next_review_at: new Date(Date.now() + 2 * 86400000).toISOString(),
    }),
  ]

  it('filter type=all excludes suspended cards', () => {
    const result = filterCardsForCramming(cards, { type: 'all' })
    expect(result.map(c => c.id)).toEqual(['1', '2', '3', '5', '6'])
  })

  it('filter type=weak returns low ease_factor and new cards', () => {
    const result = filterCardsForCramming(cards, { type: 'weak', maxEaseFactor: 2.0 })
    expect(result.map(c => c.id)).toEqual(['1', '2', '5'])
  })

  it('filter type=due_soon returns due cards and new cards', () => {
    const result = filterCardsForCramming(cards, { type: 'due_soon', withinDays: 3 })
    expect(result.length).toBeGreaterThanOrEqual(3)
    expect(result.find(c => c.id === '1')).toBeDefined()
    expect(result.find(c => c.id === '4')).toBeUndefined()
  })

  it('filter type=tags returns cards matching any tag', () => {
    expect(filterCardsForCramming(cards, { type: 'tags', tags: ['vocab'] }).map(c => c.id))
      .toEqual(['5'])
  })

  it('filter type=tags with no matches returns empty', () => {
    expect(filterCardsForCramming(cards, { type: 'tags', tags: ['nonexistent'] })).toEqual([])
  })
})

// ─── CrammingQueueManager ───────────────────────────────

describe('CrammingQueueManager true rounds', () => {
  it('empty cards are immediately complete', () => {
    const mgr = new CrammingQueueManager([], makeConfig())
    expect(mgr.isSessionComplete()).toBe(true)
    expect(mgr.currentCardId()).toBeNull()
    expect(mgr.masteryPercentage()).toBe(100)
  })

  it('deduplicates input while preserving first-seen order', () => {
    const mgr = new CrammingQueueManager(['a', 'b', 'a', 'c', 'b'], makeConfig())
    expect(mgr.totalCards()).toBe(3)
    expect(mgr.totalInRound()).toBe(3)
    expect(mgr.snapshot().queue).toEqual(['a', 'b', 'c'])
  })

  it('round 1 presents every unique card exactly once', () => {
    const mgr = new CrammingQueueManager(['a', 'b', 'c'], makeConfig())
    const seen: string[] = []

    for (let i = 0; i < 3; i++) {
      seen.push(mgr.currentCardId()!)
      mgr.rateCard('got_it')
    }

    expect(seen).toEqual(['a', 'b', 'c'])
    expect(new Set(seen).size).toBe(3)
    expect(mgr.currentRound()).toBe(1)
    expect(mgr.isSessionComplete()).toBe(true)
  })

  it('moves only round-1 missed cards to round 2', () => {
    const mgr = new CrammingQueueManager(['a', 'b'], makeConfig())

    expect(mgr.currentCardId()).toBe('a')
    mgr.rateCard('got_it')
    expect(mgr.currentCardId()).toBe('b')
    mgr.rateCard('missed')

    expect(mgr.currentRound()).toBe(2)
    expect(mgr.snapshot().queue).toEqual(['b'])
    expect(mgr.currentCardId()).toBe('b')
    expect(mgr.totalInRound()).toBe(1)
  })

  it('advances a repeatedly missed card from round 2 to round 3', () => {
    const mgr = new CrammingQueueManager(['a', 'b'], makeConfig())

    mgr.rateCard('got_it')
    mgr.rateCard('missed')
    expect(mgr.currentRound()).toBe(2)

    mgr.rateCard('missed')
    expect(mgr.currentRound()).toBe(3)
    expect(mgr.currentCardId()).toBe('b')

    mgr.rateCard('got_it')
    expect(mgr.isAllMastered()).toBe(true)
    expect(mgr.getCardState('b')?.masteredInRound).toBe(3)
  })

  it('never reinserts a missed card into the current round queue', () => {
    const mgr = new CrammingQueueManager(['a', 'b', 'c'], makeConfig())

    mgr.rateCard('missed')
    const snap = mgr.snapshot()

    expect(snap.queue).toEqual(['a', 'b', 'c'])
    expect(snap.cursor).toBe(1)
    expect([...snap.nextRoundMissed]).toEqual(['a'])
    expect(mgr.currentCardId()).toBe('b')
  })

  it('reports remaining and total for the current round only', () => {
    const mgr = new CrammingQueueManager(['a', 'b', 'c'], makeConfig())

    expect(mgr.totalInRound()).toBe(3)
    expect(mgr.remainingInRound()).toBe(3)
    mgr.rateCard('missed')
    expect(mgr.remainingInRound()).toBe(2)
    mgr.rateCard('got_it')
    expect(mgr.remainingInRound()).toBe(1)
    mgr.rateCard('got_it')

    expect(mgr.currentRound()).toBe(2)
    expect(mgr.totalInRound()).toBe(1)
    expect(mgr.remainingInRound()).toBe(1)
  })

  it('tracks first mastery round and bounded mastery percentage', () => {
    const mgr = new CrammingQueueManager(['a', 'b'], makeConfig())

    expect(mgr.masteryPercentage()).toBe(0)
    mgr.rateCard('got_it')
    expect(mgr.masteryPercentage()).toBe(50)
    mgr.rateCard('missed')
    expect(mgr.masteryPercentage()).toBe(50)
    mgr.rateCard('got_it')

    expect(mgr.masteryPercentage()).toBe(100)
    expect(mgr.getCardState('a')?.masteredInRound).toBe(1)
    expect(mgr.getCardState('b')?.masteredInRound).toBe(2)
  })

  it('counts attempts across rounds', () => {
    const mgr = new CrammingQueueManager(['a', 'b'], makeConfig())
    mgr.rateCard('missed')
    mgr.rateCard('got_it')
    mgr.rateCard('missed')
    mgr.rateCard('got_it')

    expect(mgr.totalAttempts()).toBe(4)
    expect(mgr.getCardState('a')?.totalAttempts).toBe(3)
    expect(mgr.getCardState('b')?.totalAttempts).toBe(1)
  })

  it('sorts hardest cards by miss count and then card ID', () => {
    const mgr = new CrammingQueueManager(['b', 'a', 'c'], makeConfig())
    mgr.rateCard('missed') // b: 1
    mgr.rateCard('missed') // a: 1
    mgr.rateCard('got_it') // c

    expect(mgr.getHardestCards(5).map(s => [s.cardId, s.missedCount])).toEqual([
      ['a', 1],
      ['b', 1],
    ])

    mgr.rateCard('missed') // b: 2
    expect(mgr.getHardestCards(5).map(s => [s.cardId, s.missedCount])).toEqual([
      ['b', 2],
      ['a', 1],
    ])
  })

  it('snapshot and restore preserve pending next-round misses without aliases', () => {
    const mgr = new CrammingQueueManager(['a', 'b'], makeConfig())
    mgr.rateCard('missed')
    const snap = mgr.snapshot()

    snap.queue.push('external')
    snap.nextRoundMissed.add('external')
    snap.cardStates.get('a')!.missedCount = 99

    expect(mgr.snapshot().queue).toEqual(['a', 'b'])
    expect([...mgr.snapshot().nextRoundMissed]).toEqual(['a'])
    expect(mgr.getCardState('a')?.missedCount).toBe(1)

    const cleanSnap = mgr.snapshot()
    mgr.rateCard('got_it')
    mgr.rateCard('got_it')
    expect(mgr.isSessionComplete()).toBe(true)

    mgr.restore(cleanSnap)
    expect(mgr.currentRound()).toBe(1)
    expect(mgr.currentCardId()).toBe('b')
    expect([...mgr.snapshot().nextRoundMissed]).toEqual(['a'])

    mgr.rateCard('got_it')
    expect(mgr.currentRound()).toBe(2)
    expect(mgr.currentCardId()).toBe('a')
  })

  it('snapshot and restore preserve a transitioned round', () => {
    const mgr = new CrammingQueueManager(['a', 'b'], makeConfig())
    mgr.rateCard('got_it')
    mgr.rateCard('missed')
    const roundTwo = mgr.snapshot()

    mgr.rateCard('missed')
    expect(mgr.currentRound()).toBe(3)

    mgr.restore(roundTwo)
    expect(mgr.currentRound()).toBe(2)
    expect(mgr.currentCardId()).toBe('b')
    expect([...mgr.snapshot().nextRoundMissed]).toEqual([])
  })

  it('shuffles only the unique target set for each round', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const ids = ['a', 'b', 'c']
    const mgr = new CrammingQueueManager(ids, makeConfig({ shuffleCards: true }))

    expect([...mgr.snapshot().queue].sort()).toEqual(ids)
    for (let i = 0; i < ids.length; i++) mgr.rateCard('missed')

    expect(mgr.currentRound()).toBe(2)
    expect(mgr.snapshot().queue).toHaveLength(3)
    expect([...mgr.snapshot().queue].sort()).toEqual(ids)
    expect(new Set(mgr.snapshot().queue).size).toBe(3)
  })

  it('completes at the time limit and rejects ratings after timeout', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T00:00:00.000Z'))
    const mgr = new CrammingQueueManager(['a', 'b'], makeConfig({ timeLimitMinutes: 1 }))

    expect(mgr.remainingTimeMs()).toBe(60_000)
    vi.advanceTimersByTime(60_000)

    expect(mgr.isSessionComplete()).toBe(true)
    expect(mgr.currentCardId()).toBeNull()
    expect(mgr.remainingTimeMs()).toBe(0)
    mgr.rateCard('got_it')
    expect(mgr.totalAttempts()).toBe(0)
    expect(mgr.currentRound()).toBe(1)
  })

  it('does not create a new round when time expires immediately after a rating', () => {
    const now = Date.parse('2026-07-29T00:00:00.000Z')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 60_000)
    clock.mockReturnValueOnce(now) // constructor
    clock.mockReturnValueOnce(now + 59_000) // rateCard precondition

    const mgr = new CrammingQueueManager(['a'], makeConfig({ timeLimitMinutes: 1 }))
    mgr.rateCard('missed')

    expect(mgr.totalAttempts()).toBe(1)
    expect(mgr.currentRound()).toBe(1)
    expect(mgr.snapshot().cursor).toBe(1)
    expect(mgr.isSessionComplete()).toBe(true)
  })

  it('keeps no-limit time helpers stable', () => {
    const mgr = new CrammingQueueManager(['a'], makeConfig())
    expect(mgr.remainingTimeMs()).toBeNull()
    expect(mgr.hasTimeLimit()).toBe(false)
  })

  it('does not mutate state when rated after normal completion', () => {
    const mgr = new CrammingQueueManager(['a'], makeConfig())
    mgr.rateCard('got_it')
    const completed = mgr.snapshot()

    mgr.rateCard('missed')
    expect(mgr.totalAttempts()).toBe(1)
    expect(mgr.snapshot()).toEqual(completed)
  })
})

describe('web/shared cramming parity', () => {
  it('produces identical true-round transitions and statistics', () => {
    const web = new CrammingQueueManager(['a', 'b', 'c'], makeConfig())
    const shared = new SharedCrammingQueueManager(['a', 'b', 'c'], makeConfig())
    const ratings = ['got_it', 'missed', 'missed', 'missed', 'got_it', 'got_it'] as const

    for (const rating of ratings) {
      expect(shared.currentCardId()).toBe(web.currentCardId())
      web.rateCard(rating)
      shared.rateCard(rating)
    }

    expect(shared.currentRound()).toBe(web.currentRound())
    expect(shared.isSessionComplete()).toBe(web.isSessionComplete())
    expect(shared.masteryPercentage()).toBe(web.masteryPercentage())
    expect(shared.totalAttempts()).toBe(web.totalAttempts())
    expect(shared.getHardestCards()).toEqual(web.getHardestCards())
    expect(shared.snapshot().queue).toEqual(web.snapshot().queue)
  })
})
