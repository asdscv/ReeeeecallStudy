import { describe, expect, it } from 'vitest'

import { SrsQueueManager } from '../study-queue'
import type { QueueCard } from '../study-queue'
import type { SrsResult } from '../srs'

function makeCard(id: string, status: QueueCard['srs_status'] = 'new'): QueueCard {
  return {
    id,
    srs_status: status,
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
  }
}

function learningResult(nextReviewAt: string, overrides: Partial<SrsResult> = {}): SrsResult {
  return {
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 1,
    srs_status: 'learning',
    next_review_at: nextReviewAt,
    ...overrides,
  }
}

function reviewResult(): SrsResult {
  return {
    ease_factor: 2.5,
    interval_days: 1,
    repetitions: 1,
    srs_status: 'review',
    next_review_at: '2026-01-02T04:00:00.000Z',
  }
}

describe('SrsQueueManager timestamp-based learning queue', () => {
  it('keeps a 10-minute learning card hidden at 9:59 and promotes it at 10:00', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    let now = start
    const manager = new SrsQueueManager([makeCard('learning', 'learning')], undefined, () => now)

    manager.rateCard('good', learningResult(new Date(start + 10 * 60_000).toISOString()))

    now = start + 9 * 60_000 + 59_000
    expect(manager.currentCard()).toBeNull()
    expect(manager.isComplete()).toBe(true)

    now = start + 10 * 60_000
    expect(manager.isComplete()).toBe(false)
    expect(manager.currentCard()?.id).toBe('learning')
  })

  it('completes a one-card session instead of waiting for a future learning step', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    const manager = new SrsQueueManager([makeCard('only')], undefined, () => start)

    manager.rateCard('good', learningResult(new Date(start + 10 * 60_000).toISOString()))

    expect(manager.currentCard()).toBeNull()
    expect(manager.remaining()).toBe(0)
    expect(manager.isComplete()).toBe(true)
    expect(manager.studiedCount()).toBe(1)
    expect(manager.totalCards()).toBe(1)
  })

  it('promotes due learning cards ahead of waiting review and new cards', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    let now = start
    const manager = new SrsQueueManager([
      makeCard('new', 'new'),
      makeCard('review', 'review'),
      makeCard('learning', 'learning'),
    ], undefined, () => now)

    expect(manager.currentCard()?.id).toBe('learning')
    manager.rateCard('good', learningResult(new Date(start + 60_000).toISOString()))
    expect(manager.currentCard()?.id).toBe('review')

    now = start + 60_000
    expect(manager.currentCard()?.id).toBe('learning')
  })

  it('orders delayed cards by due timestamp rather than rating order', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    let now = start
    const manager = new SrsQueueManager([
      makeCard('first', 'learning'),
      makeCard('second', 'learning'),
    ], undefined, () => now)

    manager.rateCard('hard', learningResult(new Date(start + 20 * 60_000).toISOString()))
    manager.rateCard('hard', learningResult(new Date(start + 10 * 60_000).toISOString()))

    now = start + 10 * 60_000
    expect(manager.currentCard()?.id).toBe('second')
    manager.rateCard('easy', reviewResult())

    now = start + 20 * 60_000
    expect(manager.currentCard()?.id).toBe('first')
  })

  it('preserves rating order for delayed cards with the same timestamp', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    let now = start
    const due = new Date(start + 60_000).toISOString()
    const manager = new SrsQueueManager([
      makeCard('first', 'learning'),
      makeCard('second', 'learning'),
    ], undefined, () => now)

    manager.rateCard('hard', learningResult(due))
    manager.rateCard('hard', learningResult(due))

    now = start + 60_000
    expect(manager.currentCard()?.id).toBe('first')
    manager.rateCard('easy', reviewResult())
    expect(manager.currentCard()?.id).toBe('second')
  })

  it('restores an independent delayed queue snapshot', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    let now = start
    const manager = new SrsQueueManager([makeCard('card', 'learning')], undefined, () => now)
    const due = new Date(start + 60_000).toISOString()

    manager.rateCard('hard', learningResult(due))
    const snapshot = manager.snapshot()

    now = start + 60_000
    expect(manager.currentCard()?.id).toBe('card')
    manager.rateCard('easy', reviewResult())
    expect(manager.isComplete()).toBe(true)

    manager.restore(snapshot)
    now = start + 59_999
    expect(manager.currentCard()).toBeNull()
    now = start + 60_000
    expect(manager.currentCard()?.id).toBe('card')
  })

  it('compares timezone-offset due timestamps as absolute instants', () => {
    const due = '2026-03-08T01:30:00.000-08:00'
    let now = Date.parse(due) - 1
    const manager = new SrsQueueManager([makeCard('dst', 'learning')], undefined, () => now)

    manager.rateCard('hard', learningResult(due))
    expect(manager.currentCard()).toBeNull()

    now = Date.parse(due)
    expect(manager.currentCard()?.id).toBe('dst')
  })

  it('does not schedule review results or malformed learning timestamps', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    const reviewManager = new SrsQueueManager([makeCard('review')], undefined, () => now)
    reviewManager.rateCard('easy', reviewResult())
    expect(reviewManager.isComplete()).toBe(true)

    const malformedManager = new SrsQueueManager([makeCard('malformed')], undefined, () => now)
    malformedManager.rateCard('again', learningResult('not-a-date'))
    expect(malformedManager.currentCard()).toBeNull()
    expect(malformedManager.isComplete()).toBe(true)
  })

  it('stores the updated SRS state on a delayed card', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    let now = start
    const manager = new SrsQueueManager([makeCard('card')], undefined, () => now)

    manager.rateCard('good', learningResult(new Date(start + 60_000).toISOString(), {
      ease_factor: 2.35,
      repetitions: 1,
    }))

    now = start + 60_000
    expect(manager.currentCard()).toMatchObject({
      id: 'card',
      srs_status: 'learning',
      ease_factor: 2.35,
      repetitions: 1,
    })
    expect(manager.getSrsResult('good')?.srs_status).toBe('review')
  })
})
