/**
 * Jev as the quiz grader: the request it sends, and that what comes back passes through the
 * UNCHANGED validators in `ai-quiz.ts` to the same grade shape the LLM grader produced.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  buildShortAnswerJevRequest, shortAnswerRawFromJev, buildEssayJevRequest, essayRawFromJev,
  callJev, gradeWithJev, JEV_ENDPOINT, type JevAnswer,
} from '../../../../../supabase/functions/_shared/ai-quiz-jev.ts'
import {
  validateShortAnswerGrade, validateEssayGrade, SHORT_ANSWER_GAPS, type EssayCriterion,
} from '../../../../../supabase/functions/_shared/ai-quiz.ts'

const input = { question: "'lend'를 한국어로 쓰세요.", reference: '빌려주다', learner: '빌리다', crossLingual: true }

const choice = (c: string, probabilities: Record<string, number>, confidence = 0.8): JevAnswer =>
  ({ type: 'choice', choice: c, probabilities, confidence })
const noul = (p: number): JevAnswer => ({ type: 'noul', noul: p })

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('buildShortAnswerJevRequest', () => {
  it('asks one verdict Choice over every verdict and one Noul per gap, on the three texts', () => {
    const req = buildShortAnswerJevRequest(input)
    expect(req.state).toEqual({ question: input.question, reference: '빌려주다', learner_response: '빌리다' })
    expect(req.questions.verdict.type).toBe('choice')
    expect(Object.keys((req.questions.verdict as { criteria: object }).criteria)).toEqual(
      ['equivalent', 'equivalent_with_error', 'partial', 'different', 'empty', 'unjudgeable'])
    for (const gap of SHORT_ANSWER_GAPS) expect(req.questions[`gap_${gap}`]?.type).toBe('noul')
  })

  it('tells the grader whether the language is being tested, from the card', () => {
    const cross = JSON.stringify(buildShortAnswerJevRequest(input).questions.verdict)
    const same = JSON.stringify(buildShortAnswerJevRequest({ ...input, crossLingual: false }).questions.verdict)
    expect(cross).toContain('at best')
    expect(same).toContain('still')
  })
})

describe('shortAnswerRawFromJev → validateShortAnswerGrade', () => {
  it('a confident "different" with an inverted relation grades low, inside its band, with that gap', () => {
    const raw = shortAnswerRawFromJev({
      verdict: choice('different', { equivalent: 0.01, equivalent_with_error: 0.03, partial: 0.12, different: 0.84, empty: 0, unjudgeable: 0 }),
      gap_wrong_direction: noul(0.93), gap_missing_part: noul(0.2), gap_spelling: noul(0.05),
    })
    const out = validateShortAnswerGrade(raw, input)
    expect(out.graded).toBe(true)
    if (!out.graded) return
    expect(out.grade.verdict).toBe('different')
    expect(out.grade.score).toBeGreaterThanOrEqual(0)
    expect(out.grade.score).toBeLessThanOrEqual(0.3)
    expect(out.grade.gaps).toEqual(['wrong_direction'])
    expect(out.grade.spans).toEqual([])
  })

  it('the score reflects how close the runner-up was: a near-partial "different" sits higher in its band', () => {
    const sure = shortAnswerRawFromJev({ verdict: choice('different', { different: 1 }) })
    const unsure = shortAnswerRawFromJev({ verdict: choice('different', { different: 0.55, partial: 0.45 }) })
    const a = validateShortAnswerGrade(sure, input)
    const b = validateShortAnswerGrade(unsure, input)
    expect(a.graded && b.graded).toBe(true)
    if (!a.graded || !b.graded) return
    expect(b.grade.score).toBeGreaterThan(a.grade.score)
    expect(b.grade.score).toBeLessThanOrEqual(0.3)
  })

  it('gaps are the Nouls over 0.5, most likely first, at most three', () => {
    const raw = shortAnswerRawFromJev({
      verdict: choice('partial', { partial: 1 }),
      gap_missing_part: noul(0.7), gap_extra_claim: noul(0.9), gap_too_vague: noul(0.6), gap_spelling: noul(0.55),
      gap_wrong_language: noul(0.49),
    })
    expect(raw?.gaps).toEqual(['extra_claim', 'missing_part', 'too_vague'])
  })

  it('"unjudgeable" still refuses (and so refunds)', () => {
    const out = validateShortAnswerGrade(shortAnswerRawFromJev({ verdict: choice('unjudgeable', { unjudgeable: 1 }) }), input)
    expect(out).toEqual({ graded: false, refusal: 'model_declined' })
  })

  it('a missing or foreign verdict is invalid_result, not a default grade', () => {
    expect(validateShortAnswerGrade(shortAnswerRawFromJev({}), input))
      .toEqual({ graded: false, refusal: 'invalid_result' })
    expect(validateShortAnswerGrade(shortAnswerRawFromJev({ verdict: choice('maybe', { maybe: 1 }) }), input))
      .toEqual({ graded: false, refusal: 'invalid_result' })
  })

  it('the cross-lingual cap still applies to a Jev verdict', () => {
    const raw = shortAnswerRawFromJev({ verdict: choice('equivalent', { equivalent: 1 }), gap_wrong_language: noul(0.9) })
    const out = validateShortAnswerGrade(raw, input)
    expect(out.graded && out.grade.verdict).toBe('partial')
  })
})

describe('essay', () => {
  const criteria: EssayCriterion[] = [
    { id: 'q:0', aspect: 'covers_answer', weight: 60, mustMention: ['빌려주다'] },
    { id: 'q:1', aspect: 'gives_example', weight: 40, mustMention: ['돈'] },
  ]

  it('asks one Choice per criterion, carrying that criterion\'s requirement and terms', () => {
    const req = buildEssayJevRequest(input, criteria)
    expect(Object.keys(req.questions)).toEqual(['criterion_0', 'criterion_1'])
    expect(JSON.stringify(req.questions.criterion_1)).toContain('돈')
  })

  it('levels map back to criterion ids and the SAME weight arithmetic derives the score', () => {
    const raw = essayRawFromJev({
      criterion_0: choice('met', { met: 1 }), criterion_1: choice('partial', { partial: 1 }),
    }, criteria)
    const out = validateEssayGrade(raw, criteria, input)
    expect(out.graded).toBe(true)
    if (!out.graded) return
    expect(out.grade.score).toBeCloseTo(0.8) // 60*1 + 40*0.5
    expect(out.grade.criteria.map((c) => c.level)).toEqual(['met', 'partial'])
  })

  it('a criterion Jev did not answer is unjudgeable, and too much of that refuses', () => {
    const out = validateEssayGrade(essayRawFromJev({ criterion_1: choice('met', { met: 1 }) }, criteria), criteria, input)
    expect(out).toEqual({ graded: false, refusal: 'model_declined' })
  })
})

describe('callJev', () => {
  const body = buildShortAnswerJevRequest(input)
  const ok = { model: 'jev-1.13.0', answers: { verdict: choice('different', { different: 1 }) }, usage: { input_tokens: 500, output_tokens: 81 } }

  it('POSTs to the endpoint with the bearer key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ok))
    const res = await callJev(body, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(res.model).toBe('jev-1.13.0')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(JEV_ENDPOINT)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')
  })

  it('backs off and retries 429/529, then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 529))
      .mockResolvedValueOnce(jsonResponse(ok))
    const sleep = vi.fn(async () => {})
    await callJev(body, { apiKey: 'k', fetchImpl, sleep, retryDelaysMs: [1, 2] })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('does not retry our own mistakes (401/422)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 422))
    await expect(callJev(body, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} }))
      .rejects.toThrow('JEV_422')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('gives up after the last retry with the last status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 529))
    await expect(callJev(body, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, retryDelaysMs: [1] }))
      .rejects.toThrow('JEV_529')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('gradeWithJev returns validator-ready raw material plus model and usage for the ledger', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ok))
    const out = await gradeWithJev('short_answer', input, [], { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(out.model).toBe('jev-1.13.0')
    expect(out.usage).toEqual({ input_tokens: 500, output_tokens: 81 })
    expect(validateShortAnswerGrade(out.raw, input).graded).toBe(true)
  })
})
