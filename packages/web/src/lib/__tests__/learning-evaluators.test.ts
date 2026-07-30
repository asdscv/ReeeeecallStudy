import { describe, expect, it } from 'vitest'
import { ChoiceEvaluator, DeterministicRubricEvaluator, ExactEvaluator, SelfRateEvaluator, createDefaultEvaluatorRegistry } from '@reeeeecall/shared/learning'

const input = (overrides = {}) => ({ activityType: 'practice', responseType: 'text', evaluatorType: 'exact', response: {}, expectedResponse: null, rubric: null, config: {}, ...overrides })

describe('learning evaluators', () => {
  it('evaluates normalized self ratings', () => {
    expect(new SelfRateEvaluator().evaluate(input({ response: { rating: 4 } })).normalizedScore).toBe(1)
    expect(new SelfRateEvaluator().evaluate(input({ response: { known: false } })).outcome).toBe('incorrect')
  })
  it('performs configurable exact matching', () => {
    const evaluator = new ExactEvaluator()
    expect(evaluator.evaluate(input({ response: { answer: '  SEOUL ' }, expectedResponse: { answers: ['Seoul'] } })).outcome).toBe('correct')
    expect(evaluator.evaluate(input({ response: { answer: 'SEOUL' }, expectedResponse: { answer: 'Seoul' }, config: { caseSensitive: true } })).outcome).toBe('incorrect')
  })
  it('matches stable choice ids', () => {
    expect(new ChoiceEvaluator().evaluate(input({ response: { choiceId: 'b' }, expectedResponse: { choiceId: 'b' } })).normalizedScore).toBe(1)
  })
  it('computes a weighted deterministic rubric', () => {
    const evaluated = new DeterministicRubricEvaluator().evaluate(input({
      response: { scores: { issue: 2, rule: 3 } },
      rubric: { criteria: [{ id: 'issue', label: 'Issue', maxScore: 2, weight: 2 }, { id: 'rule', label: 'Rule', maxScore: 4, weight: 1 }] },
    }))
    expect(evaluated.normalizedScore).toBeCloseTo(7 / 8)
    expect(evaluated.rubricResult?.criteria).toHaveLength(2)
  })
  it('rejects malformed evaluator payloads', () => {
    expect(() => new ExactEvaluator().evaluate(input({ response: {}, expectedResponse: { answer: 'x' } }))).toThrow(/requires/)
    expect(() => new DeterministicRubricEvaluator().evaluate(input({ response: { scores: { a: 2 } }, rubric: { criteria: [{ id: 'a', label: 'A', maxScore: 1 }] } }))).toThrow(/invalid score/)
  })
  it('builds a duplicate-safe default registry', () => {
    expect(createDefaultEvaluatorRegistry().ids()).toEqual(['choice', 'exact', 'rubric', 'self_rate'])
  })
})
