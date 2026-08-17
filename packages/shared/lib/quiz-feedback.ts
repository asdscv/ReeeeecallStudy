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
  // Added with difficulty bands: an EASY item needs a wrong option that is not a near-miss
  // at all, and every other flaw here is one.
  'unrelated',
] as const
export type QuizFlaw = typeof QUIZ_FLAWS[number]

/**
 * What the right option and the learner's option actually differ on.
 *
 * Mirrors `MCQ_EXPLANATION_AXES` in `ai-quiz.ts`. Distinct from `QUIZ_FLAWS` above: a flaw is
 * written when the question is generated and describes what an option IS; an axis is chosen
 * after seeing what the learner picked and names what the DISTINCTION hinges on. The flaw is
 * free and already on screen — the axis is what `grade_mcq` buys.
 */
export const QUIZ_MCQ_AXES = [
  'direction', 'scope', 'condition', 'form', 'component', 'order', 'quantity', 'category',
] as const
export type QuizMcqAxis = typeof QUIZ_MCQ_AXES[number]

/** A pointer into text the client already holds. Never model-authored prose. */
export interface QuizSpanRef {
  readonly from: 'learner' | 'reference'
  readonly start: number
  readonly end: number
}

export interface McqFeedback {
  readonly axis: QuizMcqAxis
  readonly spans: readonly QuizSpanRef[]
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

/**
 * Read a stored `feedback` blob as a multiple-choice explanation, or `null`.
 *
 * Checked before the short-answer reader on screens that try both: a blob with an `axis` has no
 * `verdict`, so the two cannot be confused, but reading in a fixed order keeps that true even if
 * a future payload gains a field.
 */
export function asMcqFeedback(raw: unknown): McqFeedback | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!inSet(QUIZ_MCQ_AXES, r.axis)) return null
  return {
    axis: r.axis,
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
export interface StoredCriterion {
  id: string
  aspect: string
  weight: number
  /**
   * The terms this criterion required, COPIED FROM THE CARD at generation time.
   *
   * The single most useful thing on a failed essay and it was never rendered. A learner saw
   * "핵심을 담았는가 · 미충족" and no way to know that what was missing was `a×(b+c)=a×b+a×c`
   * — which is written down, in their own card, in their own language, and was paid for.
   *
   * Never model prose: the generator is required to copy these from the card's own text and a
   * term that does not appear there is discarded, so showing them cannot invent anything.
   */
  mustMention: string[]
}

export function asStoredRubric(raw: unknown): StoredCriterion[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((c): StoredCriterion[] => {
    if (!c || typeof c !== 'object') return []
    const e = c as Record<string, unknown>
    if (typeof e.id !== 'string' || typeof e.aspect !== 'string') return []
    return [{
      id: e.id,
      aspect: e.aspect,
      weight: typeof e.weight === 'number' ? e.weight : 0,
      mustMention: Array.isArray(e.mustMention)
        ? e.mustMention.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
        : [],
    }]
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
  const [start, end] = snapToWords(text, span.start, span.end)
  return {
    before: text.slice(0, start),
    hit: text.slice(start, end),
    after: text.slice(end),
  }
}

/**
 * Grow a span outward until both ends sit on a word boundary.
 *
 * The offsets are the model's, and they are counted in characters, so they land mid-word often
 * enough to notice: a graded answer highlighted "산들[바람이라는]" — the word 산들바람 cut in
 * half and the highlight running on into the particle. The learner reads a highlight as "this
 * is the bit I got right", and half a word says something the grader did not mean.
 *
 * Whitespace is the only boundary used. Korean and Japanese do not put spaces inside a word, so
 * anything finer would need a tokeniser per language; snapping to the surrounding run of
 * non-space characters is the rule that holds in every script we ship.
 */
function snapToWords(text: string, start: number, end: number): [number, number] {
  const isSpace = (i: number) => /\s/.test(text[i] ?? ' ')
  let s = start
  let e = end
  while (s > 0 && !isSpace(s - 1)) s--
  while (e < text.length && !isSpace(e)) e++
  return [s, e]
}
