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
  // 카드 한도(`CARD_MAX_CHARS`)와 같은 숫자입니다. 4,000자짜리 카드에 대한 답이 2,000자에서
  // 잘리면 학습자가 납득할 수 있는 규칙이 아닙니다. 원가로도 막을 이유가 없습니다 —
  // 4,000자 채점이 $0.000879 로 값의 114분의 1입니다(측정값은 서버 상수 주석에).
  essay: 4000,
}

/**
 * Below this there is nothing to grade, and no model is called — so nothing is charged.
 *
 * ONE character for both. Essay used to demand 40, which was us deciding what counts as an
 * answer; it is not our call. The learner writes what they write and the rubric grades it — a
 * three-word answer scores badly, which is information, and no length rule is needed to produce
 * that verdict. Mirrors `MIN_GRADEABLE_CHARS` in `supabase/functions/_shared/ai-quiz.ts`, where
 * the header records what the old floor actually did to people who wrote short true answers.
 */
export const MIN_ANSWER_CHARS: Readonly<Record<GradedQuizType, number>> = {
  short: 1,
  essay: 1,
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

  // `too_short` 는 이제 도달할 수 없는 상태입니다. 두 유형 모두 하한이 1이고, 0은 위에서
  // `empty` 로 잡힙니다. 타입에는 남겨 둡니다 — 하한이 다시 생길 수 있고, 그때 이 한 줄이
  // 다시 살아나는 편이 화면 쪽 분기를 되살리는 것보다 낫습니다.
  const state: AnswerLengthState = count === 0 ? 'empty'
    : count > max ? 'too_long'
      : count < min ? 'too_short'
        : count >= Math.floor(max * WARN_AT) ? 'near_limit'
          : 'ok'

  return { state, count, max, min, gradeable: state === 'ok' || state === 'near_limit' }
}
