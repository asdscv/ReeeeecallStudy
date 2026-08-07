// ─── The closed sets a quiz grade is rendered from ──────────────────────────
//
// `supabase/functions/_shared/ai-quiz.ts` is import-free by design — it is what gets
// deployed to the edge runtime — so the clients cannot import its enums. These are the same
// lists, restated for rendering, and `quiz-feedback-labels.test.ts` asserts both that they
// still match the edge copy AND that every member has a translated string in all eight
// locales on both platforms.
//
// That second check is the point. A screen renders these with a COMPUTED key —
// `t(\`verdict.${grade.verdict}\`)` — and the i18n usage gate only sees static literals, so a
// member with no string would render as the raw identifier in every language and no test
// would notice. That is exactly how `today.error.*` shipped missing from all eight bundles.

/** How a short answer compares to the card's own answer. */
export const QUIZ_VERDICTS = [
  'equivalent', 'equivalent_with_error', 'partial', 'different', 'empty', 'unjudgeable',
] as const
export type QuizVerdict = typeof QUIZ_VERDICTS[number]

/** What was missing or wrong about it. Never more than a handful are returned. */
export const QUIZ_GAPS = [
  'missing_part', 'extra_claim', 'wrong_direction', 'too_vague', 'spelling', 'wrong_language',
] as const
export type QuizGap = typeof QUIZ_GAPS[number]

/** Whether one essay criterion was satisfied. */
export const QUIZ_LEVELS = ['met', 'partial', 'not_met', 'unjudgeable'] as const
export type QuizLevel = typeof QUIZ_LEVELS[number]

/** What an essay criterion is about. */
export const QUIZ_ASPECTS = [
  'covers_answer', 'uses_key_terms', 'explains_why', 'gives_example', 'states_limits', 'structure',
] as const
export type QuizAspect = typeof QUIZ_ASPECTS[number]

/** Why a multiple-choice option was wrong. Rendered only after the learner has answered. */
export const QUIZ_FLAWS = [
  'opposite', 'adjacent_sense', 'right_category_wrong_item', 'partial', 'overgeneral',
  'plausible_form',
] as const
export type QuizFlaw = typeof QUIZ_FLAWS[number]

/** A pointer into text the client already holds. Never model-authored prose. */
export interface QuizSpanRef {
  readonly from: 'learner' | 'reference'
  readonly start: number
  readonly end: number
}

export interface ShortAnswerFeedback {
  readonly verdict: QuizVerdict
  readonly score: number
  readonly gaps: readonly QuizGap[]
  readonly spans: readonly QuizSpanRef[]
}

export interface EssayCriterionFeedback {
  readonly criterionId: string
  readonly level: QuizLevel
  readonly span: QuizSpanRef | null
}

export interface EssayFeedback {
  readonly score: number
  readonly criteria: readonly EssayCriterionFeedback[]
  readonly unjudgeableWeight: number
}

const inSet = <T extends readonly string[]>(set: T, v: unknown): v is T[number] =>
  typeof v === 'string' && (set as readonly string[]).includes(v)

/**
 * Read a stored `feedback` blob as short-answer feedback, or `null`.
 *
 * Defensive because the blob is whatever the grader wrote at the time: a row graded by an older
 * evaluator version, or by an essay grader, must render as "no detail" rather than crash a
 * result screen the learner has already paid for.
 */
export function asShortAnswerFeedback(raw: unknown): ShortAnswerFeedback | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!inSet(QUIZ_VERDICTS, r.verdict)) return null
  return {
    verdict: r.verdict,
    score: typeof r.score === 'number' ? r.score : 0,
    gaps: Array.isArray(r.gaps) ? r.gaps.filter((g): g is QuizGap => inSet(QUIZ_GAPS, g)) : [],
    spans: Array.isArray(r.spans) ? r.spans.filter(isSpan) : [],
  }
}

/** Read a stored `feedback` blob as essay feedback, or `null`. */
export function asEssayFeedback(raw: unknown): EssayFeedback | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.criteria)) return null
  const criteria = r.criteria.flatMap((c): EssayCriterionFeedback[] => {
    if (!c || typeof c !== 'object') return []
    const e = c as Record<string, unknown>
    if (typeof e.criterionId !== 'string' || !inSet(QUIZ_LEVELS, e.level)) return []
    return [{ criterionId: e.criterionId, level: e.level, span: isSpan(e.span) ? e.span : null }]
  })
  if (criteria.length === 0) return null
  return {
    score: typeof r.score === 'number' ? r.score : 0,
    criteria,
    unjudgeableWeight: typeof r.unjudgeableWeight === 'number' ? r.unjudgeableWeight : 0,
  }
}

function isSpan(v: unknown): v is QuizSpanRef {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return (s.from === 'learner' || s.from === 'reference')
    && typeof s.start === 'number' && typeof s.end === 'number'
    && Number.isInteger(s.start) && Number.isInteger(s.end) && s.end > s.start
}

/** The rubric as it was stored with the question, for naming each criterion on screen. */
export interface StoredCriterion { id: string; aspect: string; weight: number }

export function asStoredRubric(raw: unknown): StoredCriterion[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((c): StoredCriterion[] => {
    if (!c || typeof c !== 'object') return []
    const e = c as Record<string, unknown>
    if (typeof e.id !== 'string' || typeof e.aspect !== 'string') return []
    return [{ id: e.id, aspect: e.aspect, weight: typeof e.weight === 'number' ? e.weight : 0 }]
  })
}

/**
 * Split text into the piece a span points at and the pieces either side.
 *
 * Returns three strings so a screen can highlight the middle one. Out-of-range offsets fall
 * back to "no highlight" rather than throwing — the grade is still worth showing.
 */
export function splitBySpan(text: string, span: QuizSpanRef | null | undefined): {
  before: string; hit: string; after: string
} {
  if (!span || span.start < 0 || span.end > text.length || span.end <= span.start) {
    return { before: text, hit: '', after: '' }
  }
  return {
    before: text.slice(0, span.start),
    hit: text.slice(span.start, span.end),
    after: text.slice(span.end),
  }
}
