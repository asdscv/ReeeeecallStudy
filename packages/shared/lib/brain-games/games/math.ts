import type { CreateContext } from '../types'
import type { Rng } from '../rng'
import { choiceGame, nearMissOptions } from './choice'
import { pickBand } from './bands'
import {
  MATH_DEEP_FROM,
  MATH_DEEP_KINDS,
  MATH_MAX_LEVEL,
  bandHasTrap,
  bandKind,
  makeProblem,
  mathPar,
  mathRules,
  problemTags,
  problemTokens,
  workedLine,
  type MathKind,
} from './math-bands'

/**
 * Mental arithmetic against the clock. Processing speed and working memory.
 *
 * The level picks a band of the content ladder (math-bands.ts) — real steps, not bigger numbers:
 * from band 2 every problem needs a carry, a borrow, a table or division fact, a missing operand
 * or an order-of-operations step. Most trials come from the player's own band, the three below
 * mixed in for review (bands.ts). Each band has its own clock; the level's fraction tightens it.
 */

/** The deep kinds (from band 26) take turns: never one of the last two trials' kinds while others remain. */
function deepKind(rng: Rng, ctx: Pick<CreateContext, 'recent'>, allowed: readonly MathKind[]): MathKind {
  const recent = new Set(ctx.recent.slice(-2).map((r) => r.carry))
  const fresh = allowed.filter((k) => !recent.has(k))
  return rng.pick(fresh.length > 0 ? fresh : allowed)
}

/** Limit = the band's par × (1.15 − 0.4·frac(L)); the first three bands never under 9 s. */
export function mathLimitMs(band: number, kind: MathKind, level: number): number {
  const frac = level - Math.floor(level)
  const ms = Math.round(mathPar(band, kind) * (1.15 - 0.4 * frac))
  return band <= 3 ? Math.max(9000, ms) : ms
}

export const math = choiceGame(
  'math',
  (level, rng, ctx) => {
    const lv = Number.isFinite(level) ? Math.min(MATH_MAX_LEVEL, Math.max(1, level)) : 1
    const recent = ctx.recent ?? []
    const blocked = (kind: MathKind, band: number) => mathRules(band, kind).some((t) => ctx.blockRules?.includes(t))
    const kindsAt = (band: number) => MATH_DEEP_KINDS.filter((k) => !blocked(k, band))
    const band = pickBand(lv, rng, { trialKind: ctx.trialKind ?? 'counted', recent }, {
      bands: MATH_MAX_LEVEL,
      // A deep band always has a kind without a rule; a band below 26 is one kind.
      isBlocked: (b) => (b < MATH_DEEP_FROM ? blocked(bandKind(b) as MathKind, b) : kindsAt(b).length === 0),
    })
    const kind = band < MATH_DEEP_FROM ? (bandKind(band) as MathKind) : deepKind(rng, { recent }, kindsAt(band))

    // A trap (left to right, brackets ignored) sits on one side of the answer, so where it can go
    // decides where the answer can: draw the answer's position first and build the problem round it.
    const aim = bandHasTrap(band) ? rng.int(0, 3) : null
    const problem = makeProblem(band, kind, rng, aim === 0 ? 'above' : aim === 3 ? 'below' : undefined)
    const errors = [...problem.errors.filter((e) => e.trap), ...rng.shuffle(problem.errors.filter((e) => !e.trap))]
    const tokens = problemTokens(problem)
    // The units column alone must never give the answer away. Not only for adding and subtracting
    // (the plan's case): a product's, a missing operand's or a mixed expression's last digit is a
    // one-digit fact too — measured, 48-62% of bands 19, 20, 22, 23 and 25 could be answered from
    // the last digit alone. So whenever the problem is more than one single-digit fact (a number
    // on screen has two digits, or there are two or more operations) and the answer is 20 or more,
    // two distractors end in the answer's units digit. Single-digit facts (bands 4 and 6) keep
    // their neighbouring-fact distractors: there the last digit is the whole fact.
    const ops = tokens.filter((t) => t === '+' || t === '−' || t === '×' || t === '÷').length
    const multiFact = ops >= 2 || tokens.some((t) => typeof t === 'number' && t >= 10)
    const opts = { sameUnits: multiFact && problem.answer >= 20 }
    let choice = nearMissOptions(problem.answer, errors, rng, opts)
    for (let i = 0; aim !== null && choice.correctIndex !== aim && i < 40; i++) choice = nearMissOptions(problem.answer, errors, rng, opts)

    const text = tokens.join(' ')
    return {
      prompt: { key: 'play.solve' },
      stimulus: { text, tokens },
      options: choice.options.map((v) => ({ text: String(v), value: v })),
      correctIndex: choice.correctIndex,
      limitMs: mathLimitMs(band, kind, lv),
      picked: null,
      timedOut: false,
      sig: `ma:${text}`,
      tags: problemTags(problem),
      reveal: workedLine(problem),
      info: { kind: `b${band}`, carry: kind },
    }
  },
  { maxLevel: MATH_MAX_LEVEL },
)
