import type { Rng } from '../rng'

/**
 * Number Pattern's content ladder (GAMES_DIFFICULTY_PLAN §3.2): the rule families rows are built
 * from, and the readings that keep every row to one answer.
 *
 * A row is one to three interleaved lines (line r holds terms r, r + L, r + 2L, …), each following
 * one family. Bands 1–20 bring in a family each (some bands two of one kind: triangular numbers
 * beside growing steps, ×k − c beside ×k + c, primes beside the mixed lines, products of the two
 * before beside the three before added, digit sums beside the cycle, prime gaps beside the gaps
 * added — owner 2026-11-13 «더 다양한 규칙»); band 21 moves the gap inside the row; from 22 two
 * families are interleaved (22–23 from bands 4–12, 24–25 from 9–16 and 26–29 from 13–20, the gap
 * anywhere; 28–29 show the fewest terms that still settle both lines), and 30–31, the top, put one
 * of the newest families (primes, products, digit sums, prime gaps) under a second hard line.
 *
 * Readings are every rule a player might see in a row: each ladder family, "repeat the last
 * difference" and "repeat the last ratio", on the whole row or on its lines read every other or
 * every third term. A reading counts once the shown terms over-determine it — more shown terms
 * than it has free parameters (a cycle of steps: every step seen twice) — so it has been checked
 * at least once, not just fitted. A row is kept only when every reading that counts gives the same
 * gap value, and at least one does.
 */

export type SeriesOp = '+' | '−' | '×' | '÷'
/** How one term of a line becomes the next: an operation, or ×k then ± c (doublePlus). */
export type SeriesStep = { op: SeriesOp; v: number } | { op: '×±'; k: number; c: number }

export interface SeriesLine {
  terms: number[]
  /** steps[i] takes terms[i] to terms[i + 1]. */
  steps: SeriesStep[]
  /** The worked line for term i when its step alone does not say it ("7 + 11 = 18"). */
  worked?: (i: number) => string | undefined
}

export type SeriesFamilyId =
  | 'up'
  | 'up2'
  | 'down'
  | 'geo'
  | 'alt'
  | 'grow'
  | 'triple'
  | 'halve'
  | 'inter'
  | 'fib'
  | 'dbl'
  | 'altOps'
  | 'mixed'
  | 'growF'
  | 'trib'
  | 'three'
  | 'diffGrow'
  | 'cycle'
  | 'diffLines'
  | 'diffFib'
  | 'square'
  | 'cube'
  | 'tri'
  | 'altMinus'
  | 'prime'
  | 'product'
  | 'digitSum'
  | 'diffPrime'

export interface SeriesFamily {
  id: SeriesFamilyId
  /** The band (level) that brings it in. */
  band: number
  /** Its mechanics tag (mechanics.ts); the first two bands are plain counting and have none. */
  tag?: string
  /** Free parameters a player reads off the row: a row shows at least this + 2 terms. */
  params: number
  /** Interleaved lines in one row of this family. */
  lines: 1 | 2 | 3
  /** Largest term: 999, or 9999 where the line multiplies (geometric tails). */
  max: number
  /** Terms in the band's own row, the gap included. */
  length(rng: Rng): number
  /** The family's line(s), `len` terms in all — null when the draw fell out of range (draw again). */
  make(rng: Rng, len: number, level: number): SeriesLine[] | null
}

// ── Building lines ──────────────────────────────────────────────────────────────────────────

const ADD_MAX = 999
const MUL_MAX = 9999

export function applyStep(t: number, s: SeriesStep): number {
  switch (s.op) {
    case '+':
      return t + s.v
    case '−':
      return t - s.v
    case '×':
      return t * s.v
    case '÷':
      return t / s.v
    case '×±':
      return t * s.k + s.c
  }
}

/** The label between a term and the next of its line: '+3', '×2', '×2−1'. */
export function stepLabel(s: SeriesStep): string {
  if (s.op === '×±') return s.c >= 0 ? `×${s.k}+${s.c}` : `×${s.k}−${-s.c}`
  return `${s.op}${s.v}`
}

const additive = (terms: readonly number[]): SeriesStep[] =>
  terms.slice(1).map((t, i) => (t >= terms[i] ? { op: '+' as const, v: t - terms[i] } : { op: '−' as const, v: terms[i] - t }))

function fromSteps(start: number, steps: readonly SeriesStep[]): number[] {
  const terms = [start]
  for (const s of steps) terms.push(applyStep(terms[terms.length - 1], s))
  return terms
}

function fromDiffs(start: number, diffs: readonly number[]): number[] {
  const terms = [start]
  for (const d of diffs) terms.push(terms[terms.length - 1] + d)
  return terms
}

const inRange = (terms: readonly number[], max: number) => terms.every((t) => Number.isInteger(t) && t >= 0 && t <= max)

function lineOf(terms: number[], steps: SeriesStep[] = additive(terms), worked?: SeriesLine['worked']): SeriesLine {
  return worked ? { terms, steps, worked } : { terms, steps }
}

/** A line, or null when a term falls out of range. */
const checked = (line: SeriesLine, max: number): SeriesLine | null => (inRange(line.terms, max) ? line : null)

const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const signed = (rng: Rng, lo: number, hi: number) => rng.int(lo, hi) * (rng.chance(0.5) ? 1 : -1)

/** An arithmetic line of n terms with step d, its start drawn from [lo, hi] and lifted so a falling line stays ≥ 1. */
const arithLine = (rng: Rng, lo: number, hi: number, d: number, n: number): SeriesLine => {
  const s = rng.int(lo, hi) + (d < 0 ? -d * (n - 1) : 0)
  return lineOf(range(n).map((i) => s + d * i))
}

/** Lengths of L interleaved lines that share `len` terms (the first lines take the extra ones). */
export const lineLengths = (len: number, L: number): number[] => range(L).map((r) => Math.ceil((len - r) / L))

/** Shifts a line built from 0 so its smallest term is 1–20. */
const lifted = (rng: Rng, raw: readonly number[]): number[] => {
  const s = -Math.min(...raw) + rng.int(1, 20)
  return raw.map((t) => t + s)
}

/** "a + b = c"-style worked lines for a sum of the `lag` terms before (Fibonacci, the three before). */
function sumWorked(lag: number): (terms: readonly number[]) => (i: number) => string {
  return (terms) => (i) => {
    if (i >= lag) return `${terms.slice(i - lag, i).join(' + ')} = ${terms[i]}`
    // Before the first full window: the window's sum less the others.
    const others = range(lag).filter((j) => j !== i).map((j) => terms[j])
    return `${terms[lag]} − ${others.join(' − ')} = ${terms[i]}`
  }
}

/** The primes below 1000 (a sieve) and each one's place among them. */
export const PRIMES: readonly number[] = (() => {
  const composite = new Uint8Array(1000)
  const out: number[] = []
  for (let n = 2; n < 1000; n++) {
    if (composite[n]) continue
    out.push(n)
    for (let m = n * n; m < 1000; m += n) composite[m] = 1
  }
  return out
})()
const PRIME_AT: ReadonlyMap<number, number> = new Map(PRIMES.map((p, i) => [p, i]))

/** A whole number's digits, most significant first (0 → [0]). */
const digitsOf = (n: number): number[] => String(Math.abs(Math.trunc(n))).split('').map(Number)
/** The sum of a whole number's digits. */
export const digitSum = (n: number): number => digitsOf(n).reduce((a, d) => a + d, 0)

const powerWorked = (e: number, n0: number, k: number) => (terms: readonly number[]) => (i: number) =>
  `${Array.from({ length: e }, () => String(n0 + i)).join(' × ')}${k > 0 ? ` + ${k}` : k < 0 ? ` − ${-k}` : ''} = ${terms[i]}`

// ── The families ────────────────────────────────────────────────────────────────────────────

const FAMILY_LIST: readonly SeriesFamily[] = [
  {
    id: 'up',
    band: 1,
    params: 2,
    lines: 1,
    max: ADD_MAX,
    length: () => 5,
    make: (rng, len) => [arithLine(rng, 1, 20, rng.int(1, 3), len)],
  },
  {
    id: 'up2',
    band: 2,
    params: 2,
    lines: 1,
    max: ADD_MAX,
    length: () => 5,
    make: (rng, len) => [arithLine(rng, 10, 99, rng.int(4, 12), len)],
  },
  {
    id: 'down',
    band: 3,
    tag: 'series.descending',
    params: 2,
    lines: 1,
    max: ADD_MAX,
    length: () => 5,
    make: (rng, len) => {
      const line = checked(arithLine(rng, 2, 40, -rng.int(3, 12), len), ADD_MAX)
      return line && [line]
    },
  },
  {
    id: 'geo',
    band: 4,
    tag: 'series.geometric',
    params: 2,
    lines: 1,
    max: MUL_MAX,
    length: (rng) => rng.int(5, 6),
    make: (rng, len) => {
      const sMax = Math.min(30, Math.floor(MUL_MAX / 2 ** (len - 1)))
      if (sMax < 1) return null
      const steps = range(len - 1).map(() => ({ op: '×' as const, v: 2 }))
      return [lineOf(fromSteps(rng.int(1, sMax), steps), steps)]
    },
  },
  {
    id: 'alt',
    band: 5,
    tag: 'series.alternating',
    params: 3,
    lines: 1,
    max: ADD_MAX,
    length: () => 6,
    make: (rng, len) => {
      const a = rng.int(3, 9)
      const b = rng.pick(range(8).map((i) => i + 1).filter((x) => x !== a))
      const upFirst = rng.chance(0.6)
      const raw = fromDiffs(0, range(len - 1).map((i) => ((i % 2 === 0) === upFirst ? a : -b)))
      const line = checked(lineOf(lifted(rng, raw)), ADD_MAX)
      return line && [line]
    },
  },
  {
    id: 'grow',
    band: 6,
    tag: 'series.growing',
    params: 3,
    lines: 1,
    max: ADD_MAX,
    length: () => 6,
    make: (rng, len) => {
      const step0 = rng.int(1, 6)
      const inc = rng.int(1, 2)
      const line = checked(lineOf(fromDiffs(rng.int(1, 20), range(len - 1).map((i) => step0 + inc * i))), ADD_MAX)
      return line && [line]
    },
  },
  {
    // Triangular numbers n(n + 1)/2 — 1, 3, 6, 10, 15 — the step growing by one: read as growing
    // steps (the same rule), drawn so the classic row turns up as itself.
    id: 'tri',
    band: 6,
    tag: 'series.growing',
    params: 3,
    lines: 1,
    max: ADD_MAX,
    length: () => 6,
    make: (rng, len) => {
      const n0 = rng.int(1, 10)
      return [lineOf(range(len).map((i) => ((n0 + i) * (n0 + i + 1)) / 2))]
    },
  },
  {
    id: 'triple',
    band: 7,
    tag: 'series.halving',
    params: 2,
    lines: 1,
    max: MUL_MAX,
    length: (rng) => rng.int(5, 6),
    make: (rng, len) => {
      const sMax = Math.min(30, Math.floor(MUL_MAX / 3 ** (len - 1)))
      if (sMax < 1) return null
      const steps = range(len - 1).map(() => ({ op: '×' as const, v: 3 }))
      return [lineOf(fromSteps(rng.int(1, sMax), steps), steps)]
    },
  },
  {
    id: 'halve',
    band: 7,
    tag: 'series.halving',
    params: 2,
    lines: 1,
    max: MUL_MAX,
    length: (rng) => rng.int(5, 6),
    make: (rng, len) => {
      // An odd number times 2^k with k ≥ len − 1, so every half is whole.
      const k = len - 1 + rng.int(0, 2)
      const oMax = Math.min(15, Math.floor(MUL_MAX / 2 ** k))
      if (oMax < 1) return null
      const o = 2 * rng.int(0, Math.floor((oMax - 1) / 2)) + 1
      const steps = range(len - 1).map(() => ({ op: '÷' as const, v: 2 }))
      return [lineOf(fromSteps(o * 2 ** k, steps), steps)]
    },
  },
  {
    id: 'inter',
    band: 8,
    tag: 'series.interleaved',
    params: 4,
    lines: 2,
    max: ADD_MAX,
    length: () => 7,
    make: (rng, len) => {
      const [la, lb] = lineLengths(len, 2)
      const da = signed(rng, 1, 9)
      const db = rng.pick(range(18).map((i) => (i < 9 ? i + 1 : 8 - i)).filter((d) => d !== da))
      return [arithLine(rng, 1, 20, da, la), arithLine(rng, 10, 60, db, lb)]
    },
  },
  {
    id: 'fib',
    band: 9,
    tag: 'series.fibonacci',
    params: 2,
    lines: 1,
    max: ADD_MAX,
    length: (rng) => rng.int(5, 6),
    make: (rng, len) => {
      const terms = [rng.int(1, 15), rng.int(1, 15)]
      while (terms.length < len) terms.push(terms[terms.length - 1] + terms[terms.length - 2])
      const line = checked(lineOf(terms, additive(terms), sumWorked(2)(terms)), ADD_MAX)
      return line && [line]
    },
  },
  {
    id: 'dbl',
    band: 10,
    tag: 'series.doublePlus',
    params: 3,
    lines: 1,
    max: MUL_MAX,
    length: () => 6,
    make: (rng, len, level) => {
      // ×2 ± c; from L16 (inside the interleaved bands) the factor grows to 3–4.
      const k = level >= 16 ? rng.int(3, 4) : 2
      const c = rng.pick([-3, -2, -1, 1, 2, 3, 4, 5])
      // Start above −c, so every row rises.
      const step = { op: '×±' as const, k, c }
      const steps = range(len - 1).map(() => step)
      const line = checked(lineOf(fromSteps(rng.int(Math.max(1, 1 - c), 9), steps), steps), MUL_MAX)
      return line && [line]
    },
  },
  {
    id: 'altOps',
    band: 11,
    tag: 'series.altOps',
    params: 3,
    lines: 1,
    max: MUL_MAX,
    length: () => 6,
    make: (rng, len, level) => {
      const mul = { op: '×' as const, v: level >= 16 ? rng.pick([2, 3]) : 2 }
      const add = { op: '+' as const, v: rng.int(2, 9) }
      const mulFirst = rng.chance(0.5)
      const steps = range(len - 1).map((i) => ((i % 2 === 0) === mulFirst ? mul : add))
      const line = checked(lineOf(fromSteps(rng.int(1, 9), steps), steps), MUL_MAX)
      return line && [line]
    },
  },
  {
    // Mixed signs: multiply, then take away (×2, −3, ×2, −3 …) — up and down in one row, rising
    // overall. Read as two steps taking turns, like altOps.
    id: 'altMinus',
    band: 11,
    tag: 'series.altOps',
    params: 3,
    lines: 1,
    max: MUL_MAX,
    length: () => 6,
    make: (rng, len, level) => {
      const mul = { op: '×' as const, v: level >= 16 ? rng.pick([2, 3]) : 2 }
      const c = rng.int(1, 9)
      const sub = { op: '−' as const, v: c }
      const mulFirst = rng.chance(0.5)
      const steps = range(len - 1).map((i) => ((i % 2 === 0) === mulFirst ? mul : sub))
      // What the subtraction leaves stays above c, so every pair of steps rises: from c + 1 when the
      // row multiplies first, 2c + 1 when it takes away first.
      const start = rng.int(0, 8) + (mulFirst ? c + 1 : 2 * c + 1)
      const line = checked(lineOf(fromSteps(start, steps), steps), MUL_MAX)
      return line && [line]
    },
  },
  {
    id: 'mixed',
    band: 12,
    tag: 'series.mixedLines',
    params: 4,
    lines: 2,
    max: MUL_MAX,
    length: () => 7,
    make: (rng, len) => {
      const [la, lb] = lineLengths(len, 2)
      const geoFirst = rng.chance(0.5)
      const gLen = geoFirst ? la : lb
      const r = rng.int(2, 3)
      const sMax = Math.min(10, Math.floor(ADD_MAX / r ** (gLen - 1)))
      if (sMax < 1) return null
      const steps = range(gLen - 1).map(() => ({ op: '×' as const, v: r }))
      const geo = lineOf(fromSteps(rng.int(1, sMax), steps), steps)
      const arith = arithLine(rng, 20, 90, signed(rng, 2, 9), geoFirst ? lb : la)
      return geoFirst ? [geo, arith] : [arith, geo]
    },
  },
  {
    // Consecutive primes from 2 … 41. Its rule is no step, so the reveal names it (a prompt, no
    // worked line). Two parameters on the reading side: one prime alone fits by chance.
    id: 'prime',
    band: 12,
    tag: 'series.primes',
    params: 2,
    lines: 1,
    max: ADD_MAX,
    length: (rng) => rng.int(5, 6),
    make: (rng, len) => {
      const j0 = rng.int(0, 12)
      return [lineOf(PRIMES.slice(j0, j0 + len), undefined, () => undefined)]
    },
  },
  {
    id: 'growF',
    band: 13,
    tag: 'series.growFactor',
    params: 2,
    lines: 1,
    max: MUL_MAX,
    length: (rng) => rng.int(5, 6),
    make: (rng, len) => {
      // The first factor 2–4 (a smaller one when a big one would run past four digits).
      for (let m = rng.int(2, 4); m >= 2; m--) {
        const factors = range(len - 1).map((i) => m + i)
        const sMax = Math.min(20, Math.floor(MUL_MAX / factors.reduce((a, b) => a * b, 1)))
        if (sMax < 1) continue
        const steps = factors.map((v) => ({ op: '×' as const, v }))
        return [lineOf(fromSteps(rng.int(1, sMax), steps), steps)]
      }
      return null
    },
  },
  {
    id: 'trib',
    band: 14,
    tag: 'series.tribonacci',
    params: 3,
    lines: 1,
    max: ADD_MAX,
    length: (rng) => rng.int(6, 7),
    make: (rng, len) => {
      const terms = [rng.int(1, 9), rng.int(1, 9), rng.int(1, 9)]
      while (terms.length < len) terms.push(terms[terms.length - 1] + terms[terms.length - 2] + terms[terms.length - 3])
      const line = checked(lineOf(terms, additive(terms), sumWorked(3)(terms)), ADD_MAX)
      return line && [line]
    },
  },
  {
    // Each term the two before multiplied: 2, 3, 6, 18, 108. Between tiles the step is "× the term
    // two back" (the first step, before any product, as a difference).
    id: 'product',
    band: 14,
    tag: 'series.product',
    params: 2,
    lines: 1,
    max: MUL_MAX,
    length: (rng) => rng.int(5, 6),
    make: (rng, len) => {
      const terms = [rng.int(2, 5), rng.int(2, 6)]
      while (terms.length < len) terms.push(terms[terms.length - 1] * terms[terms.length - 2])
      const steps: SeriesStep[] = range(len - 1).map((i) => (i === 0 ? additive(terms.slice(0, 2))[0] : { op: '×' as const, v: terms[i - 1] }))
      const worked = (i: number) =>
        i >= 2 ? `${terms[i - 2]} × ${terms[i - 1]} = ${terms[i]}` : i === 1 ? `${terms[2]} ÷ ${terms[0]} = ${terms[1]}` : `${terms[2]} ÷ ${terms[1]} = ${terms[0]}`
      const line = checked(lineOf(terms, steps, worked), MUL_MAX)
      return line && [line]
    },
  },
  {
    id: 'three',
    band: 15,
    tag: 'series.threeLines',
    params: 6,
    lines: 3,
    max: ADD_MAX,
    length: () => 9,
    make: (rng, len) => {
      const steps = rng.sample(range(18).map((i) => (i < 9 ? i + 1 : 8 - i)), 3)
      return lineLengths(len, 3).map((n, r) => arithLine(rng, r === 0 ? 1 : 5, r === 2 ? 60 : 30, steps[r], n))
    },
  },
  {
    id: 'diffGrow',
    band: 16,
    tag: 'series.diffGrowing',
    params: 4,
    lines: 1,
    max: ADD_MAX,
    length: () => 7,
    make: (rng, len) => {
      const d0 = rng.int(1, 5)
      const e0 = rng.int(1, 3)
      const f = rng.int(1, 2)
      const line = checked(lineOf(fromDiffs(rng.int(1, 20), range(len - 1).map((i) => d0 + e0 * i + (f * i * (i - 1)) / 2))), ADD_MAX)
      return line && [line]
    },
  },
  {
    id: 'cycle',
    band: 17,
    tag: 'series.opCycle',
    // Three steps, each an operation and a number, and the start: shown so every step of the
    // cycle is seen twice (eight terms with the gap).
    params: 5,
    lines: 1,
    max: MUL_MAX,
    length: () => 8,
    make: (rng, len) => {
      const plus = (): SeriesStep => ({ op: '+', v: rng.int(2, 9) })
      const minus = (): SeriesStep => ({ op: '−', v: rng.int(1, 5) })
      const times = (): SeriesStep => ({ op: '×', v: rng.int(2, 3) })
      // At least one multiplication and one addition or subtraction in every cycle.
      const third = rng.pick([plus, minus, times])()
      const cycle = rng.shuffle([times(), rng.chance(0.5) ? plus() : minus(), third])
      const steps = range(len - 1).map((i) => cycle[i % 3])
      const terms = fromSteps(rng.int(1, 9), steps)
      if (terms.some((t) => t < 1)) return null
      const line = checked(lineOf(terms, steps), MUL_MAX)
      return line && [line]
    },
  },
  {
    // Each term the one before plus its own digits: 47 → 47 + 4 + 7 = 58. From two digits (a single
    // digit doubles), with at least three different steps so no simpler rule stands in for it.
    id: 'digitSum',
    band: 17,
    tag: 'series.digitSum',
    params: 2,
    lines: 1,
    max: ADD_MAX,
    length: (rng) => rng.int(5, 6),
    make: (rng, len) => {
      const terms = [rng.int(10, 79)]
      while (terms.length < len) terms.push(terms[terms.length - 1] + digitSum(terms[terms.length - 1]))
      if (new Set(diffsOf(terms)).size < 3) return null
      const worked = (i: number) =>
        i >= 1 ? `${terms[i - 1]} + ${digitsOf(terms[i - 1]).join(' + ')} = ${terms[i]}` : `${terms[1]} − ${digitsOf(terms[0]).join(' − ')} = ${terms[0]}`
      const line = checked(lineOf(terms, additive(terms), worked), ADD_MAX)
      return line && [line]
    },
  },
  {
    id: 'diffLines',
    band: 18,
    tag: 'series.diffLines',
    params: 5,
    lines: 1,
    max: ADD_MAX,
    length: () => 8,
    make: (rng, len) => {
      // The gaps make two interleaved lines, a0 + αj and b0 + βj, with α + β ≠ 0 (else every other
      // term would form a plain arithmetic line) and α ≠ β.
      const a0 = rng.int(1, 6)
      const alpha = rng.int(1, 3)
      const b0 = rng.pick([-6, -5, -4, -3, -2, -1, 1, 2, 3, 4])
      const beta = rng.pick([-3, -2, -1, 1, 2].filter((b) => b !== alpha && b !== -alpha))
      const diffs = range(len - 1).map((i) => (i % 2 === 0 ? a0 + alpha * (i / 2) : b0 + beta * ((i - 1) / 2)))
      const line = checked(lineOf(lifted(rng, fromDiffs(0, diffs))), ADD_MAX)
      return line && [line]
    },
  },
  {
    id: 'diffFib',
    band: 19,
    tag: 'series.diffFib',
    params: 3,
    lines: 1,
    max: ADD_MAX,
    length: (rng) => rng.int(6, 7),
    make: (rng, len) => {
      const diffs = [rng.int(1, 5), rng.int(1, 5)]
      while (diffs.length < len - 1) diffs.push(diffs[diffs.length - 1] + diffs[diffs.length - 2])
      const line = checked(lineOf(fromDiffs(rng.int(1, 20), diffs.slice(0, len - 1))), ADD_MAX)
      return line && [line]
    },
  },
  {
    // The gaps are consecutive primes (+2, +3, +5, +7, +11 … or from a later prime): nested — the
    // rule lives one level down, in the gaps.
    id: 'diffPrime',
    band: 19,
    tag: 'series.diffPrimes',
    params: 3,
    lines: 1,
    max: ADD_MAX,
    length: (rng) => rng.int(6, 7),
    make: (rng, len) => {
      const j0 = rng.int(0, 4)
      const line = checked(lineOf(fromDiffs(rng.int(1, 20), PRIMES.slice(j0, j0 + len - 1))), ADD_MAX)
      return line && [line]
    },
  },
  {
    id: 'square',
    band: 20,
    tag: 'series.squares',
    params: 2,
    lines: 1,
    max: ADD_MAX,
    length: () => 5,
    make: (rng, len) => {
      const nMax = Math.min(12, Math.floor(Math.sqrt(ADD_MAX - 5)) - (len - 1))
      if (nMax < 1) return null
      const n0 = rng.int(1, nMax)
      const k = rng.int(-3, 5)
      const terms = range(len).map((i) => (n0 + i) ** 2 + k)
      const line = checked(lineOf(terms, additive(terms), powerWorked(2, n0, k)(terms)), ADD_MAX)
      return line && [line]
    },
  },
  {
    id: 'cube',
    band: 20,
    tag: 'series.cubes',
    params: 2,
    lines: 1,
    max: ADD_MAX,
    length: () => 5,
    make: (rng, len) => {
      const nMax = Math.min(5, Math.floor(Math.cbrt(ADD_MAX - 5)) - (len - 1))
      if (nMax < 1) return null
      const n0 = rng.int(1, nMax)
      const k = rng.int(-3, 5)
      const terms = range(len).map((i) => (n0 + i) ** 3 + k)
      const line = checked(lineOf(terms, additive(terms), powerWorked(3, n0, k)(terms)), ADD_MAX)
      return line && [line]
    },
  },
]

export const SERIES_FAMILIES: Readonly<Record<SeriesFamilyId, SeriesFamily>> = Object.fromEntries(FAMILY_LIST.map((f) => [f.id, f])) as Record<
  SeriesFamilyId,
  SeriesFamily
>

export const isSeriesFamily = (x: string): x is SeriesFamilyId => x in SERIES_FAMILIES

const familiesOfBand = (band: number) => FAMILY_LIST.filter((f) => f.band === band)

// ── Readings ────────────────────────────────────────────────────────────────────────────────

/** A row as shown: exactly one `null`, the gap. */
export type SeriesRow = readonly (number | null)[]
type Seq = readonly number[]

/** One rule on one line of terms. */
interface Single {
  id: string
  /** The shown terms (a `null` gap, or none in a complete line) check this rule at least once. */
  counts(row: SeriesRow): boolean
  /** Gap values under which it explains every shown term. */
  solve(row: SeriesRow, gap: number): number[]
  /** A complete line follows it. */
  fits(seq: Seq): boolean
}

/** Free parameters p: n shown terms check the rule n − p times. */
const byParams =
  (p: number) =>
  (row: SeriesRow): boolean =>
    row.filter((v) => v !== null).length - p >= 1

/** A gap value as a whole number (division leaves float noise), or NaN. */
function whole(c: number): number {
  const r = Math.round(c)
  return Number.isFinite(c) && Math.abs(c - r) < 1e-6 ? r + 0 : Number.NaN
}

/** A homogeneous linear recurrence Σ coeffs[j]·t[i+j] = 0 — its gap value has a closed form. */
function linear(id: string, coeffs: readonly number[]): Single {
  const span = coeffs.length - 1
  return {
    id,
    counts: byParams(span),
    fits(seq) {
      if (seq.length <= span) return false
      for (let i = 0; i + span < seq.length; i++) {
        let sum = 0
        for (let j = 0; j <= span; j++) sum += coeffs[j] * seq[i + j]
        if (sum !== 0) return false
      }
      return true
    },
    solve(row, gap) {
      let sol: number | null = null
      for (let i = 0; i + span < row.length; i++) {
        let sum = 0
        let cg = 0
        for (let j = 0; j <= span; j++) {
          if (i + j === gap) cg = coeffs[j]
          else sum += coeffs[j] * (row[i + j] as number)
        }
        if (cg === 0) {
          if (sum !== 0) return []
          continue
        }
        if (sum % cg !== 0) return []
        const c = -sum / cg + 0
        if (sol === null) sol = c
        else if (sol !== c) return []
      }
      return sol === null || sol < 0 ? [] : [sol]
    },
  }
}

/** Every-other (or every-third) form of a linear rule: the same relation on each interleaved line. */
const strided = (coeffs: readonly number[], s: number) => coeffs.flatMap((c, j) => (j === 0 ? [c] : [...Array<number>(s - 1).fill(0), c]))

/** A rule with no closed form: candidate gap values from local guesses, each checked on the whole line. */
function guessed(id: string, counts: Single['counts'], fits: (seq: Seq) => boolean, guesses: (row: SeriesRow, gap: number) => number[]): Single {
  return {
    id,
    counts,
    fits,
    solve(row, gap) {
      const out: number[] = []
      for (const raw of guesses(row, gap)) {
        const c = whole(raw)
        if (!(c >= 0) || out.includes(c)) continue
        if (fits(row.map((v, i) => (i === gap ? c : (v as number))))) out.push(c)
      }
      return out
    },
  }
}

const shown = (row: SeriesRow, i: number): boolean => i >= 0 && i < row.length && row[i] !== null
/** Consecutive pairs (i, i+1) with both terms shown. */
const pairs = (row: SeriesRow) => range(Math.max(0, row.length - 1)).filter((i) => shown(row, i) && shown(row, i + 1))
const at = (row: SeriesRow, i: number) => row[i] as number
const diffsOf = (seq: Seq) => seq.slice(1).map((t, i) => t - seq[i])

/** Ratios a person reads as a step: ×2 … ×5, halves, thirds. */
const NICE = [2, 3, 4, 5, 1 / 2, 1 / 3]
const isNice = (q: number) => NICE.some((x) => Math.abs(x - q) < 1e-9)

/** The gap from its left neighbour times q, or its right neighbour over q. */
function viaRatio(row: SeriesRow, gap: number, q: number): number[] {
  const out: number[] = []
  if (shown(row, gap - 1)) out.push(at(row, gap - 1) * q)
  if (shown(row, gap + 1) && q !== 0) out.push(at(row, gap + 1) / q)
  return out
}

/** Constant ratio — "repeat the last ratio" (any ratio, halves included). */
const geometric = guessed(
  'geometric',
  byParams(2),
  (seq) => seq.length >= 2 && seq.every((t) => t !== 0) && seq.every((t, i) => i < 2 || t * seq[0] === seq[i - 1] * seq[1]),
  (row, gap) => pairs(row).filter((i) => at(row, i) !== 0).flatMap((i) => viaRatio(row, gap, at(row, i + 1) / at(row, i))),
)

/** t[i+1] = k·t[i] + c — the gaps grow by a constant ratio (doublePlus, and any ×k ± c). */
const affine = guessed(
  'affine',
  byParams(3),
  (seq) => {
    if (seq.length < 3) return false
    const d = diffsOf(seq)
    if (d[0] === 0) return d.every((x) => x === 0)
    return d.every((x, i) => i < 2 || x * d[0] === d[i - 1] * d[1])
  },
  (row, gap) => {
    const ks = new Set<number>([1, -1, -2, ...NICE])
    for (const i of pairs(row)) if (shown(row, i + 2) && at(row, i + 1) !== at(row, i)) ks.add((at(row, i + 2) - at(row, i + 1)) / (at(row, i + 1) - at(row, i)))
    const out: number[] = []
    for (const k of ks) {
      if (shown(row, gap - 1) && shown(row, gap - 2)) out.push(at(row, gap - 1) + k * (at(row, gap - 1) - at(row, gap - 2)))
      if (shown(row, gap + 1) && shown(row, gap + 2) && k !== 0) out.push(at(row, gap + 1) - (at(row, gap + 2) - at(row, gap + 1)) / k)
    }
    return out
  },
)

/** Steps that repeat with period P, each one adding a constant or multiplying by a nice ratio (altOps, opCycle, alternating). */
function opsCycle(P: number): Single {
  const classFits = (steps: [number, number][]) =>
    steps.length === 0 ||
    steps.every(([a, b]) => b - a === steps[0][1] - steps[0][0]) ||
    (steps.every(([a]) => a !== 0) && isNice(steps[0][1] / steps[0][0]) && steps.every(([a, b]) => b * steps[0][0] === a * steps[0][1]))
  return guessed(
    `ops${P}`,
    // Each step of the cycle is checked on its own: two shown steps of every kind. (One alone could
    // be read as adding or multiplying — 14 → 28 is +14 as much as ×2.)
    (row) => range(P).every((r) => pairs(row).filter((i) => i % P === r).length >= 2),
    (seq) => range(P).every((r) => classFits(range(seq.length - 1).filter((i) => i % P === r).map((i) => [seq[i], seq[i + 1]] as [number, number]))),
    (row, gap) => {
      const out: number[] = []
      // The step into the gap, from the other steps of its class; and the step out of it.
      const known = (r: number) => pairs(row).filter((i) => i % P === r)
      if (gap >= 1) {
        for (const i of known((gap - 1) % P)) {
          out.push(at(row, gap - 1) + at(row, i + 1) - at(row, i))
          if (at(row, i) !== 0) out.push(at(row, gap - 1) * (at(row, i + 1) / at(row, i)))
        }
      }
      if (gap + 1 < row.length) {
        for (const i of known(gap % P)) {
          out.push(at(row, gap + 1) - (at(row, i + 1) - at(row, i)))
          if (at(row, i + 1) !== 0) out.push(at(row, gap + 1) / (at(row, i + 1) / at(row, i)))
        }
      }
      return out
    },
  )
}

/** Ratios that themselves change by a constant: ×2, ×3, ×4 … (growing factor). */
const growFactor = guessed(
  'growFactor',
  byParams(3),
  (seq) => {
    if (seq.length < 3 || seq.some((t) => t === 0)) return false
    const r = seq.slice(1).map((t, i) => t / seq[i])
    return r.every((x, i) => i < 2 || Math.abs(x - r[i - 1] - (r[1] - r[0])) < 1e-9)
  },
  (row, gap) => {
    const known = pairs(row).filter((i) => at(row, i) !== 0).map((i) => ({ i, r: at(row, i + 1) / at(row, i) }))
    if (known.length === 0) return []
    const first = known[0]
    const slopes = new Set<number>([1, -1, 0])
    for (const k of known.slice(1)) slopes.add((k.r - first.r) / (k.i - first.i))
    const out: number[] = []
    for (const s of slopes) {
      const ratio = (i: number) => first.r + s * (i - first.i)
      if (shown(row, gap - 1)) out.push(at(row, gap - 1) * ratio(gap - 1))
      if (shown(row, gap + 1) && ratio(gap) !== 0) out.push(at(row, gap + 1) / ratio(gap))
    }
    return out
  },
)

/** (n + i)^e + k: squares or cubes, shifted. */
function power(e: number): Single {
  const N = 40
  const fits = (seq: Seq) => range(N + 1).some((n0) => seq.every((t, i) => t - (n0 + i) ** e === seq[0] - n0 ** e))
  return {
    id: e === 2 ? 'squares' : 'cubes',
    counts: byParams(2),
    fits,
    solve(row, gap) {
      const first = row.findIndex((v) => v !== null)
      const out: number[] = []
      for (let n0 = 0; n0 <= N; n0++) {
        const k = at(row, first) - (n0 + first) ** e
        if (row.every((v, i) => v === null || v - (n0 + i) ** e === k)) {
          const c = (n0 + gap) ** e + k
          if (c >= 0 && !out.includes(c)) out.push(c)
        }
      }
      return out
    },
  }
}

/**
 * Consecutive primes. Counted from three shown terms (two primes side by side fit by chance — 2, 3
 * or 5, 7 in any counting row); primes below 1000 only, the most a player could name.
 */
const primes = guessed(
  'primes',
  byParams(2),
  (seq) => seq.length >= 2 && seq.every((t, i) => PRIME_AT.has(t) && (i === 0 || PRIME_AT.get(t) === (PRIME_AT.get(seq[i - 1]) as number) + 1)),
  (row, gap) => {
    const out: number[] = []
    const left = shown(row, gap - 1) ? PRIME_AT.get(at(row, gap - 1)) : undefined
    const right = shown(row, gap + 1) ? PRIME_AT.get(at(row, gap + 1)) : undefined
    if (left !== undefined && left + 1 < PRIMES.length) out.push(PRIMES[left + 1])
    if (right !== undefined && right >= 1) out.push(PRIMES[right - 1])
    return out
  },
)

/** t[i+1] = t[i] + its digits. Counted from three shown terms, like primes. */
const digitStep = guessed(
  'digitSum',
  byParams(2),
  (seq) => seq.length >= 2 && seq.every((t, i) => i === 0 || (Number.isInteger(seq[i - 1]) && seq[i - 1] >= 0 && t === seq[i - 1] + digitSum(seq[i - 1]))),
  (row, gap) => {
    const out: number[] = []
    if (shown(row, gap - 1)) out.push(at(row, gap - 1) + digitSum(at(row, gap - 1)))
    if (shown(row, gap + 1)) {
      // Every c with c + digits(c) = the term after (a four-digit number's digits add to ≤ 36).
      const r = at(row, gap + 1)
      for (let c = Math.max(0, r - 37); c < r; c++) if (c + digitSum(c) === r) out.push(c)
    }
    return out
  },
)

/** t[i+2] = t[i] · t[i+1]: each term the two before multiplied. */
const product = guessed(
  'product',
  byParams(2),
  (seq) => seq.length >= 3 && seq.every((t, i) => i < 2 || t === seq[i - 2] * seq[i - 1]),
  (row, gap) => {
    const out: number[] = []
    if (shown(row, gap - 2) && shown(row, gap - 1)) out.push(at(row, gap - 2) * at(row, gap - 1))
    if (shown(row, gap - 1) && shown(row, gap + 1) && at(row, gap - 1) !== 0) out.push(at(row, gap + 1) / at(row, gap - 1))
    if (shown(row, gap + 1) && shown(row, gap + 2) && at(row, gap + 1) !== 0) out.push(at(row, gap + 2) / at(row, gap + 1))
    return out
  },
)

/** The gaps are consecutive primes. Counted once two gap-to-gap steps are shown (four terms). */
const diffPrimes = guessed(
  'diffPrimes',
  byParams(3),
  (seq) => {
    if (seq.length < 3) return false
    const d = diffsOf(seq)
    const j0 = PRIME_AT.get(d[0])
    return j0 !== undefined && d.every((x, i) => PRIMES[j0 + i] === x)
  },
  (row, gap) => {
    const out: number[] = []
    for (const i of pairs(row)) {
      const j = PRIME_AT.get(at(row, i + 1) - at(row, i))
      // The prime the first gap would be, if this gap is the (i+1)-th.
      const j0 = j === undefined ? -1 : j - i
      if (j0 < 0) continue
      if (shown(row, gap - 1) && j0 + gap - 1 < PRIMES.length) out.push(at(row, gap - 1) + PRIMES[j0 + gap - 1])
      if (shown(row, gap + 1) && j0 + gap < PRIMES.length) out.push(at(row, gap + 1) - PRIMES[j0 + gap])
    }
    return out
  },
)

/** Rules a single line can follow. Arithmetic and geometric double as "repeat the last difference / ratio". */
const SINGLES: readonly Single[] = [
  linear('arithmetic', [1, -2, 1]),
  geometric,
  linear('growingStep', [-1, 3, -3, 1]),
  linear('cubic', [1, -4, 6, -4, 1]),
  linear('fibonacci', [-1, -1, 1]),
  linear('tribonacci', [-1, -1, -1, 1]),
  // t[i+3] = 2·t[i+2] − t[i]: each gap is the two gaps before added.
  linear('diffFib', [1, 0, -2, 1]),
  // The gaps in two interleaved arithmetic lines.
  linear('diffLines', [-1, 1, 2, -2, -1, 1]),
  affine,
  opsCycle(2),
  opsCycle(3),
  growFactor,
  power(2),
  power(3),
  primes,
  digitStep,
  product,
  diffPrimes,
]

/** A reading of a whole row. */
interface Reader {
  id: string
  /** Gap values it gives, once it counts (checked at least once by the shown terms). */
  predict(row: SeriesRow): number[]
  /** It counts and explains the row with this gap value filled in. */
  explains(seq: Seq, gap: number): boolean
}

const withGap = (seq: Seq, gap: number): SeriesRow => seq.map((v, i) => (i === gap ? null : v))

const wholeRow = (s: Single): Reader => ({
  id: s.id,
  predict: (row) => (s.counts(row) ? s.solve(row, row.indexOf(null)) : []),
  explains: (seq, gap) => s.counts(withGap(seq, gap)) && s.fits(seq),
})

const split = <T,>(row: readonly T[], L: number): T[][] => range(L).map((r) => row.filter((_, i) => i % L === r))

/**
 * Read every L-th term: each line follows its own rule, each checked on its own line (different
 * families interleaved). The gap's line gives the value; every other line must fit some rule.
 */
function interleaved(L: number): Reader {
  const others = (lines: Seq[], gl: number) => lines.every((line, r) => r === gl || SINGLES.some((s) => s.counts(line) && s.fits(line)))
  return {
    id: `lines${L}`,
    predict(row) {
      const gap = row.indexOf(null)
      if (row.length < 2 * L + 1) return []
      const lines = split(row, L)
      const gl = gap % L
      if (!others(lines as Seq[], gl)) return []
      const out = new Set<number>()
      for (const s of SINGLES) if (s.counts(lines[gl])) for (const c of s.solve(lines[gl], Math.floor(gap / L))) out.add(c)
      return [...out]
    },
    explains(seq, gap) {
      if (seq.length < 2 * L + 1) return false
      const lines = split(seq, L)
      const gl = gap % L
      const gapLine = withGap(lines[gl], Math.floor(gap / L))
      return others(lines, gl) && SINGLES.some((s) => s.counts(gapLine) && s.fits(lines[gl]))
    },
  }
}

const READERS: readonly Reader[] = [
  ...SINGLES.map(wholeRow),
  // The same rule on every interleaved line (two or three arithmetic lines).
  wholeRow(linear('arithmetic×2', strided([1, -2, 1], 2))),
  wholeRow(linear('arithmetic×3', strided([1, -2, 1], 3))),
  interleaved(2),
  interleaved(3),
]

/** Every gap value some reading that counts gives this row (ascending). */
export function seriesReadings(row: SeriesRow): number[] {
  const out = new Set<number>()
  for (const r of READERS) for (const c of r.predict(row)) out.add(c)
  return [...out].sort((a, b) => a - b)
}

/** The readings that count and explain the row with `value` in the gap. */
export function seriesExplainedBy(row: SeriesRow, value: number): string[] {
  const gap = row.indexOf(null)
  const seq = row.map((v) => v ?? value)
  return READERS.filter((r) => r.explains(seq, gap)).map((r) => r.id)
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────────

export interface SeriesRowSpec {
  families: SeriesFamilyId[]
  lines: SeriesLine[]
  /** Every term, the hidden one included (line r holds terms r, r + L, …). */
  terms: number[]
  gap: number
  answer: number
}

/** Where each interleaved band draws its two families from (the bands that bring them in). */
const PAIR_POOL: Readonly<Record<number, readonly number[]>> = {
  // Single-line families only: one already interleaved (8, 12, 15) would make three or four lines,
  // and a cycle of three steps (17) or two lines of gaps (18) under a second line is past reading.
  22: [4, 5, 6, 7, 9, 10, 11],
  24: [9, 10, 11, 13, 14, 16],
  26: [13, 14, 16, 19, 20],
  28: [13, 14, 16, 19, 20],
}
/** The top band (30–31): one of these families under a second line from TOP_SECOND. */
export const SERIES_TOP_BAND = 30
export const SERIES_TOP_FIRST: readonly SeriesFamilyId[] = ['prime', 'product', 'digitSum', 'diffPrime']
const TOP_SECOND: readonly number[] = [13, 14, 16, 19, 20]
/**
 * Band 21 hides a term of a family from bands 9–20 (the example in the plan is squares). Not the
 * ×3 / halving rows of band 7: there "repeat the ratio" is the whole rule, inside the row or not.
 */
const MISSING_POOL = FAMILY_LIST.filter((f) => f.band >= 9 && f.band <= 20).map((f) => f.id)

export const SERIES_MISSING_FROM = 21
/** Bands whose gap may sit anywhere (when series.missingTerm is not blocked). */
export const GAP_ANYWHERE: ReadonlySet<number> = new Set([21, 24, 26, 28, SERIES_TOP_BAND])

function pickAvoiding<T>(rng: Rng, items: readonly T[], avoid: (x: T) => boolean): T {
  const fresh = items.filter((x) => !avoid(x))
  return rng.pick(fresh.length > 0 ? fresh : items)
}

/**
 * The family (or the two, in row order) a trial of this band uses — never a family of the last
 * trial when another will do (a family by the band that brings it: ×3 and halving are one).
 */
function drawFamilies(band: number, rng: Rng, avoid: ReadonlySet<SeriesFamilyId>): SeriesFamilyId[] {
  const avoidBands = new Set([...avoid].map((f) => SERIES_FAMILIES[f].band))
  if (band < SERIES_MISSING_FROM) return [pickAvoiding(rng, familiesOfBand(band), (f) => avoid.has(f.id)).id]
  if (band === SERIES_MISSING_FROM) return [pickAvoiding(rng, MISSING_POOL, (f) => avoidBands.has(SERIES_FAMILIES[f].band))]
  if (band >= SERIES_TOP_BAND) {
    const first = pickAvoiding(rng, SERIES_TOP_FIRST, (f) => avoidBands.has(SERIES_FAMILIES[f].band))
    const second = pickAvoiding(
      rng,
      TOP_SECOND.filter((b) => b !== SERIES_FAMILIES[first].band),
      (b) => avoidBands.has(b),
    )
    return rng.shuffle([first, rng.pick(familiesOfBand(second)).id])
  }
  const pool = PAIR_POOL[band] ?? PAIR_POOL[22]
  const first = pickAvoiding(rng, pool, (b) => avoidBands.has(b))
  const second = pickAvoiding(
    rng,
    pool.filter((b) => b !== first),
    (b) => avoidBands.has(b),
  )
  return rng.shuffle([first, second]).map((b) => rng.pick(familiesOfBand(b)).id)
}

/** Interleaves lines: line r at positions r, r + L, … */
export function interleave(lines: readonly SeriesLine[]): number[] {
  const L = lines.length
  const n = lines.reduce((a, l) => a + l.terms.length, 0)
  return range(n).map((i) => lines[i % L].terms[Math.floor(i / L)])
}

/** Tries before giving up on a band's draw (each is far more likely to succeed than not). */
const TRIES = 200
/**
 * Tries on one draw of families before drawing again — so a family whose rows are rejected more
 * often (growing steps beside triangular numbers) still comes up as often as it is drawn.
 */
const TRIES_PER_DRAW = 25

/**
 * One row of this band: its families drawn, built, the gap placed (at the end unless `gapInside`),
 * and kept only when the readings agree on exactly the answer and, from band 4, the naive guesses
 * miss it. Bounded: if every try fails — it never has in testing — a plain counting row stands in.
 */
export function buildSeriesRow(band: number, level: number, rng: Rng, opts: { gapInside: boolean; avoid?: ReadonlySet<SeriesFamilyId> }): SeriesRowSpec {
  const avoid = opts.avoid ?? new Set<SeriesFamilyId>()
  let families: SeriesFamilyId[] = []
  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (attempt % TRIES_PER_DRAW === 0) families = drawFamilies(band, rng, avoid)
    let lines: SeriesLine[] | null
    let gap: number
    if (families.length === 1) {
      const f = SERIES_FAMILIES[families[0]]
      const len = f.length(rng)
      lines = f.make(rng, len, level)
      gap = opts.gapInside ? rng.int(0, len - 1) : len - 1
    } else {
      // Two families, alternating. Each line shows one more term than its rule has parameters (so
      // it is checked once on its own) — below band 28 one more again, unless a four-parameter
      // family already makes the row long — and the shorter line is lengthened to keep the
      // alternation. The gap's line is drawn; with the gap at the end it holds the last term.
      // Bands 28 and up show the fewest.
      const [fa, fb] = families.map((id) => SERIES_FAMILIES[id])
      const p = Math.max(fa.params, fb.params)
      const m = p + 1 + (band < 28 && p <= 3 ? 1 : 0)
      const gapLine = rng.int(0, 1)
      const lens = [m + 1, gapLine === 0 ? m : m + 1]
      const a = fa.make(rng, lens[0], level)
      const b = fb.make(rng, lens[1], level)
      lines = a && b ? [a[0], b[0]] : null
      const gi = opts.gapInside ? rng.int(0, lens[gapLine] - 1) : lens[gapLine] - 1
      gap = gi * 2 + gapLine
    }
    if (!lines) continue
    const terms = interleave(lines)
    const row = terms.map((t, i) => (i === gap ? null : t))
    const read = seriesReadings(row)
    if (read.length !== 1 || read[0] !== terms[gap]) continue
    const spec = { families, lines, terms, gap, answer: terms[gap] }
    if (band < 4 || naiveFails(spec)) return spec
  }
  const terms = [2, 4, 6, 8, 10]
  return { families: ['up'], lines: [lineOf(terms)], terms, gap: 4, answer: 10 }
}

/** The two terms beside the gap, nearest first (its left neighbours, else its right ones), read every `stride`. */
function beside(terms: readonly number[], gap: number, stride: number): [number, number] | null {
  const ok = (i: number) => i >= 0 && i < terms.length && i !== gap
  if (ok(gap - stride) && ok(gap - 2 * stride)) return [terms[gap - stride], terms[gap - 2 * stride]]
  if (ok(gap + stride) && ok(gap + 2 * stride)) return [terms[gap + stride], terms[gap + 2 * stride]]
  return null
}

/** Repeat the last difference, repeat the last ratio (rounded): what the naive guesses give. */
function naive(terms: readonly number[], gap: number, stride: number): number[] {
  const b = beside(terms, gap, stride)
  if (!b) return []
  return b[1] !== 0 ? [2 * b[0] - b[1], Math.round((b[0] * b[0]) / b[1])] : [2 * b[0] - b[1]]
}

/** Families where repeating the last ratio is the rule itself (and repeating the difference, for plain counting). */
const RATIO_RULE: ReadonlySet<SeriesFamilyId> = new Set(['geo', 'triple', 'halve'])
const DIFF_RULE: ReadonlySet<SeriesFamilyId> = new Set(['up', 'up2', 'down'])

/**
 * From band 4 a row must not give itself away to "repeat the last difference" or "repeat the last
 * ratio": neither guess may land within 1 of the answer (the nearest option would be the answer)
 * unless it is the family's own rule. A slow-growing row (20, 21, 23, 26, 30 → 30 × 30/26 ≈ 34.6
 * for 35) is drawn again.
 */
function naiveFails(spec: SeriesRowSpec): boolean {
  const b = beside(spec.terms, spec.gap, 1)
  if (!b) return true
  const own = (rule: ReadonlySet<SeriesFamilyId>) => spec.families.length === 1 && rule.has(spec.families[0])
  if (!own(DIFF_RULE) && Math.abs(2 * b[0] - b[1] - spec.answer) < 1) return false
  return own(RATIO_RULE) || b[1] === 0 || Math.abs((b[0] * b[0]) / b[1] - spec.answer) >= 1
}

/**
 * Wrong answers a plausible wrong rule gives: the last difference or ratio repeated (along the row
 * and along the gap's line), the gap's line one step-change off (the step grows by more, or not at
 * all), and — on interleaved rows — the other line continued instead.
 */
export function seriesWrongs(spec: SeriesRowSpec): number[] {
  const { terms, gap, lines, answer } = spec
  const L = lines.length
  const out: number[] = [...naive(terms, gap, 1)]
  if (L > 1) out.push(...naive(terms, gap, L))
  const line = lines[gap % L].terms
  const gi = Math.floor(gap / L)
  if (gi >= 2) {
    const change = answer - 2 * line[gi - 1] + line[gi - 2]
    if (change !== 0) out.push(answer + change, answer - change)
  }
  if (L > 1 && gap === terms.length - 1) {
    for (const [r, other] of lines.entries()) if (r !== gap % L && other.terms.length >= 2) out.push(...naive(other.terms, other.terms.length, 1))
  }
  // Nearest first: where a side has room for one, it goes to the wrong answer that would otherwise
  // leave the right one nearest to a naive guess.
  return [...new Set(out)].filter((v) => Number.isInteger(v) && v >= 0 && v !== answer).sort((x, y) => Math.abs(x - answer) - Math.abs(y - answer))
}

/** The rule shown after answering: each term's step to the next of its line, the lines, and the gap worked out. */
export function seriesReveal(spec: SeriesRowSpec): { gaps: string[]; groups?: number[]; lines?: string[]; prompt?: { key: string } } {
  const { lines, terms, gap } = spec
  const L = lines.length
  const gaps = terms.map((_, i) => {
    const step = lines[i % L].steps[Math.floor(i / L)]
    return step ? stepLabel(step) : ''
  })
  // Two-line gaps (diffLines): colour alternate gaps, so the two lines of gaps stand apart.
  const groups = L > 1 ? terms.map((_, i) => i % L) : spec.families[0] === 'diffLines' ? terms.map((_, i) => i % 2) : undefined
  const worked = workedFor(lines[gap % L], Math.floor(gap / L))
  // A rule with no step to work out (primes) is named instead.
  const gapFamily = spec.families.length === L ? spec.families[gap % L] : spec.families[0]
  const named = gapFamily === 'prime' ? { prompt: { key: 'mechanics.series.primes.title' } } : {}
  return { gaps, ...(groups ? { groups } : {}), ...(worked ? { lines: [worked] } : {}), ...named }
}

function workedFor(line: SeriesLine, i: number): string | undefined {
  if (line.worked) return line.worked(i)
  const t = line.terms
  if (i >= 1) {
    const s = line.steps[i - 1]
    return s.op === '×±' ? `${t[i - 1]} × ${s.k} ${s.c >= 0 ? '+' : '−'} ${Math.abs(s.c)} = ${t[i]}` : `${t[i - 1]} ${s.op} ${s.v} = ${t[i]}`
  }
  const s = line.steps[0]
  if (!s) return undefined
  switch (s.op) {
    case '+':
      return `${t[1]} − ${s.v} = ${t[0]}`
    case '−':
      return `${t[1]} + ${s.v} = ${t[0]}`
    case '×':
      return `${t[1]} ÷ ${s.v} = ${t[0]}`
    case '÷':
      return `${t[1]} × ${s.v} = ${t[0]}`
    case '×±':
      return `( ${t[1]} ${s.c >= 0 ? '−' : '+'} ${Math.abs(s.c)} ) ÷ ${s.k} = ${t[0]}`
  }
}

/** Mechanics tags: the families', interleaving for two-family rows, and the missing term when the gap is inside. */
export function seriesTags(spec: SeriesRowSpec): string[] {
  const tags = new Set<string>()
  for (const f of spec.families) {
    const tag = SERIES_FAMILIES[f].tag
    if (tag) tags.add(tag)
  }
  if (spec.families.length > 1) tags.add('series.interleaved')
  if (spec.gap < spec.terms.length - 1) tags.add('series.missingTerm')
  return [...tags]
}
