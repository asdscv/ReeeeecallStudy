import { describe, expect, it } from 'vitest'
import { buildDailyPlan, DAILY_PLANNER_VERSION, scoreCandidate } from '@reeeeecall/shared/learning'
import type { LearningGoal, PlannerCandidate } from '@reeeeecall/shared/learning'

const goal: LearningGoal = {
  id: 'goal-1', userId: 'user-1', domainId: 'language', title: 'English',
  targetDate: null, dailyMinutes: 20, status: 'active', target: {}, settings: {},
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
}

function candidate(id: string, activityType: string, overrides: Partial<PlannerCandidate> = {}): PlannerCandidate {
  return {
    candidateId: id, activityId: id, cardId: null, conceptId: null,
    activityType, dueUrgency: 0.5, recentFailure: 0.5,
    responseTimePenalty: 0.5, goalRelevance: 0.5, contentImportance: 0.5,
    estimatedMinutes: 3, difficulty: null, ...overrides,
  }
}

const baseInput = {
  goal,
  budgetMinutes: 10,
  now: '2026-07-29T10:00:00.000Z',
  timezone: 'Asia/Seoul',
  algorithmVersion: 'daily-plan-v1',
}

describe('daily learning planner', () => {
  it('is deterministic for identical normalized input', () => {
    const candidates = [candidate('b', 'recall'), candidate('a', 'practice')]
    const first = buildDailyPlan({ ...baseInput, candidates })
    const second = buildDailyPlan({ ...baseInput, candidates })
    expect(second).toEqual(first)
    expect(first.inputFingerprint).toMatch(/^fnv1a32:/)
  })

  it('prioritizes due urgency and recent failure with stable tie breaking', () => {
    const urgent = candidate('urgent', 'recall', { dueUrgency: 1, recentFailure: 1 })
    const ordinary = candidate('ordinary', 'recall', { dueUrgency: 0, recentFailure: 0 })
    expect(scoreCandidate(urgent)).toBeGreaterThan(scoreCandidate(ordinary))
    const result = buildDailyPlan({ ...baseInput, candidates: [ordinary, urgent] })
    expect(result.items.map((item) => item.candidateId)).toEqual(['urgent', 'ordinary'])
  })

  it('never exceeds the total time budget and reallocates unused mix budget', () => {
    const result = buildDailyPlan({
      ...baseInput,
      budgetMinutes: 7,
      candidates: [
        candidate('r1', 'recall', { estimatedMinutes: 3 }),
        candidate('r2', 'recall', { estimatedMinutes: 3 }),
        candidate('p1', 'practice', { estimatedMinutes: 2 }),
      ],
    })
    expect(result.totalMinutes).toBeLessThanOrEqual(7)
    expect(result.items.length).toBeGreaterThan(0)
  })

  it('deduplicates candidate ids using the highest-scoring variant', () => {
    const result = buildDailyPlan({
      ...baseInput,
      candidates: [
        candidate('same', 'recall', { dueUrgency: 0 }),
        candidate('same', 'recall', { dueUrgency: 1 }),
      ],
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.priority).toBeGreaterThan(0.5)
  })

  it('excludes unsupported future capabilities instead of coercing them', () => {
    const result = buildDailyPlan(
      { ...baseInput, candidates: [candidate('audio', 'listening'), candidate('text', 'recall')] },
      { supportedActivityTypes: ['recall', 'practice', 'produce'] },
    )
    expect(result.items.map((item) => item.candidateId)).toEqual(['text'])
    expect(result.diagnostics.excludedUnsupported).toBe(1)
  })

  it('returns an empty successful plan when there are no candidates', () => {
    const result = buildDailyPlan({ ...baseInput, candidates: [] })
    expect(result.items).toEqual([])
    expect(result.totalMinutes).toBe(0)
  })

  it('rejects an invalid budget', () => {
    expect(() => buildDailyPlan({ ...baseInput, budgetMinutes: 0, candidates: [] })).toThrow(/budgetMinutes/)
  })
})

// ─── daily-plan-v2: the memory model in the ranking ─────────────────────────
describe('planner memory model (daily-plan-v2)', () => {
  it('is versioned, so plans ranked by different weights are distinguishable', () => {
    expect(DAILY_PLANNER_VERSION).toBe('daily-plan-v2')
  })

  it('ranks a card at its retrievability peak above a more-overdue one it is sure of', () => {
    // This is the v1 defect the memory model exists to fix: `dueUrgency` alone made the most
    // overdue card win even when recall was still near-certain.
    const atPeak = candidate('peak', 'recall', { dueUrgency: 0.55, reviewValue: 1 })
    const overdueButKnown = candidate('overdue', 'recall', { dueUrgency: 1, reviewValue: 0.05 })
    expect(scoreCandidate(atPeak)).toBeGreaterThan(scoreCandidate(overdueButKnown))

    const result = buildDailyPlan({ ...baseInput, candidates: [overdueButKnown, atPeak] })
    expect(result.items.map((item) => item.candidateId)).toEqual(['peak', 'overdue'])
  })

  it('renormalises a missing memory estimate instead of scoring it 0 or 0.5', () => {
    // All other features at 1, so the three candidate behaviours are numerically distinct:
    //   renormalise → 1.0     substitute 0.5 → 0.875     implicit zero → 0.75
    const allElseMax = {
      dueUrgency: 1, recentFailure: 1, responseTimePenalty: 1, goalRelevance: 1, contentImportance: 1,
    }
    const unknown = candidate('unknown', 'recall', allElseMax)                        // absent
    const explicitNull = candidate('null', 'recall', { ...allElseMax, reviewValue: null })

    expect(scoreCandidate(unknown)).toBeCloseTo(1, 12)                 // renormalised
    expect(scoreCandidate(unknown)).not.toBeCloseTo(0.875, 6)          // not 0.5-substituted
    expect(scoreCandidate(unknown)).not.toBeCloseTo(0.75, 6)           // not implicit zero
    // Absent and null are the same thing: no evidence.
    expect(scoreCandidate(explicitNull)).toBeCloseTo(scoreCandidate(unknown), 12)
  })

  it('keeps unknown-memory candidates comparable to scored ones', () => {
    // Renormalising must not become a bonus: with everything else equal, a card known to be
    // worth reviewing outranks an unknown one, and a card known to need nothing ranks below it.
    const unknown = candidate('unknown', 'recall')
    const worthIt = candidate('worth', 'recall', { reviewValue: 1 })
    const pointless = candidate('pointless', 'recall', { reviewValue: 0 })
    expect(scoreCandidate(worthIt)).toBeGreaterThan(scoreCandidate(unknown))
    expect(scoreCandidate(pointless)).toBeLessThan(scoreCandidate(unknown))
    // With every other feature neutral, renormalising lands on 0.5 exactly rather than
    // drifting with the divisor.
    expect(scoreCandidate(unknown)).toBeCloseTo(0.5, 12)
  })

  it('treats an unusable memory value as unknown rather than neutral', () => {
    const garbage = candidate('garbage', 'recall', { reviewValue: Number.NaN })
    expect(scoreCandidate(garbage)).toBeCloseTo(scoreCandidate(candidate('unknown', 'recall')), 12)
  })

  it('clamps an out-of-range memory value instead of letting it inflate the score', () => {
    const high = candidate('high', 'recall', { reviewValue: 42 })
    const one = candidate('one', 'recall', { reviewValue: 1 })
    expect(scoreCandidate(high)).toBeCloseTo(scoreCandidate(one), 12)
  })

  it('reports memory_risk as the reason when the memory estimate dominates', () => {
    const result = buildDailyPlan({
      ...baseInput,
      candidates: [candidate('risky', 'recall', {
        reviewValue: 1, dueUrgency: 0, recentFailure: 0, responseTimePenalty: 0,
        goalRelevance: 0, contentImportance: 0,
      })],
    })
    expect(result.items[0]?.reasonCode).toBe('memory_risk')
    expect(result.diagnostics.reasonCodes.memory_risk).toBe(1)
  })

  it('never blames a memory estimate it does not have', () => {
    const result = buildDailyPlan({
      ...baseInput,
      candidates: [candidate('nomem', 'recall', {
        reviewValue: null, dueUrgency: 1, recentFailure: 0, responseTimePenalty: 0,
        goalRelevance: 0, contentImportance: 0,
      })],
    })
    expect(result.items[0]?.reasonCode).toBe('due')
  })

  it('keeps the memory estimate inside the input fingerprint', () => {
    const a = buildDailyPlan({ ...baseInput, candidates: [candidate('c', 'recall', { reviewValue: 0.2 })] })
    const b = buildDailyPlan({ ...baseInput, candidates: [candidate('c', 'recall', { reviewValue: 0.9 })] })
    expect(a.inputFingerprint).not.toBe(b.inputFingerprint)
  })
})
