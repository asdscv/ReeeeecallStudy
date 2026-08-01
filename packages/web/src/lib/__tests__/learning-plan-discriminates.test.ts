/**
 * Does the daily plan actually rank anything? — the end-to-end check that was missing.
 *
 * Every other learning test pins one function. None of them answered the question the product
 * depends on: given a realistic account, does the planner produce an ORDER, or does it produce
 * one number repeated?
 *
 * Before the three fixes of 2026-08-01 the honest answer was the latter. Run against a
 * subscriber on an official deck — which is where 376,095 of production's 377,031 cards live —
 * the planner returned **one distinct score for every card**, because:
 *
 *   - it read `cards.interval_days` / `last_reviewed_at`, which on a publisher's row are 0 and
 *     NULL for every card, so `reviewValue` was null for all of them (#389);
 *   - `recentFailure` filtered `typeof rating === 'number'` against a TEXT column, so it
 *     returned its no-evidence constant for all of them (#387);
 *   - `goalRelevance` and `contentImportance` are hardcoded constants.
 *
 * The plan was the learner's cards in arrival order, with one reason string on every row.
 *
 * This test is deliberately end-to-end — real cards, real progress rows, real text ratings,
 * through `attachProgressToCards` → `buildCandidatesFromCards` → `buildDailyPlan` — because
 * each of those defects passed its own unit tests while the composition of them was inert.
 */
import { describe, expect, it } from 'vitest'
import { buildCandidatesFromCards } from '@reeeeecall/shared/lib/learning-candidates'
import { buildDailyPlan } from '@reeeeecall/shared/learning'
import { attachProgressToCards } from '@reeeeecall/shared/lib/learning-card-sources'
import type { Card } from '@reeeeecall/shared/types/database'
import type { UserCardProgress } from '@reeeeecall/shared/lib/srs-access'

const NOW = '2026-08-01T00:00:00.000Z'
const DAY = 86_400_000
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * DAY).toISOString()

/** An official-deck card: the publisher's row, carrying no SRS state at all. */
const publisherCard = (id: string): Card => ({
  id, deck_id: 'deck-1', user_id: 'publisher', template_id: 't1',
  field_values: { front: `q-${id}`, back: 'a' }, tags: [], sort_position: 1,
  srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0,
  next_review_at: null, last_reviewed_at: null,
  created_at: daysAgo(400), updated_at: daysAgo(400),
} as Card)

/** The learner's own schedule for that card. */
const progress = (cardId: string, intervalDays: number, lateDays: number): UserCardProgress => ({
  id: `p-${cardId}`, user_id: 'me', card_id: cardId, deck_id: 'deck-1',
  srs_status: 'review', ease_factor: 2.5, interval_days: intervalDays, repetitions: 3,
  next_review_at: daysAgo(lateDays), last_reviewed_at: daysAgo(intervalDays + lateDays),
  srs_revision: 1, created_at: daysAgo(400), updated_at: daysAgo(1),
})

/** [card, interval, days late] — a three-month-old account's spread. */
const SPEC: Array<[string, number, number]> = [
  ['nearly-lost', 1, 6],    // a 1-day card six days late: six intervals overdue
  ['month-late', 30, 30],   // one interval overdue
  ['mid-late', 10, 6],
  ['barely-moved', 90, 6],  // six days on a 90-day card is almost nothing
  ['short-due', 1, 0],
  ['long-due', 90, 0],
]

function planFor(spec: typeof SPEC) {
  const cards = attachProgressToCards(
    spec.map(([id]) => publisherCard(id)),
    spec.map(([id, interval, late]) => progress(id, interval, late)),
  )
  const recentLogs = [
    // The learner keeps missing this one. TEXT ratings, as the database actually stores them.
    ...['again', 'again', 'good'].map((rating, i) =>
      ({ card_id: 'nearly-lost', rating, review_duration_ms: 40_000, studied_at: daysAgo(i + 1) })),
    ...['good', 'good', 'good'].map((rating, i) =>
      ({ card_id: 'long-due', rating, review_duration_ms: 9_000, studied_at: daysAgo(i + 1) })),
  ]
  const candidates = buildCandidatesFromCards({
    cards, recentLogs: recentLogs as never, deckImportance: { 'deck-1': 0.5 }, now: NOW,
  })
  return buildDailyPlan({
    goal: { id: 'g1', dailyMinutes: 20 },
    candidates, budgetMinutes: 20, now: NOW, timezone: 'Asia/Seoul',
    algorithmVersion: 'daily-plan-v2',
  } as never, { supportedActivityTypes: ['recall', 'practice', 'produce'] })
}

describe('the daily plan discriminates between cards', () => {
  it('gives every card its own priority, on the deck type where it used to give one', () => {
    const plan = planFor(SPEC)

    expect(plan.items).toHaveLength(SPEC.length)
    const distinct = new Set(plan.items.map((item) => item.priority.toFixed(6)))
    expect(distinct.size).toBe(SPEC.length)
  })

  it('ranks by lateness RELATIVE to each card\'s own interval, not by absolute lateness', () => {
    // The claim the product makes, and the one `dueUrgency` alone cannot deliver: six days late
    // is a crisis for a 1-day card and a rounding error for a 90-day card. Both are "6 days
    // late" to a due-date sort, which is why they would tie under the old ranking.
    const plan = planFor(SPEC)
    const rank = (id: string) => plan.items.findIndex((item) => item.cardId === id)

    expect(rank('nearly-lost')).toBeLessThan(rank('barely-moved'))
    expect(rank('month-late')).toBeLessThan(rank('barely-moved'))
    // ...and a card the learner is on top of sinks below every overdue one.
    expect(rank('long-due')).toBe(plan.items.length - 1)
  })

  it('puts the card the learner keeps failing first', () => {
    const plan = planFor(SPEC)
    expect(plan.items[0]?.cardId).toBe('nearly-lost')
  })

  it('separates two identically-scheduled cards by which one the learner keeps failing', () => {
    // `reviewValue` cannot see this: both cards are at the same point of the same forgetting
    // curve. Only `recentFailure` can, and it read `typeof rating === 'number'` against a TEXT
    // column until #387 — so before that fix these two tied and the order fell to card id.
    const twins: Array<[string, number, number]> = [['z-failing', 10, 2], ['a-solid', 10, 2]]
    const cards = attachProgressToCards(
      twins.map(([id]) => publisherCard(id)),
      twins.map(([id, interval, late]) => progress(id, interval, late)),
    )
    const recentLogs = [
      ...['again', 'again', 'again'].map((rating, i) =>
        ({ card_id: 'z-failing', rating, review_duration_ms: 30_000, studied_at: daysAgo(i + 1) })),
      ...['good', 'easy', 'good'].map((rating, i) =>
        ({ card_id: 'a-solid', rating, review_duration_ms: 30_000, studied_at: daysAgo(i + 1) })),
    ]
    const candidates = buildCandidatesFromCards({
      cards, recentLogs: recentLogs as never, deckImportance: { 'deck-1': 0.5 }, now: NOW,
    })

    const failing = candidates.find((c) => c.cardId === 'z-failing')!
    const solid = candidates.find((c) => c.cardId === 'a-solid')!

    // Same schedule → same memory estimate. The tie is real, and must be broken by the history.
    expect(failing.reviewValue).toBeCloseTo(solid.reviewValue as number, 12)
    expect(failing.recentFailure).toBeGreaterThan(solid.recentFailure)

    const plan = buildDailyPlan({
      goal: { id: 'g1', dailyMinutes: 20 },
      candidates, budgetMinutes: 20, now: NOW, timezone: 'Asia/Seoul',
      algorithmVersion: 'daily-plan-v2',
    } as never, { supportedActivityTypes: ['recall', 'practice', 'produce'] })

    // Named so ALPHABETICAL order is the opposite of the correct order: `candidateId` is the
    // planner's tie-break, so a fixture where the right answer also sorts first would pass with
    // the feature dead.
    expect(plan.items[0]?.cardId).toBe('z-failing')
  })

  it('is not merely sorted by candidate id', () => {
    // The failure mode this whole file exists to catch: with every feature constant, the planner
    // still returns a list, still in a stable order — `candidateId` — and still looks like a
    // plan. Reversing the input must not reverse the output.
    const forward = planFor(SPEC).items.map((item) => item.cardId)
    const reversed = planFor([...SPEC].reverse()).items.map((item) => item.cardId)

    expect(reversed).toEqual(forward)
    expect(forward).not.toEqual([...forward].sort())
  })
})
