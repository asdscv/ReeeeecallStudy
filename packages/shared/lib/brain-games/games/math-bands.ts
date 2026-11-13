import type { Rng } from '../rng'
import type { NearMissError } from './choice'

/**
 * Quick Math's content ladder (GAMES_DIFFICULTY_PLAN §3.1): what a problem of each band is.
 *
 * Bands 1–25 are one kind of problem each, in the order a person meets the steps that make mental
 * arithmetic hard: a carry, a borrow, a table fact, a division fact, a missing operand, an
 * order-of-operations step. From band 2 every problem needs one of them — operands are built
 * column by column, so a band's carry or borrow is guaranteed, never left to chance. Bands 26–41
 * rotate five kinds (add/subtract, multiply, divide, order of operations, missing number); every
 * four levels each kind takes a bigger step, and inside a block only the clock tightens.
 *
 * A problem is an expression tree, so the stimulus tokens, the worked line shown after a miss and
 * the plausible wrong answers (a slipped carry, a forgotten borrow, a neighbouring table fact)
 * all come from the same place and can never disagree with the answer.
 */
export type MathKind = 'add' | 'mul' | 'div' | 'order' | 'missing'
export type MathOp = '+' | '−' | '×' | '÷'
/** A number, or — once per missing-number problem — the hidden one (`n` is its value). */
export interface MathLeaf {
  n: number
  hole?: true
}
export interface MathBin {
  op: MathOp
  l: MathNode
  r: MathNode
  /** Written in brackets. */
  paren?: true
}
export type MathNode = MathLeaf | MathBin
export type MathToken = number | string

export interface MathProblem {
  /** The expression left of '='. A missing-number problem has exactly one `hole` leaf. */
  expr: MathNode
  /** A missing-number problem's right side. Otherwise the answer is the expression's value. */
  equals?: number
  answer: number
  kind: MathKind
  /** Needs × or ÷ done before + or − (an order-of-operations step beyond what brackets say). */
  order: boolean
  /** Plausible wrong answers (single slips); a `trap` (left to right, brackets ignored) is always offered. */
  errors: NearMissError[]
}

export const MATH_MAX_LEVEL = 41
/** Where the five kinds start taking turns. */
export const MATH_DEEP_FROM = 26
export const MATH_DEEP_KINDS: readonly MathKind[] = ['add', 'mul', 'div', 'order', 'missing']

const MISSING = 'math.missing'
const TWO_STEP = 'math.twoStep'

// ── Expression trees ────────────────────────────────────────────────────────────────────────

const leaf = (n: number): MathLeaf => ({ n })
const hole = (n: number): MathLeaf => ({ n, hole: true })
const bin = (op: MathOp, l: MathNode, r: MathNode, paren = false): MathBin => (paren ? { op, l, r, paren: true } : { op, l, r })
const isLeaf = (x: MathNode): x is MathLeaf => 'n' in x

function apply(op: MathOp, a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b
    case '−':
      return a - b
    case '×':
      return a * b
    case '÷':
      return a / b
  }
}

const valueOf = (x: MathNode): number => (isLeaf(x) ? x.n : apply(x.op, valueOf(x.l), valueOf(x.r)))

function walk(x: MathNode, visit: (x: MathNode) => void): void {
  visit(x)
  if (!isLeaf(x)) {
    walk(x.l, visit)
    walk(x.r, visit)
  }
}

/** In-order tokens; `spans` records each node's [start, end) token range. */
function flatten(x: MathNode, fillHole: boolean, out: MathToken[] = [], spans?: Map<MathNode, [number, number]>): MathToken[] {
  const start = out.length
  if (isLeaf(x)) out.push(x.hole && !fillHole ? '?' : x.n)
  else {
    if (x.paren) out.push('(')
    flatten(x.l, fillHole, out, spans)
    out.push(x.op)
    flatten(x.r, fillHole, out, spans)
    if (x.paren) out.push(')')
  }
  spans?.set(x, [start, out.length])
  return out
}

/** The stimulus: `a + b = ?`, or `a + ? = c` for a missing number. */
export function problemTokens(p: MathProblem): MathToken[] {
  return [...flatten(p.expr, false), '=', p.equals ?? '?']
}

/** Every node whose two operands are plain numbers: what a worked line does next. */
function readyNodes(x: MathNode, acc: MathBin[] = []): MathBin[] {
  if (!isLeaf(x)) {
    if (isLeaf(x.l) && isLeaf(x.r)) acc.push(x)
    else {
      readyNodes(x.l, acc)
      readyNodes(x.r, acc)
    }
  }
  return acc
}

function stepOnce(x: MathNode): MathNode {
  if (isLeaf(x)) return x
  if (isLeaf(x.l) && isLeaf(x.r)) return leaf(valueOf(x))
  return { ...x, l: stepOnce(x.l), r: stepOnce(x.r) }
}

/**
 * The worked line shown after a miss, e.g. `6 + 4 × 7 → 6 + 28 = 34`; a missing number is shown
 * filled in, `37 + 45 = 82`. Tokens are separated by single spaces (numbers as plain digits, for
 * the platform to format), and `highlight` is a [start, end) range of those space-separated tokens:
 * the part done first (or the filled-in number).
 */
export function workedLine(p: MathProblem): { lines: string[]; highlight?: [number, number] } {
  const spans = new Map<MathNode, [number, number]>()
  const first = flatten(p.expr, true, [], spans)
  if (p.equals !== undefined) {
    let blank: MathNode | undefined
    walk(p.expr, (x) => {
      if (isLeaf(x) && x.hole) blank = x
    })
    const at = blank ? spans.get(blank) : undefined
    return { lines: [[...first, '=', p.equals].join(' ')], ...(at ? { highlight: at } : {}) }
  }
  const states = [first.join(' ')]
  for (let x = stepOnce(p.expr), guard = 0; !isLeaf(x) && guard < 12; x = stepOnce(x), guard++) states.push(flatten(x, true).join(' '))
  const ready = readyNodes(p.expr)
  const at = states.length > 1 && ready.length === 1 ? spans.get(ready[0]) : undefined
  return { lines: [`${states.join(' → ')} = ${p.answer}`], ...(at ? { highlight: at } : {}) }
}

/** The mechanics (mechanics.ts) a problem uses, read off what it shows. */
export function problemTags(p: MathProblem): string[] {
  const tags = new Set<string>()
  const shown = (x: MathNode) => isLeaf(x) && !x.hole
  walk(p.expr, (x) => {
    if (isLeaf(x)) {
      if (x.hole) tags.add(MISSING)
      else if (x.n >= 100) tags.add('math.threeDigit')
      return
    }
    if (x.paren) tags.add('math.parens')
    if (x.op === '−') tags.add('math.sub')
    if (x.op === '÷') tags.add('math.div')
    if (x.op === '×') {
      tags.add('math.mul')
      if (shown(x.l) && shown(x.r) && (x.l as MathLeaf).n >= 10 && (x.r as MathLeaf).n >= 10) tags.add('math.bigMul')
    }
  })
  if (p.equals !== undefined && p.equals >= 100) tags.add('math.threeDigit')
  if (p.order) tags.add(TWO_STEP)
  return [...tags]
}

// ── Columns ─────────────────────────────────────────────────────────────────────────────────

/** Digits, units first. */
function digits(n: number): number[] {
  const out: number[] = []
  let v = Math.abs(Math.trunc(n))
  do {
    out.push(v % 10)
    v = Math.floor(v / 10)
  } while (v > 0)
  return out
}

/** Columns (0 = units) of a + b that carry out. */
function addCarries(a: number, b: number): number[] {
  const da = digits(a)
  const db = digits(b)
  const out: number[] = []
  for (let i = 0, c = 0; i < Math.max(da.length, db.length); i++) {
    c = (da[i] ?? 0) + (db[i] ?? 0) + c >= 10 ? 1 : 0
    if (c) out.push(i)
  }
  return out
}

/** Columns of a − b (a ≥ b) that borrow from the next. */
function subBorrows(a: number, b: number): number[] {
  const da = digits(a)
  const db = digits(b)
  const out: number[] = []
  for (let i = 0, k = 0; i < da.length; i++) {
    k = (da[i] ?? 0) - k < (db[i] ?? 0) ? 1 : 0
    if (k) out.push(i)
  }
  return out
}

/** a × m for a one-digit m: each column whose product carries, and how much. */
function mulCarries(a: number, m: number): { col: number; carry: number }[] {
  const out: { col: number; carry: number }[] = []
  digits(a).reduce((c, d, col) => {
    const next = Math.floor((d * m + c) / 10)
    if (next > 0) out.push({ col, carry: next })
    return next
  }, 0)
  return out
}

/** Carries across the partial products of a × b (long multiplication, one row per digit of b). */
function partialCarries(a: number, b: number): number {
  return digits(b).reduce((n, d) => n + mulCarries(a, d).length, 0)
}

type Range = readonly [number, number]
/** Digit ranges of an n-digit number, units first, the leading digit non-zero. */
const std = (n: number): Range[] => Array.from({ length: n }, (_, i): Range => (i === n - 1 ? [1, 9] : [0, 9]))

/**
 * a + b built column by column, units first. `carry[i]`: true — column i must carry, false — it
 * must not, undefined — either. Each column's digit pair is drawn among all pairs that fit. `aR`
 * must be at least as long as `bR`.
 */
function buildAdd(rng: Rng, aR: readonly Range[], bR: readonly Range[], carry: readonly (boolean | undefined)[] = []): [number, number] | null {
  let a = 0
  let b = 0
  let c = 0
  for (let i = 0; i < aR.length; i++) {
    const [blo, bhi] = bR[i] ?? [0, 0]
    const fits: [number, number][] = []
    for (let x = aR[i][0]; x <= aR[i][1]; x++) {
      for (let y = blo; y <= bhi; y++) if (carry[i] === undefined || carry[i] === x + y + c >= 10) fits.push([x, y])
    }
    if (fits.length === 0) return null
    const [x, y] = rng.pick(fits)
    a += x * 10 ** i
    b += y * 10 ** i
    c = x + y + c >= 10 ? 1 : 0
  }
  return [a, b]
}

/** a − b built column by column (a ≥ b), `borrow[i]` like buildAdd's `carry`. The top column never borrows. */
function buildSub(rng: Rng, aR: readonly Range[], bR: readonly Range[], borrow: readonly (boolean | undefined)[] = []): [number, number] | null {
  let a = 0
  let b = 0
  let k = 0
  for (let i = 0; i < aR.length; i++) {
    const want = i === aR.length - 1 ? false : borrow[i]
    const [blo, bhi] = bR[i] ?? [0, 0]
    const fits: [number, number][] = []
    for (let x = aR[i][0]; x <= aR[i][1]; x++) {
      for (let y = blo; y <= bhi; y++) if (want === undefined || want === x - k < y) fits.push([x, y])
    }
    if (fits.length === 0) return null
    const [x, y] = rng.pick(fits)
    a += x * 10 ** i
    b += y * 10 ** i
    k = x - k < y ? 1 : 0
  }
  return [a, b]
}

/** `count` columns among the first `of` that must regroup, the rest either way. */
function someCols(rng: Rng, count: number, of: number): (boolean | undefined)[] {
  const pick = new Set(rng.sample(Array.from({ length: of }, (_, i) => i), count))
  return Array.from({ length: of }, (_, i) => (pick.has(i) ? true : undefined))
}

const round10 = (n: number) => n % 10 === 0

/** An integer in [lo, hi] that is not `bad`: a few draws, then the first that fits. */
function intNot(rng: Rng, lo: number, hi: number, bad: (n: number) => boolean): number {
  for (let i = 0; i < 40; i++) {
    const n = rng.int(lo, hi)
    if (!bad(n)) return n
  }
  for (let n = lo; n <= hi; n++) if (!bad(n)) return n
  return lo
}

/** Bounded rejection: `make` returns null when its draw does not fit. */
function attempt(make: () => MathProblem | null, fallback: () => MathProblem): MathProblem {
  for (let i = 0; i < 300; i++) {
    const p = make()
    if (p) return p
  }
  return fallback()
}

// ── Wrong answers ───────────────────────────────────────────────────────────────────────────

/** The slips one operation invites, as that operation's wrong result. */
function ownSlips(op: MathOp, a: number, b: number, v: number): number[] {
  switch (op) {
    case '+':
      // A carry not added.
      return addCarries(a, b).map((i) => v - 10 ** (i + 1))
    case '−': {
      // A borrow taken but not paid back; the smaller digit taken from the larger in every column.
      const out = subBorrows(a, b).map((i) => v + 10 ** (i + 1))
      const db = digits(b)
      const noBorrow = digits(a).reduce((s, d, i) => s + Math.abs(d - (db[i] ?? 0)) * 10 ** i, 0)
      if (noBorrow !== v) out.push(noBorrow)
      return out
    }
    case '×': {
      // A neighbouring table fact (7×8 → 7×7, 7×9, 6×8, 8×8); a carry not added.
      const out = [v - a, v + a, v - b, v + b]
      const [big, small] = a >= 10 && b < 10 ? [a, b] : b >= 10 && a < 10 ? [b, a] : [0, 0]
      const slip = big ? mulCarries(big, small)[0] : undefined
      if (slip) out.unshift(v - slip.carry * 10 ** (slip.col + 1))
      return out
    }
    case '÷':
      return [v - 1, v + 1]
  }
}

/** Every wrong value a single slip somewhere in the tree gives. */
function slipsOf(x: MathNode): number[] {
  if (isLeaf(x)) return []
  const a = valueOf(x.l)
  const b = valueOf(x.r)
  const out = ownSlips(x.op, a, b, apply(x.op, a, b))
  for (const s of slipsOf(x.l)) out.push(apply(x.op, s, b))
  for (const s of slipsOf(x.r)) out.push(apply(x.op, a, s))
  return out.filter(Number.isInteger)
}

function toErrors(answer: number, values: number[], traps: number[] = []): NearMissError[] {
  const seen = new Set<number>([answer])
  const out: NearMissError[] = []
  for (const v of traps) {
    if (Number.isInteger(v) && v >= 0 && !seen.has(v)) {
      seen.add(v)
      out.push({ v, trap: true })
    }
  }
  for (const v of values) {
    if (Number.isInteger(v) && v >= 0 && !seen.has(v)) {
      seen.add(v)
      out.push({ v })
    }
  }
  return out
}

/** A problem whose answer is the expression's value. */
function plain(kind: MathKind, expr: MathNode, opts: { order?: boolean; trap?: number; extra?: number[] } = {}): MathProblem {
  const answer = valueOf(expr)
  const traps = opts.trap === undefined ? [] : [opts.trap]
  return { expr, answer, kind, order: opts.order ?? false, errors: toErrors(answer, [...slipsOf(expr), ...(opts.extra ?? [])], traps) }
}

/** A missing-number problem: `expr` holds the hole, `inverse` is how one solves it (its slips are the wrong answers). */
function gap(expr: MathNode, equals: number, inverse: MathNode, opts: { order?: boolean; extra?: number[] } = {}): MathProblem {
  const answer = valueOf(inverse)
  return { expr, equals, answer, kind: 'missing', order: opts.order ?? false, errors: toErrors(answer, [...slipsOf(inverse), ...(opts.extra ?? [])]) }
}

const swap = <T,>(rng: Rng, a: T, b: T): [T, T] => (rng.chance(0.5) ? [a, b] : [b, a])
const inv = (op: '+' | '−'): '+' | '−' => (op === '+' ? '−' : '+')

/** Left to right, ignoring precedence — the trap answer of an order-of-operations problem. */
function leftToRight(x: MathNode): number {
  const toks = flatten(x, true)
  let acc = toks[0] as number
  for (let i = 1; i + 1 < toks.length; i += 2) acc = apply(toks[i] as MathOp, acc, toks[i + 1] as number)
  return acc
}

// ── Bands 1–25 ──────────────────────────────────────────────────────────────────────────────

/** Where a trap must fall so the answer can sit at the drawn position (lowest: trap above; highest: below). */
export type TrapSide = 'above' | 'below'

interface BandDef {
  /** ms */
  par: number
  kind: MathKind
  /** Rule tags this band's problems can use (blocked → the band gives way to the one below). */
  rules?: readonly string[]
  /** Its problems carry a trap, so math.ts draws the answer's position first and asks for a side. */
  trap?: true
  make(rng: Rng, side?: TrapSide): MathProblem
}

/** Times-table factors 3–9, the hard 6–9 drawn twice as often. */
const FACT = [3, 4, 5, 6, 6, 7, 7, 8, 8, 9, 9] as const

/** A 2-digit + 2-digit (or − ) inner step that regroups, for bracket and three-term problems. */
function regroupPair(rng: Rng, op: '+' | '−'): [number, number] | null {
  return op === '+' ? buildAdd(rng, std(2), std(2), [true]) : buildSub(rng, std(2), std(2), [true])
}

const BANDS: Record<number, BandDef> = {
  // a + b ≤ 10 — also practice.
  1: {
    par: 9500,
    kind: 'add',
    make(rng) {
      const a = rng.int(1, 9)
      return plain('add', bin('+', leaf(a), leaf(rng.int(1, 10 - a))))
    },
  },
  // Single-digit sums that cross ten: always a carry.
  2: {
    par: 9500,
    kind: 'add',
    make(rng) {
      const a = rng.int(3, 9)
      return plain('add', bin('+', leaf(a), leaf(rng.int(Math.max(3, 10 - a), 9))))
    },
  },
  // Teen − one digit, always a borrow.
  3: {
    par: 9500,
    kind: 'add',
    make(rng) {
      const u = rng.int(0, 8)
      return plain('add', bin('−', leaf(10 + u), leaf(rng.int(Math.max(3, u + 1), Math.min(9, u + 7)))))
    },
  },
  // Times tables 3–9.
  4: { par: 6500, kind: 'mul', make: (rng) => plain('mul', bin('×', leaf(rng.pick(FACT)), leaf(rng.pick(FACT)))) },
  // 2-digit + 1-digit with a carry.
  5: {
    par: 7000,
    kind: 'add',
    make: (rng) => attempt(() => fromPair('+', buildAdd(rng, [[1, 9], [1, 9]], [[3, 9]], [true])), () => plain('add', bin('+', leaf(47), leaf(8)))),
  },
  // Division facts.
  6: {
    par: 7000,
    kind: 'div',
    make(rng) {
      const m = rng.int(3, 9)
      return plain('div', bin('÷', leaf(m * rng.int(3, 9)), leaf(m)))
    },
  },
  // 2-digit − 1-digit with a borrow.
  7: {
    par: 7500,
    kind: 'add',
    make: (rng) => attempt(() => fromPair('−', buildSub(rng, [[0, 9], [2, 9]], [[3, 9]], [true])), () => plain('add', bin('−', leaf(52), leaf(7)))),
  },
  // 2-digit + 2-digit, a units carry, the sum under 100.
  8: {
    par: 8000,
    kind: 'add',
    make: (rng) => attempt(() => fromPair('+', buildAdd(rng, [[1, 9], [1, 9]], [[1, 9], [1, 9]], [true, false])), () => plain('add', bin('+', leaf(38), leaf(47)))),
  },
  // 2-digit − 2-digit with a borrow.
  9: {
    par: 8500,
    kind: 'add',
    make: (rng) =>
      attempt(
        () => {
          const pair = buildSub(rng, [[0, 9], [1, 9]], [[1, 9], [1, 9]], [true])
          return pair && pair[0] - pair[1] >= 5 ? fromPair('−', pair) : null
        },
        () => plain('add', bin('−', leaf(73), leaf(48))),
      ),
  },
  // 2-digit + 2-digit, two carries, the sum over 100.
  10: {
    par: 8500,
    kind: 'add',
    make: (rng) =>
      attempt(
        () => {
          const pair = buildAdd(rng, [[1, 9], [1, 9]], [[1, 9], [1, 9]], [true, true])
          return pair && pair[0] + pair[1] > 100 ? fromPair('+', pair) : null
        },
        () => plain('add', bin('+', leaf(68), leaf(57))),
      ),
  },
  // A missing addend or subtrahend; finding it takes a borrow.
  11: {
    par: 9000,
    kind: 'missing',
    rules: [MISSING],
    make: (rng) =>
      attempt(
        () => {
          // p + q under 100 with a units carry: then (p + q) − p borrows.
          const pair = buildAdd(rng, [[1, 9], [1, 9]], [[1, 9], [1, 9]], [true, false])
          if (!pair) return null
          const [p, q] = pair
          if (rng.chance(0.5)) {
            // a + ? = c
            const [l, r] = swap<MathNode>(rng, leaf(p), hole(q))
            return gap(bin('+', l, r), p + q, bin('−', leaf(p + q), leaf(p)))
          }
          // a − ? = c
          return gap(bin('−', leaf(p + q), hole(q)), p, bin('−', leaf(p + q), leaf(p)))
        },
        () => gap(bin('+', leaf(37), hole(45)), 82, bin('−', leaf(82), leaf(37))),
      ),
  },
  // 2-digit × 1-digit with a carry.
  12: {
    par: 10000,
    kind: 'mul',
    make: (rng) =>
      attempt(
        () => {
          const u = rng.int(2, 9)
          const m = rng.int(3, 9)
          if (u * m < 10) return null
          const x = rng.int(1, 9) * 10 + u
          return plain('mul', rng.chance(0.75) ? bin('×', leaf(x), leaf(m)) : bin('×', leaf(m), leaf(x)))
        },
        () => plain('mul', bin('×', leaf(38), leaf(6))),
      ),
  },
  // a ± b × c or a ± b ÷ c, where left to right gives a different answer — always offered.
  13: {
    par: 10000,
    kind: 'order',
    rules: [TWO_STEP],
    trap: true,
    make(rng, side) {
      // × forms put left-to-right above the answer, ÷ forms below it.
      const form = side === 'above' ? rng.pick(['+×', '−×']) : side === 'below' ? rng.pick(['+÷', '−÷']) : rng.pick(['+×', '−×', '+÷', '−÷'])
      const f = rng.int(3, 9)
      const c = rng.int(3, 9)
      let expr: MathNode
      if (form === '+×') expr = bin('+', leaf(rng.int(3, 30)), bin('×', leaf(f), leaf(c)))
      else if (form === '−×') expr = bin('−', leaf(rng.int(f * c + 3, Math.min(99, f * c + 40))), bin('×', leaf(f), leaf(c)))
      else {
        // a ± b ÷ c with a = c·m and b = c·f, so left to right, (a ± b) ÷ c = m ± f, is whole too
        // (and, subtracting, m > f keeps it positive).
        const top = Math.floor(99 / c)
        const m = form === '+÷' ? rng.int(1, top) : rng.int(f + 1, top)
        expr = bin(form === '+÷' ? '+' : '−', leaf(c * m), bin('÷', leaf(c * f), leaf(c)))
      }
      return plain('order', expr, { order: true, trap: leftToRight(expr) })
    },
  },
  // 3-digit ± 2-digit with a carry or a borrow.
  14: {
    par: 10000,
    kind: 'add',
    make: (rng) =>
      attempt(
        () => (rng.chance(0.5) ? fromPair('+', buildAdd(rng, std(3), std(2), [true])) : fromPair('−', buildSub(rng, std(3), std(2), [true]))),
        () => plain('add', bin('−', leaf(403), leaf(57))),
      ),
  },
  // A missing factor or divisor, 2-digit.
  15: {
    par: 9000,
    kind: 'missing',
    rules: [MISSING],
    make: (rng) =>
      attempt(
        () => {
          const a = rng.int(3, 9)
          const x = intNot(rng, 12, 30, round10)
          if (mulCarries(x, a).length === 0) return null
          const c = a * x
          const inverse = bin('÷', leaf(c), leaf(a))
          const form = rng.int(0, 2)
          if (form === 2) return gap(bin('÷', leaf(c), hole(x)), a, inverse)
          const [l, r] = form === 0 ? [leaf(a), hole(x)] : [hole(x), leaf(a)]
          return gap(bin('×', l, r), c, inverse)
        },
        () => gap(bin('×', leaf(7), hole(12)), 84, bin('÷', leaf(84), leaf(7))),
      ),
  },
  // 2- or 3-digit ÷ 1-digit, a 2-digit quotient that needs a remainder carried.
  16: {
    par: 11000,
    kind: 'div',
    make: (rng) =>
      attempt(
        () => {
          const m = rng.int(3, 9)
          const q = intNot(rng, 12, Math.floor(299 / m), round10)
          return q * m <= 299 && mulCarries(q, m).length > 0 ? plain('div', bin('÷', leaf(q * m), leaf(m))) : null
        },
        () => plain('div', bin('÷', leaf(112), leaf(7))),
      ),
  },
  // Three numbers left to right; both steps regroup.
  17: {
    par: 11000,
    kind: 'add',
    make: (rng) =>
      attempt(
        () => {
          if (rng.chance(0.5)) {
            const pair = buildAdd(rng, std(2), std(2), [true])
            if (!pair) return null
            const s = pair[0] + pair[1]
            if (s % 10 === 9) return null
            const u = rng.int((s % 10) + 1, 9)
            const tens = Math.min(9, Math.floor((s - 3 - u) / 10))
            if (tens < 1) return null
            return plain('add', bin('−', bin('+', leaf(pair[0]), leaf(pair[1])), leaf(rng.int(1, tens) * 10 + u)))
          }
          const pair = buildSub(rng, std(2), std(2), [true])
          if (!pair) return null
          const r = pair[0] - pair[1]
          if (r < 3 || r % 10 === 0) return null
          const c = rng.int(1, 9) * 10 + rng.int(10 - (r % 10), 9)
          return plain('add', bin('+', bin('−', leaf(pair[0]), leaf(pair[1])), leaf(c)))
        },
        () => plain('add', bin('−', bin('+', leaf(48), leaf(27)), leaf(19))),
      ),
  },
  // 3-digit − 3-digit, the borrow crossing a zero.
  18: {
    par: 12000,
    kind: 'add',
    make: (rng) =>
      attempt(
        () => {
          const h = rng.int(2, 9)
          const ua = rng.int(0, 8)
          const a = h * 100 + ua
          const b = rng.int(1, h - 1) * 100 + rng.int(0, 9) * 10 + rng.int(ua + 1, 9)
          return a - b >= 12 ? plain('add', bin('−', leaf(a), leaf(b))) : null
        },
        () => plain('add', bin('−', leaf(503), leaf(268))),
      ),
  },
  // Two products.
  19: {
    par: 14000,
    kind: 'order',
    rules: [TWO_STEP],
    make: (rng) =>
      attempt(
        () => {
          const [a, b, c, d] = [rng.int(3, 9), rng.int(3, 9), rng.int(3, 9), rng.int(3, 9)]
          const op = rng.pick(['+', '−'] as const)
          if (a * b === c * d || (op === '−' && a * b - c * d < 8)) return null
          return plain('order', bin(op, bin('×', leaf(a), leaf(b)), bin('×', leaf(c), leaf(d))), { order: true })
        },
        () => plain('order', bin('−', bin('×', leaf(8), leaf(7)), bin('×', leaf(6), leaf(4))), { order: true }),
      ),
  },
  // Brackets — never a friendly ×10 or 25×4. Brackets ignored is always offered.
  20: {
    par: 12000,
    kind: 'order',
    trap: true,
    make: (rng, side) =>
      attempt(
        () => {
          // c × (a − b) ignored is c·a − b, above the answer; (a + b) × c and c × (a + b) fall below.
          const form = side === 'above' ? 'c×(−)' : side === 'below' ? rng.pick(['(+)×c', 'c×(+)']) : rng.pick(['c×(−)', '(+)×c', 'c×(+)'])
          const sub = form === 'c×(−)'
          const pair = regroupPair(rng, sub ? '−' : '+')
          if (!pair) return null
          const c = rng.int(3, 9)
          const v = sub ? pair[0] - pair[1] : pair[0] + pair[1]
          if (v < 3 || v > (sub ? 19 : 60) || round10(v) || (v * c) % 100 === 0) return null
          const inner = bin(sub ? '−' : '+', leaf(pair[0]), leaf(pair[1]), true)
          const expr = form === '(+)×c' ? bin('×', inner, leaf(c)) : bin('×', leaf(c), inner)
          const ignored = form === '(+)×c' ? pair[0] + pair[1] * c : sub ? c * pair[0] - pair[1] : c * pair[0] + pair[1]
          return plain('order', expr, { trap: ignored })
        },
        () => plain('order', bin('×', leaf(6), bin('−', leaf(23), leaf(15), true)), { trap: 6 * 23 - 15 }),
      ),
  },
  // 3-digit + 3-digit with two or three carries.
  21: {
    par: 12000,
    kind: 'add',
    make: (rng) =>
      attempt(
        () => fromPair('+', buildAdd(rng, std(3), std(3), rng.pick([[true, true, undefined], [true, false, true], [false, true, true]]))),
        () => plain('add', bin('+', leaf(478), leaf(356))),
      ),
  },
  // Friendly 2-digit × 2-digit: ×11, teen × teen, 15×, 25×.
  22: {
    par: 13000,
    kind: 'mul',
    make(rng) {
      const form = rng.pick(['11', 'teen', '15', '25'] as const)
      const pair: [number, number] =
        form === '11'
          ? [intNot(rng, 12, 99, (n) => round10(n) || n % 11 === 0), 11]
          : form === 'teen'
            ? [rng.int(12, 19), rng.int(12, 19)]
            : [Number(form), intNot(rng, 12, 39, (n) => round10(n) || n === Number(form))]
      const [a, b] = swap(rng, pair[0], pair[1])
      return plain('mul', bin('×', leaf(a), leaf(b)))
    },
  },
  // Two-step missing number: 4 × ? + 7 = 35.
  23: {
    par: 13000,
    kind: 'missing',
    rules: [MISSING, TWO_STEP],
    make: (rng) =>
      attempt(
        () => {
          const a = rng.int(3, 9)
          const x = intNot(rng, 4, 12, (n) => n === 10)
          const b = intNot(rng, 3, 40, round10)
          const op = rng.pick(['+', '−'] as const)
          const c = apply(op, a * x, b)
          if (c < 3) return null
          const [l, r] = swap<MathNode>(rng, leaf(a), hole(x))
          return gap(bin(op, bin('×', l, r), leaf(b)), c, bin('÷', bin(inv(op), leaf(c), leaf(b)), leaf(a)), {
            order: true,
            // The wrong way back: (c ± b) ÷ a with the sign kept.
            extra: [apply(op, c, b) / a],
          })
        },
        () => gap(bin('+', bin('×', leaf(4), hole(7)), leaf(7)), 35, bin('÷', bin('−', leaf(35), leaf(7)), leaf(4)), { order: true }),
      ),
  },
  // 3-digit ÷ 1-digit, two remainders to carry.
  24: { par: 13000, kind: 'div', make: (rng) => divOne(rng, 300, 999, 2, 72) },
  // General 2-digit × 2-digit.
  25: {
    par: 16000,
    kind: 'mul',
    make: (rng) =>
      attempt(
        () => {
          const bad = (n: number) => round10(n) || n % 11 === 0 || n === 15 || n === 25
          const a = intNot(rng, 12, 99, bad)
          const b = intNot(rng, 12, 99, bad)
          return (a <= 19 && b <= 19) || partialCarries(a, b) === 0 ? null : plain('mul', bin('×', leaf(a), leaf(b)))
        },
        () => plain('mul', bin('×', leaf(37), leaf(24))),
      ),
  },
}

/** a op b from a built pair, as an add/subtract problem. */
function fromPair(op: '+' | '−', pair: [number, number] | null): MathProblem | null {
  return pair ? plain('add', bin(op, leaf(pair[0]), leaf(pair[1]))) : null
}

/**
 * dividend ÷ m for a one-digit m: the dividend in [lo, hi], the quotient at least `qMin`, at least
 * `carries` remainders carried (the carries of q × m). `fallback` is a quotient that fits, ÷ 7.
 */
function divOne(rng: Rng, lo: number, hi: number, carries: number, fallback: number, qMin = 1): MathProblem {
  return attempt(
    () => {
      const m = rng.int(3, 9)
      const qlo = Math.max(qMin, Math.ceil(lo / m))
      const qhi = Math.floor(hi / m)
      if (qlo > qhi) return null
      const q = intNot(rng, qlo, qhi, round10)
      // A round dividend (660 ÷ 4) is a friendlier problem than the band means.
      return q * m >= lo && q * m <= hi && !round10(q * m) && mulCarries(q, m).length >= carries ? plain('div', bin('÷', leaf(q * m), leaf(m))) : null
    },
    () => plain('div', bin('÷', leaf(fallback * 7), leaf(7))),
  )
}

// ── Bands 26–41: five kinds take turns ──────────────────────────────────────────────────────

interface DeepDef {
  /** ms at the block's first level; each whole level after it × 0.95. */
  par: number
  rules?: readonly string[]
  make(rng: Rng): MathProblem
}

/** n-digit number with a non-zero units digit. */
const digitsN = (rng: Rng, n: number) => intNot(rng, 10 ** (n - 1), 10 ** n - 1, round10)

/** a ± b of n-digit and m-digit numbers, `k` columns regrouping. */
function addSubBig(rng: Rng, n: number, m: number, k: number, fallback: [number, number]): MathProblem {
  return attempt(
    () => {
      if (rng.chance(0.5)) return fromPair('+', buildAdd(rng, std(n), std(m), someCols(rng, k, m)))
      const pair = buildSub(rng, std(n), std(m), someCols(rng, k, Math.min(m, n - 1)))
      return pair && pair[0] - pair[1] >= 10 ** (n - 2) ? fromPair('−', pair) : null
    },
    () => plain('add', bin('+', leaf(fallback[0]), leaf(fallback[1]))),
  )
}

/** x × m for an n-digit x and one-digit m, at least two carries. */
function mulBig(rng: Rng, n: number, fallback: number): MathProblem {
  return attempt(
    () => {
      const x = digitsN(rng, n)
      const m = rng.int(3, 9)
      if (mulCarries(x, m).length < 2) return null
      return plain('mul', rng.chance(0.75) ? bin('×', leaf(x), leaf(m)) : bin('×', leaf(m), leaf(x)))
    },
    () => plain('mul', bin('×', leaf(fallback), leaf(7))),
  )
}

/** dividend ÷ e for a 2-digit e, the dividend in [lo, hi]. */
function divTwo(rng: Rng, lo: number, hi: number, fallback: [number, number]): MathProblem {
  return attempt(
    () => {
      const e = intNot(rng, 12, Math.min(99, Math.floor(hi / 12)), (n) => round10(n) || n % 11 === 0)
      const qlo = Math.max(12, Math.ceil(lo / e))
      const qhi = Math.floor(hi / e)
      if (qlo > qhi) return null
      const q = intNot(rng, qlo, qhi, round10)
      return q * e >= lo && q * e <= hi && !round10(q * e) ? plain('div', bin('÷', leaf(q * e), leaf(e))) : null
    },
    () => plain('div', bin('÷', leaf(fallback[0] * fallback[1]), leaf(fallback[1]))),
  )
}

/** A bracketed 2-digit ± 2-digit that regroups, its value a 2-digit number that is not a round ten. */
function innerPair(rng: Rng): { node: MathBin; v: number } | null {
  const op = rng.pick(['+', '−'] as const)
  const pair = regroupPair(rng, op)
  if (!pair) return null
  const v = apply(op, pair[0], pair[1])
  return v < 12 || v > 99 || round10(v) ? null : { node: bin(op, leaf(pair[0]), leaf(pair[1]), true), v }
}

const DEEP: Record<MathKind, readonly [DeepDef, DeepDef, DeepDef, DeepDef]> = {
  add: [
    // 4-digit ± 4-digit, two or more regroupings.
    { par: 14000, make: (rng) => addSubBig(rng, 4, 4, 2, [4786, 3547]) },
    // 4-digit − 4-digit borrowing across zeros, then a third term.
    {
      par: 16000,
      make: (rng) =>
        attempt(
          () => {
            const h = rng.int(2, 9)
            const ua = rng.int(0, 8)
            const a = h * 1000 + (rng.chance(0.5) ? 0 : rng.int(1, 9) * 100) + ua
            const b = rng.int(1, h - 1) * 1000 + rng.int(0, 9) * 100 + rng.int(0, 9) * 10 + rng.int(ua + 1, 9)
            const r = a - b
            if (r < 100 || r % 10 === 0) return null
            const len = rng.int(2, 3)
            const c = (len === 3 ? rng.int(1, 9) * 100 + rng.int(0, 9) * 10 : rng.int(1, 9) * 10) + rng.int(10 - (r % 10), 9)
            return plain('add', bin('+', bin('−', leaf(a), leaf(b)), leaf(c)))
          },
          () => plain('add', bin('+', bin('−', leaf(6004), leaf(2378)), leaf(159))),
        ),
    },
    // 5-digit ± 4-digit.
    { par: 16000, make: (rng) => addSubBig(rng, 5, 4, 2, [48352, 7869]) },
    // Three 5-digit terms.
    {
      par: 20000,
      make: (rng) =>
        attempt(
          () => {
            const [a, b, c] = [digitsN(rng, 5), digitsN(rng, 5), digitsN(rng, 5)]
            const form = rng.pick(['++', '+−', '−+'] as const)
            const op1 = form[0] === '+' ? '+' : '−'
            const op2 = form[1] === '+' ? '+' : '−'
            const s = apply(op1, a, b)
            const r = apply(op2, s, c)
            const regroups = (op: '+' | '−', x: number, y: number) => (op === '+' ? addCarries(x, y).length : subBorrows(x, y).length)
            if (s < 1000 || r < 1000 || regroups(op1, a, b) < 2 || regroups(op2, s, c) < 2) return null
            return plain('add', bin(op2, bin(op1, leaf(a), leaf(b)), leaf(c)))
          },
          () => plain('add', bin('−', bin('+', leaf(48735), leaf(36589)), leaf(27946))),
        ),
    },
  ],
  mul: [
    // 3-digit × 1-digit.
    { par: 14000, make: (rng) => mulBig(rng, 3, 347) },
    // 4-digit × 1-digit.
    { par: 17000, make: (rng) => mulBig(rng, 4, 4738) },
    // 2-digit × 2-digit, two or more carries in the rows.
    {
      par: 18000,
      make: (rng) =>
        attempt(
          () => {
            const bad = (n: number) => round10(n) || n % 11 === 0 || n === 15 || n === 25
            const a = intNot(rng, 12, 99, bad)
            const b = intNot(rng, 12, 99, bad)
            return (a <= 19 && b <= 19) || partialCarries(a, b) < 2 ? null : plain('mul', bin('×', leaf(a), leaf(b)))
          },
          () => plain('mul', bin('×', leaf(78), leaf(67))),
        ),
    },
    // Friendly 3-digit × 2-digit: ×11, 101×, 125×, 150×, 250×.
    {
      par: 18000,
      make(rng) {
        const form = rng.pick(['11', '101', '125', '150', '250'] as const)
        const pair: [number, number] =
          form === '11'
            ? [intNot(rng, 102, 999, (n) => round10(n) || n % 111 === 0), 11]
            : form === '101'
              ? [101, intNot(rng, 12, 99, (n) => round10(n) || n % 11 === 0)]
              : [Number(form), intNot(rng, 12, form === '125' ? 48 : 39, round10)]
        return plain('mul', rng.chance(0.75) ? bin('×', leaf(pair[0]), leaf(pair[1])) : bin('×', leaf(pair[1]), leaf(pair[0])))
      },
    },
  ],
  div: [
    // 3-digit ÷ 1-digit, a 3-digit quotient.
    { par: 13000, make: (rng) => divOne(rng, 300, 999, 2, 128, 100) },
    // 4-digit ÷ 1-digit.
    { par: 16000, make: (rng) => divOne(rng, 1000, 9999, 2, 846) },
    // 3-digit ÷ 2-digit.
    { par: 18000, make: (rng) => divTwo(rng, 100, 999, [28, 24]) },
    // 4-digit ÷ 2-digit.
    { par: 20000, make: (rng) => divTwo(rng, 1000, 9999, [63, 24]) },
  ],
  order: [
    // a ± b × c with a 3-digit a; the last step regroups.
    {
      par: 14000,
      rules: [TWO_STEP],
      make: (rng) =>
        attempt(
          () => {
            const a = digitsN(rng, 3)
            const [b, c] = [rng.int(3, 9), rng.int(3, 9)]
            const op = rng.pick(['+', '−'] as const)
            if (op === '−' ? a - b * c < 3 || subBorrows(a, b * c).length === 0 : addCarries(a, b * c).length === 0) return null
            return plain('order', bin(op, leaf(a), bin('×', leaf(b), leaf(c))), { order: true })
          },
          () => plain('order', bin('−', leaf(347), bin('×', leaf(8), leaf(6))), { order: true }),
        ),
    },
    // a × b ± c × d with 2-digit × 1-digit products.
    {
      par: 17000,
      rules: [TWO_STEP],
      make: (rng) =>
        attempt(
          () => {
            const [a, c] = [digitsN(rng, 2), digitsN(rng, 2)]
            const [b, d] = [rng.int(3, 9), rng.int(3, 9)]
            const op = rng.pick(['+', '−'] as const)
            if (op === '−' && a * b - c * d < 3) return null
            return plain('order', bin(op, bin('×', leaf(a), leaf(b)), bin('×', leaf(c), leaf(d))), { order: true })
          },
          () => plain('order', bin('+', bin('×', leaf(23), leaf(4)), bin('×', leaf(17), leaf(6))), { order: true }),
        ),
    },
    // (a ± b) × c ± d.
    {
      par: 18000,
      rules: [TWO_STEP],
      make: (rng) =>
        attempt(
          () => {
            const inner = innerPair(rng)
            if (!inner) return null
            const c = rng.int(3, 9)
            const d = digitsN(rng, 2)
            const op = rng.pick(['+', '−'] as const)
            if (op === '−' && inner.v * c - d < 3) return null
            return plain('order', bin(op, bin('×', inner.node, leaf(c)), leaf(d)), { order: true })
          },
          () => plain('order', bin('−', bin('×', bin('+', leaf(47), leaf(28), true), leaf(6)), leaf(35)), { order: true }),
        ),
    },
    // a × (b ± c) ± d × e.
    {
      par: 21000,
      rules: [TWO_STEP],
      make: (rng) =>
        attempt(
          () => {
            const inner = innerPair(rng)
            if (!inner) return null
            const a = rng.int(3, 9)
            const d = digitsN(rng, 2)
            const e = rng.int(3, 9)
            const op = rng.pick(['+', '−'] as const)
            if (op === '−' && a * inner.v - d * e < 3) return null
            return plain('order', bin(op, bin('×', leaf(a), inner.node), bin('×', leaf(d), leaf(e))), { order: true })
          },
          () => plain('order', bin('+', bin('×', leaf(6), bin('−', leaf(34), leaf(17), true)), bin('×', leaf(28), leaf(7))), { order: true }),
        ),
    },
  ],
  missing: [
    // ? + 478 = 1,203 — finding it takes two borrows or more.
    {
      par: 13000,
      rules: [MISSING],
      make: (rng) =>
        attempt(
          () => {
            const pair = buildAdd(rng, std(3), std(3), [rng.chance(0.5) ? true : undefined, true, true])
            if (!pair) return null
            const [x, a] = pair
            const [l, r] = swap<MathNode>(rng, hole(x), leaf(a))
            return gap(bin('+', l, r), x + a, bin('−', leaf(x + a), leaf(a)))
          },
          () => gap(bin('+', hole(725), leaf(478)), 1203, bin('−', leaf(1203), leaf(478))),
        ),
    },
    // 7 × ? = 868 — a 3-digit factor (or divisor).
    {
      par: 14000,
      rules: [MISSING],
      make: (rng) =>
        attempt(
          () => {
            const a = rng.int(3, 9)
            const x = digitsN(rng, 3)
            if (mulCarries(x, a).length < 2) return null
            const c = a * x
            const inverse = bin('÷', leaf(c), leaf(a))
            const form = rng.int(0, 2)
            if (form === 2) return gap(bin('÷', leaf(c), hole(x)), a, inverse)
            const [l, r] = form === 0 ? [leaf(a), hole(x)] : [hole(x), leaf(a)]
            return gap(bin('×', l, r), c, inverse)
          },
          () => gap(bin('×', leaf(7), hole(124)), 868, bin('÷', leaf(868), leaf(7))),
        ),
    },
    // ? × 12 − 17 = 79 — two steps, a 2-digit multiplier.
    {
      par: 17000,
      rules: [MISSING, TWO_STEP],
      make: (rng) =>
        attempt(
          () => {
            const a = intNot(rng, 12, 25, (n) => round10(n) || n % 11 === 0)
            const x = intNot(rng, 6, 30, round10)
            const b = digitsN(rng, 2)
            const op = rng.pick(['+', '−'] as const)
            const c = apply(op, a * x, b)
            if (c < 3) return null
            const [l, r] = swap<MathNode>(rng, hole(x), leaf(a))
            return gap(bin(op, bin('×', l, r), leaf(b)), c, bin('÷', bin(inv(op), leaf(c), leaf(b)), leaf(a)), {
              order: true,
              extra: [apply(op, c, b) / a],
            })
          },
          () => gap(bin('−', bin('×', hole(8), leaf(12)), leaf(17)), 79, bin('÷', bin('+', leaf(79), leaf(17)), leaf(12)), { order: true }),
        ),
    },
    // (? + 18) × 4 = 132 — undo the outside first.
    {
      par: 18000,
      rules: [MISSING],
      make: (rng) =>
        attempt(
          () => {
            const a = rng.int(3, 9)
            const b = digitsN(rng, 2)
            const x = intNot(rng, 3, 99, round10)
            const op = rng.pick(['+', '−'] as const)
            const v = apply(op, x, b)
            // The bracket's value is a factor too: never a round ten (× 10).
            if (v < 3 || round10(v)) return null
            return gap(bin('×', bin(op, hole(x), leaf(b), true), leaf(a)), v * a, bin(inv(op), bin('÷', leaf(v * a), leaf(a)), leaf(b)), {
              // The sign kept on the way back.
              extra: [apply(op, v, b)],
            })
          },
          () => gap(bin('×', bin('+', hole(15), leaf(18), true), leaf(4)), 132, bin('−', bin('÷', leaf(132), leaf(4)), leaf(18))),
        ),
    },
  ],
}

// ── What math.ts reads ──────────────────────────────────────────────────────────────────────

const deepBlock = (band: number) => Math.min(3, Math.floor((band - MATH_DEEP_FROM) / 4))

/** The band's own kind — for bands 1–25; deep bands draw theirs (MATH_DEEP_KINDS). */
export function bandKind(band: number): MathKind | null {
  return band < MATH_DEEP_FROM ? (BANDS[band]?.kind ?? 'add') : null
}

/** A band's (and, from 26, a kind's) clock at its own level, ms — before the level's fraction. */
export function mathPar(band: number, kind: MathKind): number {
  if (band < MATH_DEEP_FROM) return BANDS[band]?.par ?? BANDS[1].par
  return Math.round(DEEP[kind][deepBlock(band)].par * 0.95 ** ((band - MATH_DEEP_FROM) % 4))
}

/** The rule tags a band (a deep band's kind) can use. */
export function mathRules(band: number, kind: MathKind): readonly string[] {
  return (band < MATH_DEEP_FROM ? BANDS[band]?.rules : DEEP[kind][deepBlock(band)].rules) ?? []
}

/** Its problems carry a trap (left to right, brackets ignored): the answer's position is drawn first. */
export function bandHasTrap(band: number): boolean {
  return band < MATH_DEEP_FROM && BANDS[band]?.trap === true
}

/** One problem of a band (and, from 26, of a kind). `side`: where a trap must fall, if anywhere. */
export function makeProblem(band: number, kind: MathKind, rng: Rng, side?: TrapSide): MathProblem {
  if (band < MATH_DEEP_FROM) return (BANDS[band] ?? BANDS[1]).make(rng, side)
  return DEEP[kind][deepBlock(band)].make(rng)
}
