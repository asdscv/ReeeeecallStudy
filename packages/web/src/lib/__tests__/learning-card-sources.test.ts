/**
 * learning-card-sources — which table a card's schedule comes from.
 *
 * The defect these pin: the daily planner read `cards.interval_days` / `last_reviewed_at` /
 * `next_review_at` for EVERY deck. On a subscribed or official deck those columns hold the
 * publisher's state, not the learner's — in production all 376,095 official cards carry
 * `interval_days = 0` and `last_reviewed_at = NULL`. Every memory feature therefore evaluated to
 * the same no-evidence value, every card scored identically, and the "personalised" daily plan
 * was whatever order the rows arrived in.
 */
import { describe, expect, it } from 'vitest'
import {
  splitDecksBySrsSource, attachProgressToCards, isDueAt,
  type PlannerDeckMeta,
} from '@reeeeecall/shared/lib/learning-card-sources'
import type { UserCardProgress } from '@reeeeecall/shared/lib/srs-access'
import type { Card } from '@reeeeecall/shared/types/database'

const ME = 'user-me'
const OTHER = 'user-publisher'
const NOW = '2026-08-01T00:00:00.000Z'

const deck = (id: string, over: Partial<PlannerDeckMeta> = {}): PlannerDeckMeta => ({
  id, user_id: ME, share_mode: null, source_owner_id: null, ...over,
})

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, deck_id: 'deck-1', user_id: OTHER, template_id: 'tpl-1',
  field_values: { front: 'q', back: 'a' }, tags: [], sort_position: 1,
  srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0,
  next_review_at: null, last_reviewed_at: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
} as Card)

const progress = (cardId: string, over: Partial<UserCardProgress> = {}): UserCardProgress => ({
  id: `p-${cardId}`, user_id: ME, card_id: cardId, deck_id: 'deck-1',
  srs_status: 'review', ease_factor: 2.5, interval_days: 10, repetitions: 3,
  next_review_at: '2026-07-30T00:00:00.000Z', last_reviewed_at: '2026-07-20T00:00:00.000Z',
  srs_revision: 4, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-07-20T00:00:00.000Z',
  ...over,
})

describe('splitDecksBySrsSource', () => {
  it('sends a deck the learner does not own to the progress table', () => {
    const split = splitDecksBySrsSource([
      deck('own'),
      deck('subscribed', { user_id: OTHER }),
    ], ME)

    expect(split.embeddedDeckIds).toEqual(['own'])
    expect(split.progressDeckIds).toEqual(['subscribed'])
  })

  it('keys on ownership, not on share_mode or source_owner_id', () => {
    // Both are NULL for a regular user's subscribe deck AND for the official decks, so either
    // would silently route those to the wrong table — which is how this broke.
    const split = splitDecksBySrsSource([
      deck('official', { user_id: OTHER, share_mode: null, source_owner_id: null }),
      deck('mine-shared', { user_id: ME, share_mode: 'subscribe', source_owner_id: OTHER }),
    ], ME)

    expect(split.progressDeckIds).toEqual(['official'])
    expect(split.embeddedDeckIds).toEqual(['mine-shared'])
  })

  it('omits a deck it could not read rather than guessing a source', () => {
    // The two sources disagree, so picking one by coin flip would plan a real learner's day
    // against someone else's schedule.
    const split = splitDecksBySrsSource([], ME)
    expect(split.embeddedDeckIds).toEqual([])
    expect(split.progressDeckIds).toEqual([])
  })
})

describe('attachProgressToCards', () => {
  it("replaces the publisher's schedule with the learner's own", () => {
    // The publisher row says "never studied"; the learner has a 10-day interval. Before this,
    // the planner read the former and every subscribed card looked identical.
    const [merged] = attachProgressToCards([card('c1')], [progress('c1')])

    expect(merged.interval_days).toBe(10)
    expect(merged.last_reviewed_at).toBe('2026-07-20T00:00:00.000Z')
    expect(merged.next_review_at).toBe('2026-07-30T00:00:00.000Z')
    expect(merged.srs_status).toBe('review')
  })

  it('keeps a card with no progress row, as a new card', () => {
    // A subscribed card the learner has never studied is legitimately plannable — it is new,
    // not absent. Dropping it would hide exactly the cards a learner most needs to start.
    const [merged] = attachProgressToCards([card('c1')], [])

    expect(merged.id).toBe('c1')
    expect(merged.interval_days).toBe(0)
    expect(merged.last_reviewed_at).toBeNull()
  })

  it('matches progress to its own card and never crosses them', () => {
    const merged = attachProgressToCards(
      [card('c1'), card('c2')],
      [progress('c2', { interval_days: 99 })],
    )

    expect(merged.find((c) => c.id === 'c1')?.interval_days).toBe(0)
    expect(merged.find((c) => c.id === 'c2')?.interval_days).toBe(99)
  })
})

describe('isDueAt', () => {
  it('treats a never-scheduled card as due', () => {
    // Same reading the embedded query uses (`next_review_at.is.null`), so the two sources
    // cannot disagree about what "due" means.
    expect(isDueAt(null, NOW)).toBe(true)
    expect(isDueAt(undefined, NOW)).toBe(true)
  })

  it('separates due from not-yet-due', () => {
    expect(isDueAt('2026-07-31T00:00:00.000Z', NOW)).toBe(true)
    expect(isDueAt(NOW, NOW)).toBe(true)
    expect(isDueAt('2026-08-02T00:00:00.000Z', NOW)).toBe(false)
  })

  it('shows an unparseable date rather than hiding the card', () => {
    // A card that cannot be dated is a card the learner can still study. Hiding it would remove
    // work with no way for them to discover why.
    expect(isDueAt('not-a-date', NOW)).toBe(true)
  })
})
