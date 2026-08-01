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
  legacyCardItemShape, planItemAnswerPayload, ANSWER_FACE_RESOLVER, TYPED_ANSWER_MAX_CHARS,
  type CandidateStudyLog,
} from '@reeeeecall/shared/lib/learning-candidates'
import { REVIEW_VALUE_AT_TARGET } from '@reeeeecall/shared/learning'
import type { Card, CardTemplate } from '@reeeeecall/shared/types/database'

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
    // Reviewed exactly one interval ago → retrievability 0.9 → the KNEE of the value curve,
    // which is REVIEW_VALUE_AT_TARGET and no longer the maximum. The maximum belongs to a card
    // the learner has probably already lost; see memory.ts `reviewValue`.
    const candidate = one({ id: 'c1', interval_days: 10, last_reviewed_at: '2026-07-21T00:00:00.000Z' })
    expect(candidate.reviewValue).toBeCloseTo(REVIEW_VALUE_AT_TARGET, 12)
  })

  it('is null for a card the learner has never reviewed', () => {
    // Not 0 and not 0.5: the planner renormalises around a missing estimate, and a fabricated
    // number here is exactly the "implicit evidence" the design forbids.
    expect(one({ id: 'c2', last_reviewed_at: null }).reviewValue).toBeNull()
  })

  it('is null for a card with no interval to bridge from', () => {
    expect(one({ id: 'c3', interval_days: 0, last_reviewed_at: '2026-07-21T00:00:00.000Z' }).reviewValue).toBeNull()
  })

  it('ranks the most-forgotten card first, then the freshly due, then one needing nothing', () => {
    // REVERSED, deliberately. This test previously asserted `freshlyDue > longOverdue`, which
    // put the card the learner had most likely lost BELOW one that was merely due — while the
    // reason code the feature emits is named `memory_risk` and the UI says "at risk of
    // forgetting". The arithmetic now agrees with both.
    //
    // next_review_at is what the legacy scheduler would have written (last review + interval),
    // so the features are compared on the same card rather than a contrived row.
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

    expect(longOverdue.reviewValue as number).toBeGreaterThan(freshlyDue.reviewValue as number)
    expect(freshlyDue.reviewValue as number).toBeGreaterThan(justReviewed.reviewValue as number)
    // A card due exactly now sits on the knee; one needing nothing is worth nothing to review.
    expect(freshlyDue.reviewValue).toBeCloseTo(REVIEW_VALUE_AT_TARGET, 12)
    expect(justReviewed.reviewValue).toBeCloseTo(0, 12)
    // `reviewValue` and `dueUrgency` now agree on the overdue card. They are still different
    // features: dueUrgency saturates on absolute lateness, reviewValue on lateness RELATIVE to
    // the card's own interval — which is what the next test pins.
    expect(longOverdue.dueUrgency).toBeGreaterThan(freshlyDue.dueUrgency)
  })

  it('measures lateness relative to the card\'s own interval, which dueUrgency cannot', () => {
    // Three days late on a 1-day card is a near-total loss; three days late on a 90-day card is
    // nothing. `dueUrgency` sees one number — "3 days late" — and scores them identically. This
    // is the whole reason the memory model earns its 0.25 weight.
    const shortLate = one({
      id: 'c8', interval_days: 1,
      last_reviewed_at: '2026-07-27T00:00:00.000Z', next_review_at: '2026-07-28T00:00:00.000Z',
    })
    const longLate = one({
      id: 'c9', interval_days: 90,
      last_reviewed_at: '2026-04-29T00:00:00.000Z', next_review_at: '2026-07-28T00:00:00.000Z',
    })

    expect(shortLate.dueUrgency).toBeCloseTo(longLate.dueUrgency, 12)
    expect(shortLate.reviewValue as number).toBeGreaterThan(longLate.reviewValue as number)
  })

  it('leaves the other features untouched', () => {
    const candidate = one({ id: 'c7', interval_days: 10, last_reviewed_at: '2026-07-21T00:00:00.000Z' })
    expect(candidate.estimatedMinutes).toBe(RECALL_MINUTES)
    expect(candidate.recentFailure).toBeCloseTo(0.3, 12)   // no logs → the documented default
    expect(candidate.responseTimePenalty).toBeCloseTo(0.5, 12)
    expect(candidate.goalRelevance).toBeCloseTo(0.5, 12)
  })
})

// ── legacyCardItemShape — which items can be answered by typing ──────────────
//
// The rule this pins is the SUBSET rule: `response_type` becomes 'text' only when the card's
// template declares both faces unambiguously. Getting it wrong in the permissive direction puts
// an input box on a card whose answer nobody can name — which is the premise a later paid
// `compare` would be grounded in, so the wrong reference is the expensive failure, not the
// missing one.
describe('legacyCardItemShape', () => {
  const template = (over: Partial<CardTemplate> = {}): CardTemplate => ({
    id: 'tpl-1', user_id: 'user-1', name: 'Basic',
    fields: [
      { key: 'front', name: 'Front', type: 'text', order: 0 },
      { key: 'back', name: 'Back', type: 'text', order: 1 },
    ],
    front_layout: [{ field_key: 'front', style: 'primary' }],
    back_layout: [{ field_key: 'back', style: 'primary' }],
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as CardTemplate)

  const subject = card({ id: 'c1', field_values: { front: 'apple', back: '사과' } })

  it('asks for a typed answer when the template says which field is the answer', () => {
    const shape = legacyCardItemShape(subject, template())

    expect(shape.responseType).toBe('text')
    expect(shape.answerFaces).toEqual({ promptKeys: ['front'], referenceKeys: ['back'] })
    // `exact` would mark a correct paraphrase wrong, and that score feeds insights →
    // recommendations → the next plan. The learner stays the evaluator.
    expect(shape.evaluatorType).toBe('self_rate')
    expect(shape.activityType).toBe('recall')
    expect(shape.stimulusType).toBe('text')
  })

  it('stays a plain self-rating when no template is available', () => {
    // The subscriber case: a shared template is readable only when it is the deck's default
    // (mig 009), so "absent" is a normal state and must degrade to the pre-existing behaviour.
    expect(legacyCardItemShape(subject).responseType).toBe('self_rate')
    expect(legacyCardItemShape(subject, null).responseType).toBe('self_rate')
    expect(legacyCardItemShape(subject).answerFaces).toBeNull()
  })

  it('stays a plain self-rating when the template declares no answer face', () => {
    // `back_layout` defaults to '[]' (mig 001), so this is the COMMON case, not an exotic one.
    expect(legacyCardItemShape(subject, template({ back_layout: [] })).responseType).toBe('self_rate')
  })

  it('refuses a non-text answer field rather than comparing words to audio', () => {
    const audioBack = template({
      fields: [
        { key: 'front', name: 'Front', type: 'text', order: 0 },
        { key: 'back', name: 'Sound', type: 'audio', order: 1 },
      ],
    })

    expect(legacyCardItemShape(subject, audioBack).responseType).toBe('self_rate')
  })

  it('refuses when the answer is the question', () => {
    const overlapping = template({ back_layout: [{ field_key: 'front', style: 'primary' }] })

    expect(legacyCardItemShape(subject, overlapping).responseType).toBe('self_rate')
  })

  it('refuses when the layout names keys the card does not have', () => {
    const sparse = card({ id: 'c2', field_values: { front: 'apple', back: '' } })

    expect(legacyCardItemShape(sparse, template()).responseType).toBe('self_rate')
  })
})

describe('planItemAnswerPayload', () => {
  it('records the resolved keys and the rule that resolved them', () => {
    const payload = planItemAnswerPayload({
      activityType: 'recall', stimulusType: 'text', responseType: 'text',
      evaluatorType: 'self_rate',
      answerFaces: { promptKeys: ['front'], referenceKeys: ['back', 'example_back'] },
    })

    // The keys alone are not auditable: they only mean something together with the rule that
    // produced them, which is why the resolver id travels with them.
    expect(payload).toEqual({
      typed_answer: {
        resolver: ANSWER_FACE_RESOLVER,
        prompt_keys: ['front'],
        reference_keys: ['back', 'example_back'],
      },
    })
  })

  it('is null when there was no decision to record', () => {
    // Null, not `{}`: the store omits the key entirely so `save_daily_plan` keeps writing its
    // own default for every item that is not a typed one.
    expect(planItemAnswerPayload({
      activityType: 'recall', stimulusType: 'text', responseType: 'self_rate',
      evaluatorType: 'self_rate', answerFaces: null,
    })).toBeNull()
  })

  it('caps a typed answer far below the server limit, in characters', () => {
    // mig 167 rejects a response over 64 KiB with P0006 — the code the UI renders as "you've hit
    // today's limit for rebuilding plans". The client cap has to bite first, and with room for
    // multi-byte scripts: 2000 Korean characters is ~6 KB.
    expect(TYPED_ANSWER_MAX_CHARS).toBe(2000)
    expect(new TextEncoder().encode('가'.repeat(TYPED_ANSWER_MAX_CHARS)).length).toBeLessThan(65536)
  })
})
