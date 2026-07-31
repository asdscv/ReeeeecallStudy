import { validationError } from '../domain/errors.ts'
import type { NormalizedScore, RubricCriterion, RubricResult } from '../domain/types.ts'
import type { EvaluationInput, EvaluationResult, Evaluator } from '../ports/evaluator.ts'
import type { RemediationProvider, RemediationRequest } from '../ports/remediation-provider.ts'
import { EvaluatorRegistry } from '../registry/evaluator-registry.ts'

const score = (value: number): NormalizedScore => Math.min(1, Math.max(0, value)) as NormalizedScore
const result = (type: string, version: string, value: number | null, summary: string, rubricResult?: RubricResult): EvaluationResult => ({
  normalizedScore: value === null ? null : score(value),
  outcome: value === null ? 'unscored' : value >= 0.999 ? 'correct' : value > 0 ? 'partial' : 'incorrect',
  feedback: { summary }, evaluatorType: type, evaluatorVersion: version, ...(rubricResult ? { rubricResult } : {}),
})

export class SelfRateEvaluator implements Evaluator {
  readonly type = 'self_rate'
  readonly version = 'self-rate-v1'
  evaluate(input: EvaluationInput): EvaluationResult {
    const raw = input.response.score ?? input.response.rating ?? input.response.known
    const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : typeof raw === 'number' ? (raw > 1 ? raw / 4 : raw) : null
    if (value === null || !Number.isFinite(value)) throw validationError('self_rate response requires a finite score, rating, or known value')
    return result(this.type, this.version, value, value >= 0.5 ? 'Learner marked the response as known.' : 'Learner marked the response for review.')
  }
}

function normalize(value: unknown, config: Record<string, unknown>): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw validationError('exact evaluator requires a string or number answer')
  let text = String(value)
  if (config.trim !== false) text = text.trim()
  if (config.caseSensitive !== true) text = text.toLocaleLowerCase('en-US')
  if (config.collapseWhitespace !== false) text = text.replace(/\s+/g, ' ')
  return text
}

export class ExactEvaluator implements Evaluator {
  readonly type = 'exact'
  readonly version = 'exact-v1'
  evaluate(input: EvaluationInput): EvaluationResult {
    const actual = normalize(input.response.answer ?? input.response.text ?? input.response.value, input.config)
    const expectedRaw = input.expectedResponse?.answers ?? input.expectedResponse?.answer ?? input.expectedResponse?.text ?? input.expectedResponse?.value
    const expected = Array.isArray(expectedRaw) ? expectedRaw : [expectedRaw]
    if (!expected.length || expected[0] === undefined) throw validationError('exact evaluator requires expectedResponse.answer or answers')
    const correct = expected.some((item) => normalize(item, input.config) === actual)
    return result(this.type, this.version, correct ? 1 : 0, correct ? 'Exact answer matched.' : 'Answer did not match the accepted response.')
  }
}

export class ChoiceEvaluator implements Evaluator {
  readonly type = 'choice'
  readonly version = 'choice-v1'
  evaluate(input: EvaluationInput): EvaluationResult {
    const selected = input.response.choiceId ?? input.response.value
    const expected = input.expectedResponse?.choiceId ?? input.expectedResponse?.value
    if (typeof selected !== 'string' || typeof expected !== 'string') throw validationError('choice evaluator requires string choiceId values')
    const correct = selected === expected
    return result(this.type, this.version, correct ? 1 : 0, correct ? 'Correct choice selected.' : 'Selected choice was incorrect.')
  }
}

function parseCriteria(rubric: Record<string, unknown> | null): RubricCriterion[] {
  const raw = rubric?.criteria
  if (!Array.isArray(raw) || raw.length === 0) throw validationError('rubric evaluator requires non-empty criteria')
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') throw validationError(`rubric criterion ${index} is invalid`)
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.label !== 'string' || typeof row.maxScore !== 'number' || row.maxScore <= 0) {
      throw validationError(`rubric criterion ${index} requires id, label, and positive maxScore`)
    }
    const weight = typeof row.weight === 'number' ? row.weight : 1
    if (!Number.isFinite(weight) || weight <= 0) throw validationError(`rubric criterion ${row.id} has invalid weight`)
    return { id: row.id, label: row.label, maxScore: row.maxScore, weight, ...(typeof row.requiredEvidence === 'string' ? { requiredEvidence: row.requiredEvidence } : {}) }
  })
}

export class DeterministicRubricEvaluator implements Evaluator {
  readonly type = 'rubric'
  readonly version = 'rubric-v1'
  evaluate(input: EvaluationInput): EvaluationResult {
    const criteria = parseCriteria(input.rubric)
    const scores = input.response.scores
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)) throw validationError('rubric response requires a scores object')
    let weighted = 0
    let maxWeighted = 0
    const evaluated = criteria.map((criterion) => {
      const raw = (scores as Record<string, unknown>)[criterion.id]
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > criterion.maxScore) throw validationError(`invalid score for rubric criterion ${criterion.id}`)
      weighted += raw * criterion.weight
      maxWeighted += criterion.maxScore * criterion.weight
      return { criterionId: criterion.id, score: raw, maxScore: criterion.maxScore }
    })
    const normalized = score(weighted / maxWeighted)
    const rubricResult: RubricResult = { criteria: evaluated, totalScore: weighted, maxTotalScore: maxWeighted, normalizedScore: normalized }
    return result(this.type, this.version, normalized, 'Response scored with the deterministic rubric.', rubricResult)
  }
}

export type AiEvaluationRequestFactory = (input: EvaluationInput) => RemediationRequest

export class AiEvaluatorAdapter implements Evaluator {
  readonly type = 'ai'
  readonly version = 'ai-adapter-v1'
  private readonly provider: RemediationProvider
  private readonly requestFactory: AiEvaluationRequestFactory
  constructor(provider: RemediationProvider, requestFactory: AiEvaluationRequestFactory) {
    this.provider = provider
    this.requestFactory = requestFactory
  }
  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const generated = await this.provider.evaluate(this.requestFactory(input))
    if (!generated.ok) throw generated.error
    const block = generated.value.blocks.find((item) => item.type === 'evaluation')?.content
    const payload = block && typeof block === 'object' ? block as Record<string, unknown> : {}
    const rawScore = payload.normalizedScore
    if (typeof rawScore !== 'number' || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1) throw validationError('AI evaluation must return normalizedScore in [0,1]')
    const summary = typeof payload.summary === 'string' ? payload.summary : generated.value.summary
    return result(this.type, this.version, rawScore, summary)
  }
}

export function createDefaultEvaluatorRegistry(): EvaluatorRegistry {
  return new EvaluatorRegistry()
    .register('self_rate', () => new SelfRateEvaluator())
    .register('exact', () => new ExactEvaluator())
    .register('choice', () => new ChoiceEvaluator())
    .register('rubric', () => new DeterministicRubricEvaluator())
}
