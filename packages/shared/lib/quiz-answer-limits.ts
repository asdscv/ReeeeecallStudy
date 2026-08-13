/**
 * How long an answer may be before the server refuses to grade it.
 *
 * The server has always had these bounds — `MAX_LEARNER_CHARS` and `MIN_GRADEABLE_CHARS` in
 * `supabase/functions/_shared/ai-quiz.ts` — and refusing an over-length answer is right: the
 * comment there points out that grading the first 2,000 characters of a 4,000-character essay
 * grades an essay the learner did not write, and charges them for it.
 *
 * What was missing is that the learner was never told. There was no counter, no maxLength and
 * no mention of a limit on either platform. Someone would write two and a half thousand
 * characters, press 채점, and get "이 답안은 채점할 수 없어요. 비어 있거나 너무 길어요." — one
 * sentence covering two opposite problems, after the work was done.
 *
 * Measured against production while testing the cost of long inputs: a 3,000-character essay
 * answer comes back QUIZ_UNGRADEABLE, charged 0. Correct, and invisible until you press.
 *
 * These are a client-side mirror. `quiz-answer-limits.test.ts` reads the server file and fails
 * if they drift — the same guard `quiz-batch-size.test.ts` uses, and for the same reason: the
 * counts and the cap lived in different packages once before with no relationship expressed,
 * and both were individually correct while the feature was broken.
 */

export type GradedQuizType = 'short' | 'essay'

/** Longer than this and the server refuses rather than truncating. */
export const MAX_ANSWER_CHARS: Readonly<Record<GradedQuizType, number>> = {
  short: 300,
  essay: 2000,
}

/** Below this there is nothing to grade, and no model is called — so nothing is charged. */
export const MIN_ANSWER_CHARS: Readonly<Record<GradedQuizType, number>> = {
  short: 1,
  essay: 40,
}

/** How close to the ceiling before the count is worth drawing attention to. */
const WARN_AT = 0.85

export type AnswerLengthState =
  /** Nothing typed yet. Say the limit, not a problem. */
  | 'empty'
  /** Typed, but not yet enough for this type to be gradeable. */
  | 'too_short'
  /** Fine. */
  | 'ok'
  /** Fine, but approaching the ceiling. */
  | 'near_limit'
  /** Over. The server would refuse this. */
  | 'too_long'

export interface AnswerLength {
  readonly state: AnswerLengthState
  readonly count: number
  readonly max: number
  readonly min: number
  /** May this be submitted for grading at all? */
  readonly gradeable: boolean
}

/**
 * What to tell the learner about the length of what they have written.
 *
 * Counts the TRIMMED length, because that is what the server measures — otherwise trailing
 * whitespace makes the counter and the refusal disagree, which is worse than no counter.
 */
export function answerLength(text: string, type: GradedQuizType): AnswerLength {
  const count = (text ?? '').trim().length
  const max = MAX_ANSWER_CHARS[type]
  const min = MIN_ANSWER_CHARS[type]

  const state: AnswerLengthState = count === 0 ? 'empty'
    : count > max ? 'too_long'
      : count < min ? 'too_short'
        : count >= Math.floor(max * WARN_AT) ? 'near_limit'
          : 'ok'

  return { state, count, max, min, gradeable: state === 'ok' || state === 'near_limit' }
}
