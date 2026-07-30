import { describe, expect, it } from 'vitest'
import { buildDailyPlan, scoreCandidate } from '@reeeeecall/shared/learning'
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
