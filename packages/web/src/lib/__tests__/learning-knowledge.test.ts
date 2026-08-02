/**
 * "학습 완료" must mean one thing, and swapping what it means must be one edit.
 *
 * The app shipped two answers that disagreed — the dashboard counted `interval >= 21`, the
 * achievement migration counted `ease_factor > 2.5 && status='review'` — and the second is not a
 * mastery test at all: ease STARTS at 2.5 and gains +0.05 per correct review, so a single right
 * answer qualifies a card. These tests pin the replacement and, more importantly, pin that the
 * replacement is swappable: a criterion change has to move every number, or the "one place to
 * change it" claim is decoration.
 */
import { describe, expect, it } from 'vitest'
import {
  activeKnowledgeCriterion, availableCriterionIds, knowledgeCriterionFor,
  createDefaultKnowledgeRegistry, LEGACY_MATURE_INTERVAL_DAYS,
  knowledgeState, retentionCriterion, intervalCriterion, easeAboveDefaultCriterion,
  DEFAULT_TARGET_RETENTION, retentionStabilityMultiplier,
} from '@reeeeecall/shared/learning'

const NOW = '2026-08-01T00:00:00.000Z'
const EXAM = '2026-11-01T00:00:00.000Z'   // 92 days out

/** A card last reviewed `ago` days back, scheduled at `interval`. */
const card = (interval: number, ago: number) => ({
  intervalDays: interval,
  lastReviewedAt: new Date(Date.parse(NOW) - ago * 86_400_000).toISOString(),
  nextReviewAt: new Date(Date.parse(NOW) + (interval - ago) * 86_400_000).toISOString(),
  easeFactor: 2.55,
  srsStatus: 'review',
})

describe('the active criterion', () => {
  it('is the one every surface gets, and it is retention', () => {
    expect(activeKnowledgeCriterion().id).toBe('retention')
    expect(activeKnowledgeCriterion().describe()).toEqual({ kind: 'retention', value: DEFAULT_TARGET_RETENTION })
  })

  it('ships the two legacy rules it replaces, so a migration can name them', () => {
    expect([...availableCriterionIds()]).toEqual(['ease-above-default', 'interval', 'retention'])
    expect([...availableCriterionIds()]).toEqual([...createDefaultKnowledgeRegistry().ids()])
  })

  it('degrades to null for an id this build does not ship', () => {
    // Reporting screens must render under a stale or newer stored config, not fail.
    expect(knowledgeCriterionFor('not-shipped')).toBeNull()
    expect(knowledgeCriterionFor(null)).toBeNull()
  })
})

describe('retention criterion', () => {
  it('a card just reviewed is known now, and forgotten by a distant exam', () => {
    const fresh = card(10, 0)
    expect(retentionCriterion().isKnown(fresh, { now: NOW, at: NOW })).toBe(true)
    // Same card, judged 92 days out with no further review: the curve has decayed past 0.9.
    expect(retentionCriterion().isKnown(fresh, { now: NOW, at: EXAM })).toBe(false)
  })

  it('a long interval survives the same distance', () => {
    // Stability tracks the interval, so a 365-day card is still above target at 92 days.
    expect(retentionCriterion().isKnown(card(365, 0), { now: NOW, at: EXAM })).toBe(true)
  })

  it('answers null — not zero — for a card never reviewed', () => {
    // A deck of new cards must read "not started", not a confident 0%. `knowledgeState` keeps
    // `unseen` out of both buckets for exactly this reason.
    const unseen = { intervalDays: 0, lastReviewedAt: null, nextReviewAt: null, srsStatus: 'new' }
    expect(retentionCriterion().confidence(unseen, { now: NOW, at: NOW })).toBeNull()
    expect(retentionCriterion().isKnown(unseen, { now: NOW, at: NOW })).toBe(false)
  })

  it('rejects a nonsense retention target instead of scoring with it', () => {
    expect(() => retentionCriterion(0)).toThrow()
    expect(() => retentionCriterion(1)).toThrow()
    expect(() => retentionCriterion(Number.NaN)).toThrow()
  })

  it('a stricter target is harder to satisfy', () => {
    const c = card(60, 30)
    expect(retentionCriterion(0.8).isKnown(c, { now: NOW, at: NOW })).toBe(true)
    expect(retentionCriterion(0.99).isKnown(c, { now: NOW, at: NOW })).toBe(false)
  })
})

describe('the legacy rules, stated honestly', () => {
  it('the interval rule is Anki\'s arbitrary 21-day line', () => {
    expect(LEGACY_MATURE_INTERVAL_DAYS).toBe(21)
    expect(intervalCriterion(21).isKnown(card(21, 0), { now: NOW, at: NOW })).toBe(true)
    expect(intervalCriterion(21).isKnown(card(20, 0), { now: NOW, at: NOW })).toBe(false)
  })

  it('the ease rule fires after ONE correct review — which is the defect', () => {
    // Pinned so the migration replacing it cannot be argued with. ease 2.5 -> 2.545 after a
    // single "good", and 2.545 > 2.5, so this card counted toward the 1,000-card mastery badge.
    const barelyTouched = { intervalDays: 1, lastReviewedAt: NOW, easeFactor: 2.545, srsStatus: 'review' }
    expect(easeAboveDefaultCriterion().isKnown(barelyTouched, { now: NOW, at: NOW })).toBe(true)
    // ...while the rule the app is moving TO does not consider it known on exam day.
    expect(retentionCriterion().isKnown(barelyTouched, { now: NOW, at: EXAM })).toBe(false)
  })
})

describe('knowledgeState', () => {
  const deck = [card(365, 0), card(365, 0), card(5, 4), { intervalDays: 0, lastReviewedAt: null, srsStatus: 'new' }]

  it('keeps never-reviewed cards out of both known and unknown', () => {
    const s = knowledgeState(deck, { now: NOW, at: EXAM }, activeKnowledgeCriterion())
    expect(s.total).toBe(4)
    expect(s.unseen).toBe(1)
    expect(s.known + s.unknown).toBe(3)
    expect(s.known).toBe(2)
  })

  it('changing the criterion changes the answer — the whole point of the seam', () => {
    const moment = { now: NOW, at: EXAM }
    const byRetention = knowledgeState(deck, moment, retentionCriterion())
    const byEase = knowledgeState(deck, moment, easeAboveDefaultCriterion())
    // The 5-day card is long forgotten by exam day, but its ease is 2.55 so the old rule counts
    // it. If these two ever agree, the swap is not doing anything.
    expect(byEase.known).toBeGreaterThan(byRetention.known)
  })

  it('reports no mean confidence for a deck nobody has studied', () => {
    const s = knowledgeState(
      [{ intervalDays: 0, lastReviewedAt: null, srsStatus: 'new' }],
      { now: NOW, at: NOW },
      activeKnowledgeCriterion(),
    )
    expect(s.meanConfidence).toBeNull()
    expect(s.unseen).toBe(1)
  })
})

describe('retentionStabilityMultiplier', () => {
  it('is exactly 1 at the default target — which is why "known" reads as "not overdue"', () => {
    // A property of the FSRS-5 constants, pinned because migration 181's SQL leans on it: the
    // default rule becomes a plain date comparison, and a drift here would silently reshape
    // every progress number the server reports.
    expect(retentionStabilityMultiplier(DEFAULT_TARGET_RETENTION)).toBeCloseTo(1, 6)
  })

  it('demanding more retention allows less elapsed time, and vice versa', () => {
    expect(retentionStabilityMultiplier(0.95)).toBeLessThan(1)
    expect(retentionStabilityMultiplier(0.8)).toBeGreaterThan(1)
  })

  it('agrees with the criterion it is derived from', () => {
    // The SQL and the TypeScript must classify the same card the same way. Elapsed exactly at
    // the multiple is the boundary the database compares with <=, so it must be known.
    for (const target of [0.8, 0.9, 0.95]) {
      const k = retentionStabilityMultiplier(target)
      const interval = 40
      const atBoundary = card(interval, Math.floor(interval * k))
      const pastIt = card(interval, Math.ceil(interval * k) + 2)
      expect(retentionCriterion(target).isKnown(atBoundary, { now: NOW, at: NOW }), `${target} boundary`).toBe(true)
      expect(retentionCriterion(target).isKnown(pastIt, { now: NOW, at: NOW }), `${target} past`).toBe(false)
    }
  })

  it('refuses a nonsense target rather than returning a multiplier for it', () => {
    expect(() => retentionStabilityMultiplier(0)).toThrow()
    expect(() => retentionStabilityMultiplier(1)).toThrow()
  })
})
