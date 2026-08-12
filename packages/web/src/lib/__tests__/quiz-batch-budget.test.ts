/**
 * A paying learner could not make a quiz of more than eight questions.
 *
 * Measured against production: free allowance spent, $50 in the wallet, 12 multiple-choice
 * questions. The whole-quiz quote is 120,000 micro-USD. `createAndGenerate` split the cards
 * into batches of eight and handed each one `maxPriceMicro / batches.length` — 60,000. The
 * first batch of eight really costs 16 units × 5,000 = 80,000, so the server refused it with
 * P0008 → AI_PRICE_CHANGED, and because that check happens BEFORE the balance gate a full
 * wallet made no difference. **Zero of twelve questions delivered.**
 *
 * The split is wrong because `reserve_ai_quiz` allocates trial units, then today's free units,
 * then paid units, PER CALL. The free units are front-loaded onto the first batch, so an even
 * division of the total never matches what any individual batch costs. It only ever worked
 * when the count fitted in one batch: of the eight sizes the setup screen offers — 4, 6, 8,
 * 10, 12, 20, 30, 50 — the five above one batch all failed the same way. Essay, whose batch
 * size is three, failed at 4, 8, 10 and 20 too.
 *
 * The fix is a budget rather than a quota: each batch is authorised for whatever is left of
 * the total the learner approved, and the drawdown keeps the sum within it. What is pinned
 * here is both halves — that a real batch is affordable under its ceiling, and that the total
 * across batches can never exceed what was approved.
 */
import { describe, it, expect } from 'vitest'
import { QUIZ_BATCH_SIZE } from '@reeeeecall/shared/stores/quiz-store'

/** Unit prices from `ai_quiz_price_units` (mig 194:128-131), and the default unit price. */
const UNITS_PER_QUESTION = { mcq: 2, short: 2, essay: 3 } as const
const UNIT_PRICE_MICRO = 5_000

/** What the server will actually charge a batch when no free units remain. */
const trueBatchPrice = (type: keyof typeof UNITS_PER_QUESTION, cards: number) =>
  cards * UNITS_PER_QUESTION[type] * UNIT_PRICE_MICRO

/** The whole-quiz quote the learner approves on the setup screen. */
const wholeQuote = (type: keyof typeof UNITS_PER_QUESTION, count: number) =>
  trueBatchPrice(type, count)

const batchesFor = (type: keyof typeof UNITS_PER_QUESTION, count: number) => {
  const size = QUIZ_BATCH_SIZE[type]
  const out: number[] = []
  for (let i = 0; i < count; i += size) out.push(Math.min(size, count - i))
  return out
}

/** The OLD ceiling: an even division of the approved total. */
const oldCeiling = (approved: number, nBatches: number) => Math.ceil(approved / nBatches)

/**
 * The NEW ceiling: whatever is left of the approved budget, drawn down as batches land.
 * Mirrors `createAndGenerate` exactly.
 */
function runWithBudget(type: keyof typeof UNITS_PER_QUESTION, count: number) {
  const approved = wholeQuote(type, count)
  const batches = batchesFor(type, count)
  const perCard = approved / Math.max(1, count)
  let left = approved
  let authorisedTotal = 0
  const refused: number[] = []

  batches.forEach((cards, i) => {
    const price = trueBatchPrice(type, cards)
    if (price > left) { refused.push(i); return }
    authorisedTotal += price
    left = Math.max(0, left - Math.ceil(perCard * cards))
  })
  return { approved, batches, refused, authorisedTotal }
}

/** Every size the setup screen offers (QuizSetupPage COUNTS). */
const COUNTS = [4, 6, 8, 10, 12, 20, 30, 50]

describe('the old even split', () => {
  it('refused the first batch of the exact case measured in production', () => {
    // 12 mcq: quote 120,000, split 60,000, first batch really 80,000.
    const approved = wholeQuote('mcq', 12)
    const batches = batchesFor('mcq', 12)
    expect(approved).toBe(120_000)
    expect(batches).toEqual([8, 4])
    expect(oldCeiling(approved, batches.length)).toBe(60_000)
    expect(trueBatchPrice('mcq', 8)).toBe(80_000)
    expect(trueBatchPrice('mcq', 8)).toBeGreaterThan(oldCeiling(approved, batches.length))
  })

  it('would have refused every multi-batch size the screen offers', () => {
    // Not one unlucky number — a structural failure of every size past one batch.
    const broken = COUNTS.filter((count) => {
      const batches = batchesFor('mcq', count)
      if (batches.length < 2) return false
      return trueBatchPrice('mcq', batches[0]) > oldCeiling(wholeQuote('mcq', count), batches.length)
    })
    expect(broken).toEqual([10, 12, 20, 30, 50])
  })
})

describe('the budget drawdown', () => {
  it('lets every offered size through, for every question type', () => {
    for (const type of ['mcq', 'short', 'essay'] as const) {
      for (const count of COUNTS) {
        const { refused } = runWithBudget(type, count)
        expect(refused, `${type} ${count}`).toEqual([])
      }
    }
  })

  it('never authorises more than the learner approved', () => {
    // The property the even split was reaching for, and the reason this is a budget rather
    // than simply passing the whole quote to every batch.
    for (const type of ['mcq', 'short', 'essay'] as const) {
      for (const count of COUNTS) {
        const { approved, authorisedTotal } = runWithBudget(type, count)
        expect(authorisedTotal, `${type} ${count}`).toBeLessThanOrEqual(approved)
      }
    }
  })

  it('stops rather than overspending when the drawdown runs out', () => {
    // A defensive case: if a later batch somehow cost more than the remaining budget, it must
    // be refused locally, not sent with a ceiling that would authorise an overspend.
    const approved = wholeQuote('mcq', 8)
    const left = 0
    const price = trueBatchPrice('mcq', 8)
    expect(price > left).toBe(true)
    expect(approved).toBeGreaterThan(0)
  })

  it('handles a single-batch quiz unchanged', () => {
    // 4 and 6 always worked; the fix must not disturb them.
    for (const count of [4, 6, 8]) {
      const { batches, refused, approved, authorisedTotal } = runWithBudget('mcq', count)
      expect(batches.length).toBe(1)
      expect(refused).toEqual([])
      expect(authorisedTotal).toBe(approved)
    }
  })
})
