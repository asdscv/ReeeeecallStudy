/**
 * Did I get it right, and how am I doing — the two questions a quiz has to answer plainly.
 *
 * Neither was answered. After submitting, the screen showed the grader's explanation and no
 * verdict, so the owner's report was not "it marks me wrong" but "나는 맞췄다는 걸 알기가
 * 힘들다" — the app never says so. And the result screen printed a percentage whose comment
 * claims it is "over what was GRADED" while the arithmetic divides by `score_max`, the total
 * question count: answer six, pay to grade one, get it right, and the run reads 17%.
 *
 * A ratio cannot be honest here, because a quiz has THREE outcomes and a ratio has two. An
 * ungraded answer is not a wrong answer — the learner declined to pay, or the type is graded
 * for free and hasn't been — and folding it into either half of a fraction states something
 * false. So this returns counts and lets the screen say all three.
 */

/** One item's outcome. `ungraded` is a real state, not a missing value. */
export type QuizItemOutcome = 'correct' | 'partial' | 'wrong' | 'ungraded' | 'unanswered'

/** At or above this a score reads as "you got it". Matches the grader's own KNOWN band. */
export const CORRECT_AT = 0.75
/** Below `CORRECT_AT` and at or above this, the learner had most of it. */
export const PARTIAL_AT = 0.4

export interface QuizItemLike {
  readonly score?: number | null
  readonly answered?: boolean | null
  readonly status?: string | null
}

/**
 * What happened to one item.
 *
 * A null score after answering means nobody has judged it — for short answer and essay that is
 * the un-paid-for state, and saying "wrong" there would charge the learner a mark for declining
 * to spend.
 */
export function itemOutcome(item: QuizItemLike): QuizItemOutcome {
  const answered = item.answered === true || item.status === 'answered' || item.status === 'graded'
  if (!answered) return 'unanswered'
  const score = item.score
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'ungraded'
  if (score >= CORRECT_AT) return 'correct'
  if (score >= PARTIAL_AT) return 'partial'
  return 'wrong'
}

export interface QuizTally {
  readonly correct: number
  readonly partial: number
  readonly wrong: number
  readonly ungraded: number
  readonly unanswered: number
  /** Everything that has been judged — the only honest denominator for a ratio. */
  readonly judged: number
  readonly total: number
}

/** The running state of a run, countable at any point. */
export function tallyQuiz(items: readonly QuizItemLike[]): QuizTally {
  const t = { correct: 0, partial: 0, wrong: 0, ungraded: 0, unanswered: 0 }
  for (const item of items) t[itemOutcome(item)] += 1
  return { ...t, judged: t.correct + t.partial + t.wrong, total: items.length }
}

/**
 * The i18n key for a running summary line, and the numbers it needs.
 *
 * Three shapes rather than one sentence with zeroes in it: "3 맞음 · 0 틀림 · 0 채점 안 함" is
 * noise, and a learner mid-run reads the shortest true thing fastest.
 */
export function tallyLine(t: QuizTally): { key: string; params: Record<string, number> } {
  if (t.ungraded > 0) {
    return {
      key: 'run.tally.withUngraded',
      params: { correct: t.correct, wrong: t.wrong + t.partial, ungraded: t.ungraded },
    }
  }
  if (t.judged === 0) return { key: 'run.tally.none', params: { total: t.total } }
  return { key: 'run.tally.plain', params: { correct: t.correct, wrong: t.wrong + t.partial } }
}

/**
 * The fewest quizzable cards a multiple-choice set needs, for one difficulty band.
 *
 * Both setup screens hardcoded `4`, with the comment "multiple choice needs three other cards to
 * draw plausible distractors from". That is true of the EASIEST band and of nothing else. A model
 * will not write a deliberately unrelated wrong answer — asked for wrong options for
 * `lend → 빌려주다` it returns 빌리다, 갚다, 임대하다 at every phrasing — so the FAR slots are
 * filled from other answers in the deck, and how many far slots there are is what the band says:
 *
 *     level 1   near_max 0   all three distractors far   -> 3 deck-mates, so 4 cards
 *     level 2   near_max 1   two far                     -> 2 deck-mates, so 3 cards
 *     level 3   near_max 3   as few as zero far          -> the card alone, so 1
 *
 * At the hardest band the model writes every distractor, and a six-card deck was being refused
 * for deck-mates it did not need. The number also stops being a literal: `option_count` is a
 * column, so a band showing six options asks for six and the screens follow without an edit.
 */
export function minCardsForMcq(
  band: { near_max?: number | null; option_count?: number | null } | null | undefined,
): number {
  const options = Math.min(6, Math.max(2, band?.option_count ?? 4))
  const distractors = options - 1
  const far = Math.max(0, distractors - Math.max(0, band?.near_max ?? 0))
  // The card being asked about, plus one deck-mate per far slot.
  return 1 + far
}
