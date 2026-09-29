/**
 * Quiz grading on Jev (TypeSafe System One) — the verdict as a typed judgement, not parsed prose.
 *
 * ## Why grading moved here
 *
 * Grading was already a closed-set decision: a verdict from `SHORT_ANSWER_VERDICTS`, gaps from
 * `SHORT_ANSWER_GAPS`, a level per essay criterion from `ESSAY_LEVELS`. The LLM grader was asked
 * to *type* those enum members inside a JSON blob, and `validateShortAnswerGrade` then spent most
 * of its length defending against what a text generator does to a closed set — unknown members,
 * a score that disagrees with its own verdict, a missing field.
 *
 * Jev answers the closed set directly. A Choice returns one of the options we defined and a
 * probability for every one of them; a Noul returns the probability a condition holds. There is
 * no string to parse, no temperature to pin, and the same answer asked twice gets the same
 * distribution — which is what `QUIZ_TEMPERATURE.grade = 0` was trying to buy.
 *
 * ## What did NOT change
 *
 * The contract. This module builds the same raw shape the LLM grader returned and hands it to the
 * SAME validators in `ai-quiz.ts`, so the bands, the cross-lingual cap, the essay weight arithmetic
 * and every refusal (all of which refund) are enforced exactly as before. Jev is a different
 * source of the judgement, not a different definition of a grade.
 *
 * The one thing Jev does not supply is spans — it selects, it does not point at character offsets.
 * Spans were always optional (an out-of-range span was dropped alone), so a Jev grade renders the
 * verdict and gaps without highlights.
 *
 * ## Why this file imports only `ai-quiz.ts` and uses global `fetch`
 *
 * Same constraint as its neighbours: it is deployed with the edge function and unit-tested by
 * vitest, so it may not reach into `packages/` or use a Deno-only API. The key is passed in by the
 * caller, never read here.
 */

import {
  SHORT_ANSWER_BANDS, SHORT_ANSWER_GAPS, SHORT_ANSWER_VERDICTS, MAX_GAPS_PER_GRADE,
  type EssayAspect, type EssayCriterion, type QuizGradeInput, type ShortAnswerGap, type ShortAnswerVerdict,
} from './ai-quiz.ts'

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const JEV_MODEL = 'jev-latest'
export const JEV_PROVIDER = 'typesafe'

/** A Noul at or above this is a gap the learner is shown. 0.5 is "more likely than not". */
export const JEV_GAP_THRESHOLD = 0.5

// ─── Wire types ─────────────────────────────────────────────────────────────

type JevCriteria = string | Record<string, unknown> | unknown[]

export type JevQuestion =
  | { readonly type: 'choice'; readonly instructions: JevCriteria; readonly criteria: Record<string, JevCriteria | null> }
  | { readonly type: 'noul'; readonly instructions: JevCriteria; readonly criteria?: { true?: JevCriteria; false?: JevCriteria } }

export interface JevRequest {
  readonly model: string
  readonly state: Record<string, unknown>
  readonly questions: Record<string, JevQuestion>
}

export type JevAnswer =
  | { readonly type: 'choice'; readonly choice: string; readonly probabilities: Record<string, number>; readonly confidence: number }
  | { readonly type: 'noul'; readonly noul: number }

export interface JevResponse {
  readonly model: string
  readonly answers: Record<string, JevAnswer>
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number } | null
}

// ─── Shared framing ─────────────────────────────────────────────────────────

/**
 * The same sentence `EQUIVALENCE` puts at the top of the LLM grader, for the same reason: the card
 * is the authority, the model is the comparator. A grader asked "is this correct?" answers from
 * what it knows; asked "do these mean the same?", it compares two strings it was handed.
 */
const REFERENCE_IS_AUTHORITY =
  '`reference` is the answer this learner\'s own flashcard declares. Treat it as correct by definition, even if you'
  + ' believe otherwise, and judge only whether `learner_response` means the same thing. Different wording, synonyms'
  + ' and paraphrase that carry the same meaning count as the same.'

function gradeState(input: QuizGradeInput): Record<string, unknown> {
  return { question: input.question, reference: input.reference, learner_response: input.learner }
}

// ─── Short answer ───────────────────────────────────────────────────────────

const VERDICT_CRITERIA: Readonly<Record<ShortAnswerVerdict, string>> = {
  equivalent: 'Means the same as `reference`. Rewording, a synonym, or a different but equivalent form is fine.',
  equivalent_with_error: 'The meaning of `reference` arrived, but with a spelling, typo, or inflection error.',
  partial: 'States part of what `reference` says and misses another part of it.',
  different: 'Does not mean what `reference` means — a different, opposite, or unrelated answer.',
  empty: 'No actual attempt: blank-equivalent text such as "?", "모르겠다", "I don\'t know", or a copy of the question.',
  unjudgeable: 'It is genuinely impossible to tell whether it means the same as `reference` (e.g. unreadable text).',
}

const GAP_QUESTIONS: Readonly<Record<ShortAnswerGap, string>> = {
  missing_part: 'Does `reference` state something that `learner_response` leaves out?',
  extra_claim: 'Does `learner_response` state something that `reference` does not?',
  wrong_direction: 'Does `learner_response` invert the relation or direction in `reference` (lend vs borrow, cause vs effect, buyer vs seller)?',
  too_vague: 'Does `learner_response` name a broader, more general class than the specific thing `reference` names?',
  spelling: 'Does `learner_response` contain a spelling, typo, or inflection error while otherwise aiming at `reference`?',
  wrong_language: 'Is `learner_response` written in a different language from `reference`?',
}

/**
 * The band midpoint of each gradeable verdict — what `score` is derived from.
 *
 * The LLM grader typed a score and was clamped into its verdict's band when it disagreed. Here the
 * score is the verdict distribution's expectation over these midpoints, then clamped into the
 * winning verdict's band by the validator. So a `different` that was nearly `partial` lands at the
 * top of the `different` band rather than its middle: the within-band grade comes from the
 * model's own uncertainty rather than a second number it could contradict.
 */
function bandMid(v: ShortAnswerVerdict): number {
  const [lo, hi] = SHORT_ANSWER_BANDS[v]
  return (lo + hi) / 2
}

const SCORED_VERDICTS: readonly ShortAnswerVerdict[] = ['equivalent', 'equivalent_with_error', 'partial', 'different']

export function buildShortAnswerJevRequest(input: QuizGradeInput): JevRequest {
  const language = input.crossLingual
    ? 'This card\'s prompt and answer are in different scripts, so answering IN THE LANGUAGE OF `reference` is part'
      + ' of what is being tested: the right meaning in another language is at best "partial".'
    : 'This card\'s prompt and answer share a language, so the language of `learner_response` is not being tested:'
      + ' the right meaning in another language is still "equivalent".'

  const questions: Record<string, JevQuestion> = {
    verdict: {
      type: 'choice',
      instructions: {
        rule: REFERENCE_IS_AUTHORITY,
        language,
        question: 'Compared with `reference`, how well does `learner_response` answer the quiz `question`?',
      },
      criteria: { ...VERDICT_CRITERIA },
    },
  }
  for (const gap of SHORT_ANSWER_GAPS) {
    questions[`gap_${gap}`] = {
      type: 'noul',
      instructions: { rule: REFERENCE_IS_AUTHORITY, question: GAP_QUESTIONS[gap] },
    }
  }
  return { model: JEV_MODEL, state: gradeState(input), questions }
}

/**
 * Turn Jev's answers into the raw shape `validateShortAnswerGrade` accepts.
 *
 * Deliberately NOT a grade: it returns `unknown`-grade material and lets the validator decide, so a
 * malformed Jev response fails the same way a malformed LLM response did — `invalid_result`,
 * refund — instead of this module inventing a default.
 */
export function shortAnswerRawFromJev(answers: Record<string, JevAnswer>): Record<string, unknown> | null {
  const verdict = answers.verdict
  if (!verdict || verdict.type !== 'choice') return null
  if (!(SHORT_ANSWER_VERDICTS as readonly string[]).includes(verdict.choice)) return null

  let mass = 0
  let weighted = 0
  for (const v of SCORED_VERDICTS) {
    const p = verdict.probabilities[v]
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) continue
    mass += p
    weighted += p * bandMid(v)
  }
  // No mass on any scored verdict → no score; the validator falls back to the band midpoint.
  const score = mass > 0 ? weighted / mass : undefined

  const gaps = SHORT_ANSWER_GAPS
    .map((gap) => {
      const a = answers[`gap_${gap}`]
      return { gap, p: a && a.type === 'noul' && Number.isFinite(a.noul) ? a.noul : 0 }
    })
    .filter((g) => g.p >= JEV_GAP_THRESHOLD)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_GAPS_PER_GRADE)
    .map((g) => g.gap)

  return { verdict: verdict.choice, score, gaps, spans: [], confidence: verdict.confidence }
}

// ─── Essay ──────────────────────────────────────────────────────────────────

/** What each aspect asks, in the words `ESSAY_ASPECTS` documents it with. */
const ASPECT_MEANING: Readonly<Record<EssayAspect, string>> = {
  covers_answer: 'The response states what `reference` states.',
  uses_key_terms: 'The response uses the listed terms (or a synonym or translation of them) rather than talking around them.',
  explains_why: 'The response gives the reason or mechanism that `reference` implies.',
  gives_example: 'The response supplies a concrete instance.',
  states_limits: 'The response names a boundary or exception the card mentions.',
  structure: 'The response is organised and finished, rather than a fragment.',
}

const LEVEL_CRITERIA = {
  met: 'The response satisfies this criterion.',
  partial: 'The response partly satisfies this criterion.',
  not_met: 'The response does not satisfy this criterion.',
  unjudgeable: 'It is genuinely impossible to tell for this criterion.',
} as const

const criterionKey = (i: number) => `criterion_${i}`

export function buildEssayJevRequest(input: QuizGradeInput, criteria: readonly EssayCriterion[]): JevRequest {
  const questions: Record<string, JevQuestion> = {}
  criteria.forEach((c, i) => {
    questions[criterionKey(i)] = {
      type: 'choice',
      instructions: {
        rule: REFERENCE_IS_AUTHORITY,
        criterion: {
          requirement: ASPECT_MEANING[c.aspect],
          terms_from_the_card: c.mustMention,
        },
        notes: 'Judge only this `criterion`: do not lower a content criterion for grammar or a structure criterion for'
          + ' content. Length is not a criterion — a short response that satisfies it satisfies it.',
        question: 'Does `learner_response` satisfy `criterion` for the quiz `question`?',
      },
      criteria: { ...LEVEL_CRITERIA },
    }
  })
  return { model: JEV_MODEL, state: gradeState(input), questions }
}

/** The raw shape `validateEssayGrade` accepts. A missing answer is left out → graded "unjudgeable". */
export function essayRawFromJev(
  answers: Record<string, JevAnswer>, criteria: readonly EssayCriterion[],
): Record<string, unknown> {
  const out: Array<{ criterionId: string; level: string; confidence: number }> = []
  criteria.forEach((c, i) => {
    const a = answers[criterionKey(i)]
    if (a && a.type === 'choice') out.push({ criterionId: c.id, level: a.choice, confidence: a.confidence })
  })
  return { criteria: out }
}

// ─── Transport ──────────────────────────────────────────────────────────────

export interface JevCallOptions {
  readonly apiKey: string
  readonly timeoutMs?: number
  /** Backoff before each retry of a 429/529/5xx. The docs ask for backoff, not an immediate retry. */
  readonly retryDelaysMs?: readonly number[]
  readonly fetchImpl?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
}

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529])

/**
 * POST one evaluation. Throws `JEV_<status>` / `JEV_TIMEOUT` / `JEV_BAD_RESPONSE`.
 *
 * A 4xx other than 429 is our bug (bad key, malformed question) and is not retried — retrying it
 * only spends the edge invocation before failing the same way.
 */
export async function callJev(body: JevRequest, opts: JevCallOptions): Promise<JevResponse> {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const delays = opts.retryDelaysMs ?? [1000, 3000]
  let lastError: Error = new Error('JEV_ERROR')

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1])
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000)
    let res: Response
    try {
      res = await doFetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (e) {
      lastError = new Error(controller.signal.aborted ? 'JEV_TIMEOUT' : `JEV_NETWORK:${(e as Error).message}`)
      continue
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      lastError = new Error(`JEV_${res.status}`)
      if (RETRYABLE.has(res.status)) continue
      throw lastError
    }
    const parsed = await res.json().catch(() => null) as Partial<JevResponse> | null
    if (!parsed || typeof parsed !== 'object' || !parsed.answers || typeof parsed.answers !== 'object') {
      throw new Error('JEV_BAD_RESPONSE')
    }
    return {
      model: typeof parsed.model === 'string' ? parsed.model : JEV_MODEL,
      answers: parsed.answers as Record<string, JevAnswer>,
      usage: parsed.usage && typeof parsed.usage.input_tokens === 'number' ? parsed.usage : null,
    }
  }
  throw lastError
}

/**
 * Grade one short answer or essay on Jev.
 *
 * Returns the RAW material for the existing validators plus what the cost ledger needs. The caller
 * runs `validateShortAnswerGrade` / `validateEssayGrade` on `raw` exactly as it did for the LLM.
 */
export async function gradeWithJev(
  quizType: 'short_answer' | 'essay',
  input: QuizGradeInput,
  criteria: readonly EssayCriterion[],
  opts: JevCallOptions,
): Promise<{ raw: Record<string, unknown> | null; model: string; usage: JevResponse['usage'] }> {
  const request = quizType === 'essay'
    ? buildEssayJevRequest(input, criteria)
    : buildShortAnswerJevRequest(input)
  const response = await callJev(request, opts)
  const raw = quizType === 'essay'
    ? essayRawFromJev(response.answers, criteria)
    : shortAnswerRawFromJev(response.answers)
  return { raw, model: response.model, usage: response.usage }
}
