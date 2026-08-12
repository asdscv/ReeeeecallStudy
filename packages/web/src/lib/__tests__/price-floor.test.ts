/**
 * No action may be sold below ten times what the most expensive model in the chain costs to
 * serve it.
 *
 * This is the rule that makes "we can change the price whenever we like" safe. The price itself
 * is a business decision and this file does not have an opinion on it; what it refuses is a
 * price that a model swap, a fallback, or a provider price rise could put underwater — which is
 * exactly the failure this codebase has already produced twice in one day: a model added to the
 * chain with no price row billed 43x, and a "successor in the same tier" turned out to cost 2.5x
 * and 3.75x more than the model it replaced.
 *
 * ## Why the MOST EXPENSIVE model
 *
 * A fixed price cannot move when the model does. If the price only covers the cheapest model in
 * the chain, then every fallback sells at a loss — and a fallback is exactly what happens when
 * things are already going wrong. Pricing against the worst member makes any other member pure
 * upside, and makes "what if we change the model" a question with no downside.
 *
 * ## Why ten
 *
 * Built from measurements, not convention: measured worst/typical token spread up to 2x, the
 * spread between the cheapest and dearest model in the chain ~3x, a retry allowance of 1.25x,
 * and headroom for a provider price rise ~1.5x. 2 x 3 x 1.25 x 1.5 = 11.25, floored at 10.
 *
 * Every real price is far above this floor — the quiz sells a question for 10 credits against a
 * floor of 2. That is correct and intended: the floor says where you may not go, and ARPU says
 * where you should be.
 */
import { describe, it, expect } from 'vitest'
import { PROVIDERS } from '../../../../../supabase/functions/_shared/ai-providers.ts'

/** Rates from `ai_pricing_config`, micro-USD per million tokens, verified 2026-08-12. */
const RATE: Record<string, { in: number; out: number }> = {
  'gemini-3.1-flash-lite': { in: 250_000, out: 1_500_000 },
  'gemini-flash-lite-latest': { in: 250_000, out: 1_500_000 },
  'gemini-2.5-flash': { in: 300_000, out: 2_500_000 },
}

/**
 * Measured tokens per BILLABLE UNIT, from the production cost ledger.
 * Not per call: a quiz generation call makes up to 8 questions and is sold per question.
 */
const MEASURED: Record<string, { in: number; out: number; label: string }> = {
  quizQuestion: { in: 143, out: 62, label: '퀴즈 문항 1개' },
  essayQuestion: { in: 353, out: 180, label: '서술형 문항 1개' },
  gradeShort: { in: 816, out: 42, label: '단답 채점 1건' },
  gradeEssay: { in: 945, out: 242, label: '서술형 채점 1건' },
  remediation: { in: 977, out: 292, label: '설명 1건' },
  card: { in: 87, out: 136, label: '카드 1장' },
}

/** What each unit is actually sold for, micro-USD. 1 credit = 1,000 micro. */
const PRICE: Record<keyof typeof MEASURED, number> = {
  quizQuestion: 10_000,   // 2 units x quiz_unit_price_micro
  essayQuestion: 15_000,  // 3 units
  gradeShort: 10_000,     // 2 units
  gradeEssay: 40_000,     // 8 units
  remediation: 50_000,    // fixed price (was cost-following)
  card: 10_000,           // fixed price (was cost-following)
}

const FLOOR_MULTIPLE = 10

/** The dearest model anywhere in either chain — what a fixed price has to survive. */
function dearest(): { model: string; in: number; out: number } {
  const g = PROVIDERS.gemini
  const all = [g.textModel, g.visionModel, ...(g.textFallbacks ?? []), ...(g.visionFallbacks ?? [])]
  let worst = { model: '', in: 0, out: 0 }
  for (const m of all) {
    const r = RATE[m]
    if (!r) continue
    // Compare on a 2:1 input:output blend, roughly our measured shape.
    if (r.in * 2 + r.out > worst.in * 2 + worst.out) worst = { model: m, ...r }
  }
  return worst
}

const costOn = (u: { in: number; out: number }, m: { in: number; out: number }) =>
  (u.in * m.in + u.out * m.out) / 1_000_000

describe('the price floor', () => {
  it('knows which model is the expensive one', () => {
    // If this stops being a model we have a rate for, every assertion below is vacuous.
    const worst = dearest()
    expect(worst.model).toBeTruthy()
    expect(RATE[worst.model]).toBeDefined()
  })

  it('sells nothing below ten times the dearest model', () => {
    const worst = dearest()
    for (const key of Object.keys(MEASURED) as (keyof typeof MEASURED)[]) {
      const floor = costOn(MEASURED[key], worst) * FLOOR_MULTIPLE
      expect(PRICE[key], `${MEASURED[key].label} — floor ${Math.round(floor)} on ${worst.model}`)
        .toBeGreaterThanOrEqual(floor)
    }
  })

  it('survives the worst measured tokens on the dearest model, even so', () => {
    // The floor is built on TYPICAL tokens. This is the separate question: does the price still
    // cover a call that hits its measured maximum? The output caps exist to keep this true.
    const worst = dearest()
    const MAX: Partial<Record<keyof typeof MEASURED, { in: number; out: number }>> = {
      quizQuestion: { in: 190, out: 143 },
      gradeShort: { in: 822, out: 62 },
      gradeEssay: { in: 1000, out: 300 },
      remediation: { in: 1058, out: 466 },
      card: { in: 159, out: 672 },
    }
    for (const [key, tokens] of Object.entries(MAX) as [keyof typeof MEASURED, { in: number; out: number }][]) {
      const cost = costOn(tokens, worst)
      expect(PRICE[key], `${MEASURED[key].label} worst-case cost ${Math.round(cost)}`)
        .toBeGreaterThan(cost)
    }
  })

  it('is a floor, not a target — real prices sit well above it', () => {
    // Stated as an assertion so that someone "optimising" a price down to the floor has to
    // delete this test rather than merely satisfy the one above. Cost is under 1% of any
    // defensible retail price here; the floor is a guard rail, not a pricing model.
    const worst = dearest()
    for (const key of Object.keys(MEASURED) as (keyof typeof MEASURED)[]) {
      const ratio = PRICE[key] / costOn(MEASURED[key], worst)
      expect(ratio, `${MEASURED[key].label} is only ${ratio.toFixed(1)}x cost`)
        .toBeGreaterThan(FLOOR_MULTIPLE)
    }
  })
})
