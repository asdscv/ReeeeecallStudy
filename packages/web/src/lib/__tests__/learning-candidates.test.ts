/**
 * learning-candidates — the legacy-card → PlannerCandidate mapping.
 *
 * The planner's scoring is already covered by learning-daily-planner.test.ts. What
 * is untested until here is the translation that feeds it, and that is where the
 * damage would be silent: a feature that returns 0 for "no evidence" instead of a
 * neutral value does not crash, it just quietly buries every new or unlogged card
 * for as long as the product exists. Each assertion below names the rule it pins.
 */
import { describe, it, expect } from 'vitest'
import {
  buildCandidatesFromCards, dueUrgencyFor, recentFailureFor, responseTimePenaltyFor,
  baselineDurationMs, RECALL_MINUTES,
  type CandidateStudyLog,
} from '@reeeeecall/shared/lib/learning-candidates'
import type { Card } from '@reeeeecall/shared/types/database'

const NOW = '2026-07-31T00:00:00.000Z'
const NOW_MS = Date.parse(NOW)

function card(over: Partial<Card> & { id: string }): Card {
  return {
    id: over.id,
    deck_id: over.deck_id ?? 'deck-1',
    user_id: 'user-1',
    template_id: 'tpl-1',
    field_values: over.field_values ?? { front: 'q', back: 'a' },
    tags: [],
    sort_position: 1,
    srs_status: over.srs_status ?? 'review',
    ease_factor: 2.5,
    // `in` rather than `??`: interval_days = 0 is a real state (a learning-step card) and one
    // the memory model treats as "no stability", so it must survive the fixture.
    interval_days: 'interval_days' in over ? (over.interval_days as number) : 3,
    repetitions: 2,
    next_review_at: over.next_review_at ?? NOW,
    last_reviewed_at: over.last_reviewed_at ?? null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as Card
}

// `??` would collapse an explicit null into the default, and "no rating" / "no
// timing" are exactly the cases these tests exist to cover — so presence is checked
// with `in`, not nullishness.
function log(over: Partial<CandidateStudyLog> & { card_id: string }): CandidateStudyLog {
  return {
    card_id: over.card_id,
    rating: 'rating' in over ? (over.rating as string | number | null) : 3,
    review_duration_ms: 'review_duration_ms' in over ? (over.review_duration_ms as number | null) : 5_000,
    studied_at: over.studied_at ?? '2026-07-30T00:00:00.000Z',
  }
}

describe('dueUrgencyFor', () => {
  it('treats a never-scheduled card as maximally due', () => {
    // A new card has no next_review_at. Scoring it 0 would mean new cards never get
    // planned, which is the opposite of what a learner wants on day one.
    expect(dueUrgencyFor(null, NOW_MS)).toBe(1)
  })

  it('scores a card due exactly now at the midpoint', () => {
    expect(dueUrgencyFor(NOW, NOW_MS)).toBeCloseTo(0.5, 6)
  })

  it('rises with overdue days and saturates at 7 days', () => {
    const twoDays = dueUrgencyFor('2026-07-29T00:00:00.000Z', NOW_MS)
    const sevenDays = dueUrgencyFor('2026-07-24T00:00:00.000Z', NOW_MS)
    const twentyDays = dueUrgencyFor('2026-07-11T00:00:00.000Z', NOW_MS)
    expect(twoDays).toBeGreaterThan(0.5)
    expect(sevenDays).toBe(1)
    expect(twentyDays).toBe(1) // saturated, not >1
  })

  it('falls toward zero for future scheduling', () => {
    expect(dueUrgencyFor('2026-08-02T00:00:00.000Z', NOW_MS)).toBeLessThan(0.5)
    expect(dueUrgencyFor('2026-09-01T00:00:00.000Z', NOW_MS)).toBe(0)
  })

  it('returns the neutral value for an unparseable timestamp instead of claiming due', () => {
    expect(dueUrgencyFor('not-a-date', NOW_MS)).toBe(0.5)
  })
})

describe('recentFailureFor', () => {
  it('uses 0.3, not 0 or 0.5, when there is no log history', () => {
    // "Never failed" and "never attempted" are different. 0 would make an unlogged
    // card look mastered; 0.5 would let it outrank cards actually being failed.
    expect(recentFailureFor([])).toBe(0.3)
    expect(recentFailureFor([log({ card_id: 'c1', rating: null })])).toBe(0.3)
  })

  it('is the failure share of the last five rated logs', () => {
    const logs = [1, 1, 3, 4, 5].map((rating) => log({ card_id: 'c1', rating }))
    expect(recentFailureFor(logs)).toBeCloseTo(0.4, 6)
  })

  it('grades Hard between a lapse and a success rather than calling it a failure', () => {
    // Changed deliberately from "hard counts as a failure". The scheduler INCREASES the
    // interval on `hard` (srs.ts review phase: ×1.2), so scoring it 1 would have the planner
    // and the scheduler disagree about the same event; scoring it 0 would erase the only
    // signal separating a card barely recalled from one known cold.
    expect(recentFailureFor([log({ card_id: 'c1', rating: 'hard' })])).toBe(0.5)
    expect(recentFailureFor([1, 2].map((r) => log({ card_id: 'c1', rating: r })))).toBe(0.75)
    expect(recentFailureFor([3, 4].map((r) => log({ card_id: 'c1', rating: r })))).toBe(0)
  })

  it('ignores logs beyond the five-log window', () => {
    // Six logs: five recent successes and one ancient failure — the old failure must
    // not keep a since-mastered card at the top of the plan forever.
    const logs = [3, 3, 3, 3, 3, 1].map((rating) => log({ card_id: 'c1', rating }))
    expect(recentFailureFor(logs)).toBe(0)
  })

  // ── the TEXT vocabulary the database actually stores ───────────────────────
  //
  // `study_logs.rating` is TEXT (CHECK constraint, mig 071). This interface declared it
  // `number | null` and the store cast the rows to match, so the old `typeof === 'number'`
  // filter was false for every row production has ever held: a 0.25-weight feature returned
  // its no-evidence constant 0.3 for a card being failed every single day, and nothing in the
  // type system or the tests said so.

  it('reads the SRS text ratings production actually stores', () => {
    expect(recentFailureFor([log({ card_id: 'c1', rating: 'again' })])).toBe(1)
    expect(recentFailureFor([log({ card_id: 'c1', rating: 'good' })])).toBe(0)
    expect(recentFailureFor([log({ card_id: 'c1', rating: 'easy' })])).toBe(0)
  })

  it('reads the non-SRS study modes too', () => {
    // sequential_review says known/unknown; cramming says got_it/missed (migs 035, 071).
    // These are the only ratings a learner using those modes ever produces.
    expect(recentFailureFor([log({ card_id: 'c1', rating: 'unknown' })])).toBe(1)
    expect(recentFailureFor([log({ card_id: 'c1', rating: 'missed' })])).toBe(1)
    expect(recentFailureFor([log({ card_id: 'c1', rating: 'known' })])).toBe(0)
    expect(recentFailureFor([log({ card_id: 'c1', rating: 'got_it' })])).toBe(0)
  })

  it('does not let browse events dilute the failures they are mixed with', () => {
    // `next`/`viewed` are navigation, not judgement. Averaging them in as zeros would read
    // as clean successes; keeping them in the window would push the real lapse out of it.
    const logs = ['next', 'viewed', 'next', 'viewed', 'next', 'again']
      .map((rating) => log({ card_id: 'c1', rating }))
    expect(recentFailureFor(logs)).toBe(1)
  })

  it('treats an unrecognized rating as no evidence, never as a success', () => {
    // A rating added by a future migration must not quietly lower the priority of a card the
    // learner is failing — which is what counting it as 0 would do.
    expect(recentFailureFor([log({ card_id: 'c1', rating: 'suspended_by_v3' })])).toBe(0.3)
    expect(recentFailureFor([log({ card_id: 'c1', rating: '' })])).toBe(0.3)
    expect(recentFailureFor([
      log({ card_id: 'c1', rating: 'suspended_by_v3' }),
      log({ card_id: 'c1', rating: 'again' }),
    ])).toBe(1)
  })
})

describe('responseTimePenaltyFor', () => {
  it('is neutral when either side is unknown', () => {
    expect(responseTimePenaltyFor(null, 5_000)).toBe(0.5)
    expect(responseTimePenaltyFor(5_000, null)).toBe(0.5)
    expect(responseTimePenaltyFor(5_000, 0)).toBe(0.5)
  })

  it('is relative to the user, not an absolute millisecond threshold', () => {
    expect(responseTimePenaltyFor(5_000, 5_000)).toBeCloseTo(0.5, 6)
    expect(responseTimePenaltyFor(2_500, 5_000)).toBeCloseTo(0.25, 6)
    expect(responseTimePenaltyFor(10_000, 5_000)).toBe(1)
    expect(responseTimePenaltyFor(60_000, 5_000)).toBe(1) // clamped, not >1
  })
})

describe('baselineDurationMs', () => {
  it('is the median of positive durations and ignores nulls and zeros', () => {
    const logs = [
      log({ card_id: 'c1', review_duration_ms: 1_000 }),
      log({ card_id: 'c1', review_duration_ms: 3_000 }),
      log({ card_id: 'c1', review_duration_ms: 5_000 }),
      log({ card_id: 'c1', review_duration_ms: null }),
      log({ card_id: 'c1', review_duration_ms: 0 }),
    ]
    expect(baselineDurationMs(logs)).toBe(3_000)
  })

  it('is null when nothing is measurable', () => {
    expect(baselineDurationMs([])).toBeNull()
    expect(baselineDurationMs([log({ card_id: 'c1', review_duration_ms: null })])).toBeNull()
  })
})

describe('buildCandidatesFromCards', () => {
  it('projects a legacy card to a recall candidate keyed by card id', () => {
    const [candidate] = buildCandidatesFromCards({
      cards: [card({ id: 'c1' })], recentLogs: [], deckImportance: {}, now: NOW,
    })
    expect(candidate.candidateId).toBe('card:c1')
    expect(candidate.cardId).toBe('c1')
    expect(candidate.activityId).toBeNull()   // plan items reference the card, not an activity row
    expect(candidate.activityType).toBe('recall')
    expect(candidate.estimatedMinutes).toBe(RECALL_MINUTES)
  })

  it('takes goalRelevance from the deck importance and is neutral for an unlisted deck', () => {
    const [a, b] = buildCandidatesFromCards({
      cards: [card({ id: 'c1', deck_id: 'deck-a' }), card({ id: 'c2', deck_id: 'deck-z' })],
      recentLogs: [], deckImportance: { 'deck-a': 0.9 }, now: NOW,
    })
    expect(a.goalRelevance).toBe(0.9)
    expect(b.goalRelevance).toBe(0.5)
  })

  it('clamps an out-of-range deck importance rather than passing it through', () => {
    const [candidate] = buildCandidatesFromCards({
      cards: [card({ id: 'c1', deck_id: 'deck-a' })],
      recentLogs: [], deckImportance: { 'deck-a': 4 }, now: NOW,
    })
    expect(candidate.goalRelevance).toBe(1)
  })

  it('attributes logs to the right card and reads the newest ones first', () => {
    const cards = [card({ id: 'c1' }), card({ id: 'c2' })]
    const recentLogs = [
      // c1: six logs, the OLDEST is the failure → outside the window once sorted
      log({ card_id: 'c1', rating: 'again', studied_at: '2026-01-01T00:00:00.000Z' }),
      ...['good', 'good', 'good', 'good', 'good'].map((rating, i) => log({
        card_id: 'c1', rating, studied_at: `2026-07-${20 + i}T00:00:00.000Z`,
      })),
      // c2: both logs are outright lapses
      log({ card_id: 'c2', rating: 'again' }),
      log({ card_id: 'c2', rating: 'unknown' }),
    ]
    const [c1, c2] = buildCandidatesFromCards({ cards, recentLogs, deckImportance: {}, now: NOW })
    expect(c1.recentFailure).toBe(0)
    expect(c2.recentFailure).toBe(1)
  })

  it('orders output by card id so the planner fingerprint does not depend on row order', () => {
    const forward = buildCandidatesFromCards({
      cards: [card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c' })],
      recentLogs: [], deckImportance: {}, now: NOW,
    })
    const reversed = buildCandidatesFromCards({
      cards: [card({ id: 'c' }), card({ id: 'b' }), card({ id: 'a' })],
      recentLogs: [], deckImportance: {}, now: NOW,
    })
    expect(forward.map((c) => c.candidateId)).toEqual(['card:a', 'card:b', 'card:c'])
    expect(reversed).toEqual(forward)
  })

  it('never emits a NaN feature, whatever the row looks like', () => {
    // The planner clamps defensively, but a NaN arriving here would mean the plan is
    // being ordered by garbage rather than by evidence.
    const [candidate] = buildCandidatesFromCards({
      cards: [card({ id: 'c1', next_review_at: null })],
      recentLogs: [log({ card_id: 'c1', rating: null, review_duration_ms: null })],
      deckImportance: { 'deck-1': Number.NaN },
      now: 'garbage',
    })
    for (const value of [candidate.dueUrgency, candidate.recentFailure,
      candidate.responseTimePenalty, candidate.goalRelevance, candidate.contentImportance]) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('raises contentImportance for a card whose recommendation was accepted', () => {
    // This is the whole point of storing an accepted recommendation: without the boost the
    // accept would be a row nobody reads.
    const [plain, accepted] = buildCandidatesFromCards({
      cards: [card({ id: 'a' }), card({ id: 'b' })],
      recentLogs: [], deckImportance: {}, now: NOW,
      acceptedCardIds: ['b'],
    })
    expect(plain.contentImportance).toBe(0.5)
    expect(accepted.contentImportance).toBe(0.9)
    // Not 1.0 on purpose — a suggestion must not outrank the evidence that a card is due.
    expect(accepted.contentImportance).toBeLessThan(1)
  })

  it('ignores accepted ids that are not in the candidate set', () => {
    const [only] = buildCandidatesFromCards({
      cards: [card({ id: 'a' })],
      recentLogs: [], deckImportance: {}, now: NOW,
      acceptedCardIds: ['zzz'],
    })
    expect(only.contentImportance).toBe(0.5)
  })

  it('returns nothing for no cards (a goal with no attached decks plans nothing)', () => {
    expect(buildCandidatesFromCards({ cards: [], recentLogs: [], deckImportance: {}, now: NOW }))
      .toEqual([])
  })
})

describe('reviewValue (memory model, daily-plan-v2)', () => {
  const one = (over: Partial<Card> & { id: string }) =>
    buildCandidatesFromCards({ cards: [card(over)], recentLogs: [], deckImportance: {}, now: NOW })[0]

  it('derives the review value from interval_days and last_reviewed_at', () => {
    // Reviewed exactly one interval ago → retrievability 0.9 → the peak of the value curve.
    const candidate = one({ id: 'c1', interval_days: 10, last_reviewed_at: '2026-07-21T00:00:00.000Z' })
    expect(candidate.reviewValue).toBeCloseTo(1, 12)
  })

  it('is null for a card the learner has never reviewed', () => {
    // Not 0 and not 0.5: the planner renormalises around a missing estimate, and a fabricated
    // number here is exactly the "implicit evidence" the design forbids.
    expect(one({ id: 'c2', last_reviewed_at: null }).reviewValue).toBeNull()
  })

  it('is null for a card with no interval to bridge from', () => {
    expect(one({ id: 'c3', interval_days: 0, last_reviewed_at: '2026-07-21T00:00:00.000Z' }).reviewValue).toBeNull()
  })

  it('ranks a freshly due card above one long overdue, and both above a just-reviewed one', () => {
    // next_review_at is set to what the legacy scheduler would have written (last review +
    // interval), so the two features are compared on the same card, not on a contrived row.
    const freshlyDue = one({
      id: 'c4', interval_days: 10,
      last_reviewed_at: '2026-07-21T00:00:00.000Z', next_review_at: NOW,
    })
    const longOverdue = one({
      id: 'c5', interval_days: 10,
      last_reviewed_at: '2026-01-01T00:00:00.000Z', next_review_at: '2026-01-11T00:00:00.000Z',
    })
    const justReviewed = one({
      id: 'c6', interval_days: 10,
      last_reviewed_at: NOW, next_review_at: '2026-08-10T00:00:00.000Z',
    })
    expect(freshlyDue.reviewValue as number).toBeGreaterThan(longOverdue.reviewValue as number)
    expect(longOverdue.reviewValue as number).toBeGreaterThan(justReviewed.reviewValue as number)
    // dueUrgency alone would have ordered the first two the other way round — that is the
    // v1 defect the memory model corrects.
    expect(longOverdue.dueUrgency).toBeGreaterThan(freshlyDue.dueUrgency)
  })

  it('leaves the other features untouched', () => {
    const candidate = one({ id: 'c7', interval_days: 10, last_reviewed_at: '2026-07-21T00:00:00.000Z' })
    expect(candidate.estimatedMinutes).toBe(RECALL_MINUTES)
    expect(candidate.recentFailure).toBeCloseTo(0.3, 12)   // no logs → the documented default
    expect(candidate.responseTimePenalty).toBeCloseTo(0.5, 12)
    expect(candidate.goalRelevance).toBeCloseTo(0.5, 12)
  })
})
