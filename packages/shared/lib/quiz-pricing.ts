/**
 * What a quiz costs, said out loud on the screen where the learner decides.
 *
 * The rule itself is deliberately simple and stays that way: the QUESTIONS are the asset and are
 * paid for once, so retaking a set is free forever; a MODEL CALL AFTER AN ANSWER is fresh every
 * time and is charged every time.
 *
 * Multiple choice buys nothing after an answer. Its mark is decided in SQL on submit, free and
 * final, and its explanation was written with the question — one axis per wrong option, so the
 * one that matches the learner's choice is already on the device (mig 252).
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
 * Multiple choice is a genuinely free retake end to end again: the questions are paid for, the
 * marking is an index compare, and the explanation shipped with the question. Written answers do
 * carry a cost every sitting, and that is the sentence.
 */
export function retakeNoteKey(questionType: string | null | undefined): string {
  return questionType === 'mcq' ? 'pricing.retakeMcq' : 'pricing.retakeWritten'
}

/**
 * How many questions the learner can actually make right now.
 *
 * The reserve is all-or-nothing on purpose: it agrees one price up front and refuses if the
 * wallet cannot cover it (P0002). That is the right shape for a price agreement, but it left the
 * screen saying only "크레딧이 부족해요" over a disabled button — and a learner with five free
 * questions left who asked for ten got NOTHING. Not five. Measured against the real functions:
 * quote for 10 at zero balance reports free 5 / paid 5 / $0.50 / sufficient false, and the
 * reserve raises P0002. The free five were unusable unless the learner happened to pick exactly
 * five.
 *
 * So the screen has to be able to say the number. This is that number, and it is deliberately
 * derived from the QUOTE the server just gave rather than from a second opinion about the
 * learner's balance:
 *
 *   free today  +  trial  +  however many the balance pays for
 *
 * Never more than `asked` — this answers "what can I get of what I wanted", not "what is the
 * most I could buy". Returns `asked` unchanged when the quote already says it is affordable, so
 * a caller can use it without first checking `sufficient`.
 */
export function affordableQuestionCount(
  quote: QuizGenerateQuote & {
    readonly units_each?: number
    readonly unit_price_micro?: number
    readonly balance_micro?: number
    readonly free_items_remaining_today?: number
    readonly trial_remaining?: number
    readonly sufficient?: boolean
  } | null | undefined,
  asked: number,
): number {
  if (!quote) return 0
  if (quote.sufficient) return asked

  const free = Math.max(0, quote.free_items_remaining_today ?? 0)
  // The trial is denominated in UNITS, not questions — a short answer is two units and an essay
  // three, so the same trial buys fewer essays. Dividing by this question's own unit cost is what
  // makes the number true for the type actually chosen.
  const unitsEach = Math.max(1, quote.units_each ?? 1)
  const trial = Math.floor(Math.max(0, quote.trial_remaining ?? 0) / unitsEach)

  const perQuestion = unitsEach * Math.max(0, quote.unit_price_micro ?? 0)
  const paid = perQuestion > 0
    ? Math.floor(Math.max(0, quote.balance_micro ?? 0) / perQuestion)
    : 0

  return Math.max(0, Math.min(asked, free + trial + paid))
}
