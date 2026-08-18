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
  // 261: 프로덕션 `ai_cost_ledger` 에서 다시 잰 값입니다(실제 계정으로 눌러 본 세 호출).
  remediation: { in: 1168, out: 419, label: '해설 1건' },
  remediationHint: { in: 620, out: 378, label: '힌트 1건' },
  diagnosis: { in: 1348, out: 133, label: '진단 1건' },
  card: { in: 87, out: 136, label: '카드 1장' },
}

/** What each unit is actually sold for, micro-USD. 1 credit = 1,000 micro. */
const PRICE: Record<keyof typeof MEASURED, number> = {
  // 259 가 유닛 단가를 $0.05 → $0.005 로 내리고 유형별로 값을 갈랐습니다. 문항 하나가
  // 유형과 무관하게 $0.10 이었고, 주관식은 객관식의 3분의 1 출력으로 같은 값을 받고
  // 있었습니다.
  quizQuestion: 10_000,   // 객관식 2 units x 5,000
  essayQuestion: 15_000,  // 서술형 3 units
  // 254 brought both gradings down: measured cost is $0.00042 (short) and $0.00032 (essay), and
  // $0.40 an answer was 1,233x — the top of the ladder by four times, on the type learners get
  // the most out of. Essay GENERATION is expensive; essay GRADING is not, because the rubric is
  // already stored with the question and the model only returns a level per criterion.
  gradeShort: 10_000,     // 2 units x 5,000
  gradeEssay: 20_000,     // 4 units
  // 261 이 셋을 사다리 안으로 데려왔습니다. 230 이 값을 열 배로 올린 뒤 원가를 다시 잰 적이
  // 없어서 해설 644배 · 힌트 858배 · 진단 588배로 떠 있었습니다(나머지 사다리는 29~143배).
  remediation: 30_000,       // $0.50 → $0.03,  원가의 39배
  remediationHint: 20_000,   // $0.50 → $0.02,  원가의 34배 — 해설보다 짧은 출력
  diagnosis: 50_000,         // $0.30 → $0.05,  원가의 98배
  card: 10_000,           // fixed price, back to a cent in mig 249
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
