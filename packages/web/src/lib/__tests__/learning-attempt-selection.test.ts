/**
 * Which attempt a paid remediation is grounded in.
 *
 * This picks the reference for a call that CHARGES the learner, so the two failure modes worth
 * pinning are: grounding in the wrong attempt (an old success instead of today's miss), and
 * offering the paid action on an attempt that gives it nothing to work with.
 */
import { describe, it, expect } from 'vitest'
import {
  attemptNeedsRemediation,
  attemptTypedAnswer,
  latestAttemptForCard,
  KNOWN_SCORE_THRESHOLD,
} from '@reeeeecall/shared/lib/learning-attempt-selection'
import type { AttemptRow } from '@reeeeecall/shared/stores/learning-store'

function attempt(over: Partial<AttemptRow> & { id: string }): AttemptRow {
  return {
    id: over.id,
    goal_id: over.goal_id ?? 'goal-1',
    card_id: 'card_id' in over ? (over.card_id as string | null) : 'card-1',
    activity_id: over.activity_id ?? null,
    plan_item_id: over.plan_item_id ?? null,
    activity_type: over.activity_type ?? 'recall',
    response_type: over.response_type ?? 'self_rate',
    evaluator_type: over.evaluator_type ?? 'self_rate',
    response: 'response' in over ? (over.response as Record<string, unknown> | null) : { self_rated: 0 },
    normalized_score: 'normalized_score' in over ? (over.normalized_score as number | null) : 0,
    duration_ms: over.duration_ms ?? 1_000,
    created_at: over.created_at ?? '2026-07-31T00:00:00.000Z',
  }
}

describe('latestAttemptForCard', () => {
  it('returns the newest attempt for that card', () => {
    const chosen = latestAttemptForCard([
      attempt({ id: 'old', created_at: '2026-07-29T00:00:00.000Z' }),
      attempt({ id: 'new', created_at: '2026-07-31T00:00:00.000Z' }),
      attempt({ id: 'mid', created_at: '2026-07-30T00:00:00.000Z' }),
    ], 'card-1')
    expect(chosen?.id).toBe('new')
  })

  it('ignores attempts on other cards', () => {
    const chosen = latestAttemptForCard([
      attempt({ id: 'other', card_id: 'card-2', created_at: '2026-07-31T12:00:00.000Z' }),
      attempt({ id: 'mine', created_at: '2026-07-30T00:00:00.000Z' }),
    ], 'card-1')
    expect(chosen?.id).toBe('mine')
  })

  it('is deterministic when two attempts share a timestamp', () => {
    const same = '2026-07-31T00:00:00.000Z'
    const forward = latestAttemptForCard([attempt({ id: 'a', created_at: same }), attempt({ id: 'b', created_at: same })], 'card-1')
    const reversed = latestAttemptForCard([attempt({ id: 'b', created_at: same }), attempt({ id: 'a', created_at: same })], 'card-1')
    expect(forward?.id).toBe('b')
    expect(reversed?.id).toBe('b')
  })

  it('never lets an undatable row win "most recent"', () => {
    const chosen = latestAttemptForCard([
      attempt({ id: 'broken', created_at: 'not-a-date' }),
      attempt({ id: 'real', created_at: '2026-07-20T00:00:00.000Z' }),
    ], 'card-1')
    expect(chosen?.id).toBe('real')
  })

  it('returns null when there is nothing to ground in', () => {
    expect(latestAttemptForCard([], 'card-1')).toBeNull()
    expect(latestAttemptForCard([attempt({ id: 'x' })], null)).toBeNull()
    expect(latestAttemptForCard([attempt({ id: 'x' })], undefined)).toBeNull()
    expect(latestAttemptForCard([attempt({ id: 'x', card_id: null })], 'card-1')).toBeNull()
  })
})

describe('attemptNeedsRemediation', () => {
  it('is true for a miss or a partial recall', () => {
    expect(attemptNeedsRemediation(attempt({ id: 'miss', normalized_score: 0 }))).toBe(true)
    expect(attemptNeedsRemediation(attempt({ id: 'partial', normalized_score: 0.5 }))).toBe(true)
  })

  it('is false for an item the learner said they knew', () => {
    // Selling a paid explanation of something just recalled correctly has no premise.
    expect(attemptNeedsRemediation(attempt({ id: 'known', normalized_score: 1 }))).toBe(false)
    expect(attemptNeedsRemediation(attempt({ id: 'edge', normalized_score: KNOWN_SCORE_THRESHOLD }))).toBe(false)
  })

  it('is false when there is no score — unknown is not a miss', () => {
    expect(attemptNeedsRemediation(attempt({ id: 'unscored', normalized_score: null }))).toBe(false)
    expect(attemptNeedsRemediation(attempt({ id: 'nan', normalized_score: Number.NaN }))).toBe(false)
    expect(attemptNeedsRemediation(null)).toBe(false)
    expect(attemptNeedsRemediation(undefined)).toBe(false)
  })
})

// ── attemptTypedAnswer ──────────────────────────────────────────────────────
//
// This decides whether an attempt HAS an answer in it. The stakes are the same as above and in
// the same direction: a paid `compare` grounded in an attempt with no text would be a comparison
// against nothing, sold at the price of one against something.
describe('attemptTypedAnswer', () => {
  const typed = (response: Record<string, unknown> | null): AttemptRow =>
    attempt({ id: 'a', response_type: 'text', response })

  it('returns what the learner wrote', () => {
    expect(attemptTypedAnswer(typed({ self_rated: 0, text: '사과' }))).toBe('사과')
  })

  it('trims, because surrounding whitespace is not an answer', () => {
    expect(attemptTypedAnswer(typed({ self_rated: 0, text: '  apple \n' }))).toBe('apple')
    expect(attemptTypedAnswer(typed({ self_rated: 0, text: '   ' }))).toBeNull()
  })

  it('ignores text on an attempt that only ever asked for a rating', () => {
    // `response_type` is what the row CLAIMS to hold. A `self_rate` attempt carrying text came
    // from some other writer, and rendering it as the learner's answer would attribute words to
    // them that this product never asked for.
    expect(attemptTypedAnswer(attempt({ id: 'a', response: { self_rated: 0, text: 'apple' } })))
      .toBeNull()
  })

  it('returns null for every shape that is not a string answer', () => {
    expect(attemptTypedAnswer(typed({ self_rated: 0 }))).toBeNull()
    expect(attemptTypedAnswer(typed({ self_rated: 0, text: 42 }))).toBeNull()
    expect(attemptTypedAnswer(typed({ self_rated: 0, text: null }))).toBeNull()
    expect(attemptTypedAnswer(typed(null))).toBeNull()
    expect(attemptTypedAnswer(null)).toBeNull()
    expect(attemptTypedAnswer(undefined)).toBeNull()
  })
})
