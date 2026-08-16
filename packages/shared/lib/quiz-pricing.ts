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

/** What a GENERATION quote carries. `get_ai_quiz_quote` returns all of these since mig 239. */
export interface QuizGenerateQuote {
  readonly count: number
  readonly price_micro: number
  readonly free_items: number
  readonly trial_items: number
  readonly paid_items: number
  readonly free_items_limit: number
  readonly free_items_remaining_today: number
}

/**
 * What making these questions will cost, before the learner presses the button.
 *
 * The setup screen used to say nothing at all unless the wallet was short — so a learner on the
 * free tier could not tell that their first five questions of the day cost nothing, and a learner
 * past it could not tell that the next one did. An allowance nobody can see is not an allowance.
 *
 * Three outcomes, and they are genuinely three:
 *
 *   all free      the whole batch is inside today's allowance (or the one-time trial)
 *   part free     the allowance runs out mid-batch — the commonest case at the boundary, and the
 *                 one a single "무료" or a single price would both misreport
 *   all paid      the allowance is spent, or this tier has none
 *
 * Counted in QUESTIONS, not units: since mig 239 the free allowance is per question whatever its
 * type, and a screen that said "10 units" was reporting an implementation detail the learner
 * cannot count in.
 */
export function generateCostLine(
  quote: QuizGenerateQuote | null | undefined,
): { key: string; params: Record<string, string | number> } | null {
  if (!quote) return null
  const free = Math.max(0, (quote.free_items ?? 0) + (quote.trial_items ?? 0))
  const paid = Math.max(0, quote.paid_items ?? 0)
  const amount = formatUsdMicro(quote.price_micro)

  if (paid <= 0) return { key: 'pricing.genAllFree', params: { free } }
  if (free <= 0) return { key: 'pricing.genAllPaid', params: { paid, amount } }
  return { key: 'pricing.genPartlyFree', params: { free, paid, amount } }
}

/**
 * "무료 3문항 남음" — today's remaining allowance, or null when there is none to speak of.
 *
 * Separate from the cost line because it answers a different question: the cost line is about
 * THIS quiz, this is about the day. Null rather than "0 left" when the tier has no allowance at
 * all, since a tier that never had free questions should not be told it has run out of them.
 */
export function freeLeftLine(
  quote: QuizGenerateQuote | null | undefined,
): { key: string; params: Record<string, number> } | null {
  if (!quote || (quote.free_items_limit ?? 0) <= 0) return null
  return {
    key: 'pricing.genFreeLeft',
    params: {
      left: Math.max(0, quote.free_items_remaining_today ?? 0),
      limit: quote.free_items_limit,
    },
  }
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
