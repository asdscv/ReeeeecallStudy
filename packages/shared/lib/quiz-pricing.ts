/**
 * What a quiz costs, said out loud on the screen where the learner decides.
 *
 * The rule itself is deliberately simple and stays that way: the QUESTIONS are the asset and are
 * paid for once, so retaking a set is free forever; GRADING is a fresh model call every time and
 * is charged every time. Multiple choice is compared server-side and costs nothing either way.
 *
 * What was missing was the telling. The grade button reads "이 답안 채점" with no price on it —
 * that was a deliberate choice, a button is a decision and not a price tag — but nothing else said
 * anything either, so a learner tapped it with no idea what it would cost. And the retake button
 * said nothing about the questions being identical, which is the first thing anyone wonders.
 *
 * Both platforms build their copy from here, so the two cannot quietly start explaining the same
 * billing differently.
 */
import { formatUsdMicro } from './ai/server-client'

/** The parts of a quote these lines read. `get_ai_quiz_quote` returns all of them. */
export interface QuizGradeQuote {
  readonly price_micro: number
  readonly free_units: number
  readonly trial_units: number
  readonly free_remaining_today: number
  readonly trial_remaining: number
}

/**
 * What grading this answer will cost, as an i18n key and its params.
 *
 * One outcome, because there is one: grading is charged. `price_micro` is the authority — the
 * server has already worked out what this call costs, and a screen re-deriving that from unit
 * counts would be a second opinion about the learner's own balance.
 *
 * Null when there is no quote yet. A screen saying nothing is better than one guessing, and the
 * button is disabled until the quote lands anyway.
 */
export function gradeCostLine(
  quote: QuizGradeQuote | null | undefined,
): { key: string; params: Record<string, string | number> } | null {
  if (!quote) return null

  // NOTHING, not "무료로 채점돼요".
  //
  // Grading is charged every time now — migration 233 allocates zero free and zero trial units to
  // `grade_*`, so a zero price here is not a free allowance, it is a quote that has not got a
  // price to state. Saying "free" off the back of it would put back on the screen exactly the
  // promise that was removed from the ledger, and it is the sentence the owner asked to be gone.
  if (quote.price_micro <= 0) return null

  // The wallet's own formatter, so a grade and a balance are never denominated differently.
  return { key: 'pricing.gradeCost', params: { amount: formatUsdMicro(quote.price_micro) } }
}

/**
 * What a learner should know before tapping 다시 풀기, for this set's question type.
 *
 * Multiple choice is a genuinely free retake end to end — the questions are already paid for and
 * the grading is a string comparison — so saying "채점만 차감돼요" there would invent a cost that
 * does not exist. Written answers do carry one, every sitting, and that is the sentence.
 */
export function retakeNoteKey(questionType: string | null | undefined): string {
  return questionType === 'mcq' ? 'pricing.retakeMcq' : 'pricing.retakeWritten'
}
