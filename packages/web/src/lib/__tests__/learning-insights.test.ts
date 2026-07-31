/**
 * learning-insights — the diagnostics arithmetic.
 *
 * The failure mode this guards is quiet and permanent: reporting 0 where the honest answer
 * is "no data". 0% accuracy means the learner got everything wrong; an empty attempt list
 * means nothing has been tried. A single `?? 0` collapses those into the same sentence and
 * tells a new user they are failing.
 */
import { describe, it, expect } from 'vitest'
import {
  summarizeLearning, KNOWN_THRESHOLD, WEAK_MIN_ATTEMPTS, WEAK_MAX_MEAN_SCORE,
  type InsightAttempt, type InsightPlan,
} from '@reeeeecall/shared/lib/learning-insights'

const attempt = (over: Partial<InsightAttempt> = {}): InsightAttempt => ({
  card_id: 'card-1',
  normalized_score: 1,
  duration_ms: 5_000,
  created_at: '2026-07-31T00:00:00.000Z',
  ...over,
})

const plan = (over: Partial<InsightPlan> = {}): InsightPlan => ({
  plan_date: '2026-07-31', total_items: 4, completed_items: 2, ...over,
})

describe('accuracy', () => {
  it('is null with no data, not zero', () => {
    expect(summarizeLearning({ attempts: [], plans: [] }).accuracy).toBeNull()
  })

  it('is null when nothing was scored, even if attempts exist', () => {
    const out = summarizeLearning({ attempts: [attempt({ normalized_score: null })], plans: [] })
    expect(out.attemptCount).toBe(1)
    expect(out.scoredCount).toBe(0)
    expect(out.accuracy).toBeNull()
  })

  it('counts only scored attempts in the denominator', () => {
    const out = summarizeLearning({
      attempts: [
        attempt({ normalized_score: 1 }),
        attempt({ normalized_score: 0 }),
        attempt({ normalized_score: null }),
      ],
      plans: [],
    })
    expect(out.accuracy).toBe(0.5)
  })

  it('treats the threshold as inclusive', () => {
    const out = summarizeLearning({
      attempts: [attempt({ normalized_score: KNOWN_THRESHOLD })], plans: [],
    })
    expect(out.accuracy).toBe(1)
  })

  it('reports a real zero when everything was missed', () => {
    const out = summarizeLearning({
      attempts: [attempt({ normalized_score: 0 }), attempt({ normalized_score: 0 })], plans: [],
    })
    expect(out.accuracy).toBe(0)
  })
})

describe('median duration', () => {
  it('is null when nothing is measurable', () => {
    expect(summarizeLearning({ attempts: [], plans: [] }).medianDurationMs).toBeNull()
    expect(summarizeLearning({
      attempts: [attempt({ duration_ms: 0 })], plans: [],
    }).medianDurationMs).toBeNull()
  })

  it('resists a single outlier, which a mean would not', () => {
    const out = summarizeLearning({
      attempts: [
        attempt({ duration_ms: 4_000 }),
        attempt({ duration_ms: 5_000 }),
        attempt({ duration_ms: 6_000 }),
        attempt({ duration_ms: 1_200_000 }), // walked away mid-answer
      ],
      plans: [],
    })
    expect(out.medianDurationMs).toBe(5_500)
  })
})

describe('weak cards', () => {
  it('needs repeated evidence before calling a card weak', () => {
    const out = summarizeLearning({
      attempts: [attempt({ card_id: 'c1', normalized_score: 0 })], plans: [],
    })
    expect(WEAK_MIN_ATTEMPTS).toBe(2)
    expect(out.weakCards).toEqual([])
  })

  it('lists a card whose mean is below the bar, worst first', () => {
    const out = summarizeLearning({
      attempts: [
        attempt({ card_id: 'c1', normalized_score: 0 }),
        attempt({ card_id: 'c1', normalized_score: 0.5 }),
        attempt({ card_id: 'c2', normalized_score: 0 }),
        attempt({ card_id: 'c2', normalized_score: 0 }),
      ],
      plans: [],
    })
    expect(out.weakCards.map((c) => c.cardId)).toEqual(['c2', 'c1'])
    expect(out.weakCards[1].meanScore).toBe(0.25)
    expect(out.weakCards[1].attempts).toBe(2)
  })

  it('leaves out a card the learner has since mastered', () => {
    const out = summarizeLearning({
      attempts: [
        attempt({ card_id: 'c1', normalized_score: 1 }),
        attempt({ card_id: 'c1', normalized_score: 1 }),
      ],
      plans: [],
    })
    expect(WEAK_MAX_MEAN_SCORE).toBe(0.6)
    expect(out.weakCards).toEqual([])
  })

  it('ignores unscored attempts and attempts with no card', () => {
    const out = summarizeLearning({
      attempts: [
        attempt({ card_id: 'c1', normalized_score: null }),
        attempt({ card_id: 'c1', normalized_score: null }),
        attempt({ card_id: null, normalized_score: 0 }),
        attempt({ card_id: null, normalized_score: 0 }),
      ],
      plans: [],
    })
    expect(out.weakCards).toEqual([])
  })

  it('is ordered deterministically when two cards tie', () => {
    const tie = [
      attempt({ card_id: 'b', normalized_score: 0 }), attempt({ card_id: 'b', normalized_score: 0 }),
      attempt({ card_id: 'a', normalized_score: 0 }), attempt({ card_id: 'a', normalized_score: 0 }),
    ]
    expect(summarizeLearning({ attempts: tie, plans: [] }).weakCards.map((c) => c.cardId))
      .toEqual(['a', 'b'])
    expect(summarizeLearning({ attempts: [...tie].reverse(), plans: [] }).weakCards.map((c) => c.cardId))
      .toEqual(['a', 'b'])
  })

  it('caps the list at ten so the page cannot become a dump', () => {
    const many: InsightAttempt[] = []
    for (let i = 0; i < 30; i += 1) {
      many.push(attempt({ card_id: `c${i}`, normalized_score: 0 }))
      many.push(attempt({ card_id: `c${i}`, normalized_score: 0 }))
    }
    expect(summarizeLearning({ attempts: many, plans: [] }).weakCards).toHaveLength(10)
  })
})

describe('plan adherence', () => {
  it('is null for a day that planned nothing — that is not 0% done', () => {
    const out = summarizeLearning({
      attempts: [], plans: [plan({ total_items: 0, completed_items: 0 })],
    })
    expect(out.adherence[0].ratio).toBeNull()
    expect(out.overallAdherence).toBeNull()
  })

  it('is the completed share per day, newest first', () => {
    const out = summarizeLearning({
      attempts: [],
      plans: [
        plan({ plan_date: '2026-07-29', total_items: 4, completed_items: 1 }),
        plan({ plan_date: '2026-07-31', total_items: 2, completed_items: 2 }),
        plan({ plan_date: '2026-07-30', total_items: 5, completed_items: 0 }),
      ],
    })
    expect(out.adherence.map((d) => d.planDate)).toEqual(['2026-07-31', '2026-07-30', '2026-07-29'])
    expect(out.adherence[0].ratio).toBe(1)
    expect(out.adherence[1].ratio).toBe(0)
    expect(out.adherence[2].ratio).toBe(0.25)
  })

  it('aggregates the window by items, not by averaging percentages', () => {
    // A 1/1 day and a 0/9 day is 10% adherence, not 50%. Averaging the daily ratios would
    // let a single trivial day paper over a wasted week.
    const out = summarizeLearning({
      attempts: [],
      plans: [
        plan({ plan_date: '2026-07-31', total_items: 1, completed_items: 1 }),
        plan({ plan_date: '2026-07-30', total_items: 9, completed_items: 0 }),
      ],
    })
    expect(out.overallAdherence).toBeCloseTo(0.1, 6)
  })

  it('clamps a plan that somehow over-completed', () => {
    const out = summarizeLearning({
      attempts: [], plans: [plan({ total_items: 2, completed_items: 5 })],
    })
    expect(out.adherence[0].ratio).toBe(1)
    expect(out.overallAdherence).toBe(1)
  })
})
