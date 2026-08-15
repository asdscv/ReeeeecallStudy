/**
 * What a quiz costs, said out loud on the screen where the learner decides.
 *
 * The rule itself is deliberately simple and stays that way: the QUESTIONS are the asset and are
 * paid for once, so retaking a set is free forever; GRADING is a fresh model call every time and
 * is charged every time. Multiple choice is compared server-side and costs nothing either way.
 *
 * What was missing was the telling. The grade button reads "이 답안 채점" with no price on it —
 * that was a deliberate choice, a button is a decision and not a price tag — but nothing else said
 * anything either, so a learner tapped it with no idea whether it was free. And the retake button
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
 * Three outcomes, because there are three: covered by today's free allowance, covered by the
 * one-time trial, or charged. `price_micro` is the authority on which — the server has already
 * worked out how much of the call the free units cover, and a screen re-deriving that from unit
 * counts would be a second opinion about the learner's own balance.
 *
 * Null when there is no quote yet. A screen saying nothing is better than one guessing, and the
 * button is disabled until the quote lands anyway.
 */
export function gradeCostLine(
  quote: QuizGradeQuote | null | undefined,
): { key: string; params: Record<string, string | number> } | null {
  if (!quote) return null

  if (quote.price_micro <= 0) {
    // How many more are covered, so "free" does not read as "always free". Trial units are
    // counted in because the learner cannot tell them apart and does not need to.
    const left = Math.max(0, (quote.free_remaining_today ?? 0) + (quote.trial_remaining ?? 0))
    return left > 0
      ? { key: 'pricing.gradeFreeLeft', params: { left } }
      : { key: 'pricing.gradeFree', params: {} }
  }

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
