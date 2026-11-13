/**
 * Quick Math's content ladder (GAMES_DIFFICULTY_PLAN §3.1). The problems are read back from what
 * the player sees — the tokens, parsed here with ordinary precedence — and checked for what makes
 * each band hard: from band 2 always a carry, a borrow, a table or division fact, a missing operand
 * or an order-of-operations step; never a 0 or 1, ×1, ×10 or n − n. Also: the band mix, the answer
 * position, the near-miss options, the clock, rule gating and the five deep kinds taking turns.
 */
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_CONTEXT, createRng, type ChoiceView, type CreateContext, type RecentTrial } from '@reeeeecall/shared/lib/brain-games'
import { math, mathLimitMs } from '@reeeeecall/shared/lib/brain-games/games/math'
import { MATH_DEEP_KINDS, mathPar } from '@reeeeecall/shared/lib/brain-games/games/math-bands'

// Thousands of sampled trials per test: a second or three here, several times that on a CI runner,
// where the 5s default would time out.
vi.setConfig({ testTimeout: 30_000 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Tok = number | string

// ── Reading a problem back from its tokens ──────────────────────────────────────────────────

type Node = { n: number | null } | { op: string; l: Node; r: Node; paren: boolean }
const isNum = (x: Node): x is { n: number | null } => 'n' in x

/** Ordinary precedence: brackets, then × ÷, then + −, each left to right. */
function parse(tokens: readonly Tok[]): Node {
  let i = 0
  const factor = (): Node => {
    const t = tokens[i++]
    if (t === '(') {
      const e = sum()
      if (tokens[i++] !== ')') throw new Error(`unclosed bracket in ${tokens.join(' ')}`)
      return isNum(e) ? e : { ...e, paren: true }
    }
    if (t === '?') return { n: null }
    if (typeof t !== 'number') throw new Error(`unexpected ${String(t)} in ${tokens.join(' ')}`)
    return { n: t }
  }
  const product = (): Node => {
    let l = factor()
    while (tokens[i] === '×' || tokens[i] === '÷') {
      const op = tokens[i++] as string
      l = { op, l, r: factor(), paren: false }
    }
    return l
  }
  const sum = (): Node => {
    let l = product()
    while (tokens[i] === '+' || tokens[i] === '−') {
      const op = tokens[i++] as string
      l = { op, l, r: product(), paren: false }
    }
    return l
  }
  const e = sum()
  if (i !== tokens.length) throw new Error(`unparsed tokens in ${tokens.join(' ')}`)
  return e
}

const calc = (op: string, a: number, b: number) => (op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : a / b)
const evaluate = (x: Node, hole: number): number => (isNum(x) ? (x.n ?? hole) : calc(x.op, evaluate(x.l, hole), evaluate(x.r, hole)))
/** The tree's shape: `((n+n)−n)`, `(n×?)`. */
const form = (x: Node): string => (isNum(x) ? (x.n === null ? '?' : 'n') : `(${form(x.l)}${x.op}${form(x.r)})`)
/** The numbers on screen, in order (the hidden one as null). */
const numbers = (x: Node): (number | null)[] => (isNum(x) ? [x.n] : [...numbers(x.l), ...numbers(x.r)])
/** Every operation with its operand values (the hidden number filled in). */
function operations(x: Node, hole: number, out: { op: string; a: number; b: number; paren: boolean }[] = []) {
  if (!isNum(x)) {
    operations(x.l, hole, out)
    operations(x.r, hole, out)
    out.push({ op: x.op, a: evaluate(x.l, hole), b: evaluate(x.r, hole), paren: x.paren })
  }
  return out
}
const opCount = (x: Node): number => (isNum(x) ? 0 : 1 + opCount(x.l) + opCount(x.r))
const hasParen = (x: Node): boolean => !isNum(x) && (x.paren || hasParen(x.l) || hasParen(x.r))

const digitsOf = (n: number) => String(Math.abs(n)).split('').reverse().map(Number)
const len = (n: number) => String(Math.abs(n)).length
function carries(a: number, b: number): number {
  const [da, db] = [digitsOf(a), digitsOf(b)]
  let c = 0
  let n = 0
  for (let i = 0; i < Math.max(da.length, db.length); i++) {
    c = (da[i] ?? 0) + (db[i] ?? 0) + c >= 10 ? 1 : 0
    n += c
  }
  return n
}
function borrows(a: number, b: number): number {
  const [da, db] = [digitsOf(a), digitsOf(b)]
  let k = 0
  let n = 0
  for (let i = 0; i < da.length; i++) {
    k = da[i] - k < (db[i] ?? 0) ? 1 : 0
    n += k
  }
  return n
}
/** Carries of a × m, m one digit (= remainders carried when dividing a·m by m). */
function mulCarries(a: number, m: number): number {
  let c = 0
  let n = 0
  for (const d of digitsOf(a)) {
    c = Math.floor((d * m + c) / 10)
    if (c > 0) n++
  }
  return n
}
const regroups = (o: { op: string; a: number; b: number }) => (o.op === '+' ? carries(o.a, o.b) : o.op === '−' ? borrows(o.a, o.b) : 0)

/** Left to right, every bracket and precedence ignored — Band 13's trap. */
function leftToRight(tokens: readonly Tok[]): number {
  const t = tokens.filter((x) => x !== '(' && x !== ')')
  let acc = t[0] as number
  for (let i = 1; i + 1 < t.length; i += 2) acc = calc(t[i] as string, acc, t[i + 1] as number)
  return acc
}
/** The brackets dropped, precedence kept — Band 20's trap. */
const bracketsIgnored = (tokens: readonly Tok[]) => evaluate(parse(tokens.filter((x) => x !== '(' && x !== ')')), 0)

interface Trial {
  s: Any
  tokens: Tok[]
  left: Node
  /** The number right of '=' (a missing-number problem), or null when it asks for the result. */
  right: number | null
  band: number
  kind: string
  answer: number
  options: number[]
}

function read(s: Any): Trial {
  const view = math.view(s) as ChoiceView
  const tokens = view.stimulus.tokens as Tok[]
  const eq = tokens.indexOf('=')
  const right = tokens[eq + 1]
  const info = math.trialInfo!(s)
  const options = view.options.map((o) => o.value as number)
  return {
    s,
    tokens,
    left: parse(tokens.slice(0, eq)),
    right: right === '?' ? null : (right as number),
    band: Number(info.kind.slice(1)),
    kind: info.carry as string,
    answer: options[s.correctIndex],
    options,
  }
}

const ctxOf = (over: Partial<CreateContext> = {}): CreateContext => ({ ...DEFAULT_CONTEXT, ...over })
const trial = (level: number, seed: number, over: Partial<CreateContext> = {}) => read(math.create(level, createRng(seed), ctxOf(over)))
/** `n` trials at one band only (placement trials come from the current band). */
const atBand = (band: number, n: number, salt = 0) => Array.from({ length: n }, (_, i) => trial(band, band * 100003 + i * 7919 + salt, { trialKind: 'placement' }))

/** A round's worth of counted trials, each told the last two (as the round does). */
function chain(level: number, n: number, salt = 0, over: Partial<CreateContext> = {}): Trial[] {
  const out: Trial[] = []
  let recent: RecentTrial[] = []
  for (let i = 0; i < n; i++) {
    const s = math.create(level, createRng(salt + i * 7919 + Math.round(level * 977)), ctxOf({ ...over, recent }))
    out.push(read(s))
    recent = [...recent, { level, ...math.trialInfo!(s) }].slice(-2)
  }
  return out
}

const BANDS = Array.from({ length: 41 }, (_, i) => i + 1)

/** Collects failures, so a loop over thousands of trials makes one assertion (and stays fast). */
function collect() {
  const out: string[] = []
  return {
    out,
    check(ok: boolean, msg: () => string) {
      if (!ok && out.length < 8) out.push(msg())
    },
  }
}
/** The heavy loops run tens of thousands of trials. */
const SLOW = 60_000

// ── Tests ───────────────────────────────────────────────────────────────────────────────────

describe('Quick Math: every problem is right and well-formed', () => {
  it('the marked option is the true answer; options distinct, non-negative, ascending (L1–41, 1000 trials each)', () => {
    const c = collect()
    for (const level of [...BANDS, 2.5, 13.75, 26.4, 40.9]) {
      for (const t of chain(level, 1000, 11)) {
        const at = () => `L${level} B${t.band} ${t.tokens.join(' ')} [${t.options}] marked ${t.answer}`
        const fits = (v: number) => (t.right === null ? v === evaluate(t.left, 0) : evaluate(t.left, v) === t.right)
        c.check(t.tokens.filter((x) => x === '?').length === 1, at)
        // Exactly one option fits, and it is the marked one.
        c.check(t.options.filter(fits).length === 1 && fits(t.answer), at)
        c.check(t.options.every((v, i) => Number.isInteger(v) && v >= 0 && (i === 0 || v > t.options[i - 1])), at)
        // Every step is whole and never negative.
        c.check(operations(t.left, t.answer).every((o) => Number.isInteger(calc(o.op, o.a, o.b)) && calc(o.op, o.a, o.b) >= 0), at)
      }
    }
    expect(c.out).toEqual([])
  }, SLOW)

  it("the answer's position is uniform in every band from 2 (placement mode, 4000 each, 25% ± 3%)", () => {
    for (const band of BANDS.slice(1)) {
      const at = [0, 0, 0, 0]
      const trials = atBand(band, 4000, 5)
      for (const t of trials) at[t.s.correctIndex]++
      for (const n of at) expect(Math.abs(n / trials.length - 0.25), `B${band}: ${at}`).toBeLessThan(0.03)
    }
  }, SLOW)
})

describe('Quick Math: the band mix', () => {
  it('mostly the current band, never more than three below, never above; placement all current', () => {
    for (const level of [...BANDS, 4.5, 12.3, 30.8]) {
      const cur = Math.floor(level)
      const trials = chain(level, 1000, 3)
      const bands = trials.map((t) => t.band)
      expect(Math.max(...bands), `L${level}`).toBe(cur)
      expect(Math.min(...bands), `L${level}`).toBeGreaterThanOrEqual(Math.max(1, cur - 3))
      if (cur >= 4) expect(bands.filter((b) => b === cur).length / bands.length, `L${level}`).toBeGreaterThanOrEqual(0.5)
      // Never one band three times in a row while another is in reach.
      if (cur >= 2) expect(bands.findIndex((b, i) => i >= 2 && b === bands[i - 1] && b === bands[i - 2]), `L${level}`).toBe(-1)
      expect(new Set(Array.from({ length: 100 }, (_, seed) => trial(level, seed, { trialKind: 'placement' }).band)), `L${level} placement`).toEqual(new Set([cur]))
    }
  }, SLOW)

  it('the first trial after crossing into a level comes from the new band', () => {
    for (const level of [5, 13, 27, 41]) {
      const recent: RecentTrial[] = [{ level: level - 0.2, kind: `b${level - 1}` }]
      for (let seed = 0; seed < 100; seed++) expect(trial(level + 0.1, seed, { recent }).band).toBe(level)
    }
  })

  it('accepts any level: fractions, below 1, past the cap (41) and junk', () => {
    expect(math.maxLevel!(DEFAULT_CONTEXT)).toBe(41)
    expect(trial(0.2, 1, { trialKind: 'placement' }).band).toBe(1)
    expect(trial(120, 1, { trialKind: 'placement' }).band).toBe(41)
    expect(trial(Number.NaN, 1).band).toBe(1)
    expect(trial(2.99, 1, { trialKind: 'placement' }).band).toBe(2)
  })
})

/** What each band must be — read off the problem, not the engine's own label. */
const BAND_CHECKS: Record<number, (t: Trial) => boolean> = {
  1: (t) => form(t.left) === '(n+n)' && t.answer <= 10,
  2: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n+n)' && a >= 3 && a <= 9 && b >= 3 && b <= 9 && carries(a, b) === 1
  },
  3: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n−n)' && a >= 10 && a <= 19 && b >= 3 && b <= 9 && borrows(a, b) === 1
  },
  4: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n×n)' && [a, b].every((x) => x >= 3 && x <= 9)
  },
  5: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n+n)' && len(a) === 2 && b >= 3 && b <= 9 && (a % 10) + b >= 10
  },
  6: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n÷n)' && b >= 3 && b <= 9 && a / b >= 3 && a / b <= 9
  },
  7: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n−n)' && len(a) === 2 && a >= 20 && b >= 3 && b <= 9 && borrows(a, b) >= 1
  },
  8: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n+n)' && len(a) === 2 && len(b) === 2 && (a % 10) + (b % 10) >= 10 && a + b < 100
  },
  9: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n−n)' && len(a) === 2 && len(b) === 2 && a % 10 < b % 10
  },
  10: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n+n)' && len(a) === 2 && len(b) === 2 && carries(a, b) === 2 && a + b > 100
  },
  // Finding the missing number takes a borrow.
  11: (t) => {
    const f = form(t.left)
    const [a, b] = numbers(t.left)
    const c = t.right as number
    const shown = (a ?? b) as number
    const borrow = f === '(n−?)' ? borrows(shown, c) : borrows(c, shown)
    return ['(n+?)', '(?+n)', '(n−?)'].includes(f) && len(shown) === 2 && len(c) === 2 && borrow >= 1
  },
  12: (t) => {
    const [a, b] = numbers(t.left) as number[]
    const [big, m] = a >= 10 ? [a, b] : [b, a]
    return form(t.left) === '(n×n)' && len(big) === 2 && m >= 3 && m <= 9 && mulCarries(big, m) >= 1
  },
  // a ± b × c or a ± b ÷ c; left to right is different, and offered.
  13: (t) => {
    const ltr = leftToRight(t.tokens.slice(0, -2))
    return /^\(n[+−]\(n[×÷]n\)\)$/.test(form(t.left)) && ltr !== t.answer && t.options.includes(ltr)
  },
  14: (t) => {
    const [a, b] = numbers(t.left) as number[]
    const o = operations(t.left, 0)[0]
    return /^\(n[+−]n\)$/.test(form(t.left)) && len(a) === 3 && len(b) === 2 && regroups(o) >= 1
  },
  15: (t) => ['(n×?)', '(?×n)', '(n÷?)'].includes(form(t.left)) && len(t.answer) === 2,
  16: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n÷n)' && b <= 9 && len(a / b) === 2 && mulCarries(a / b, b) >= 1
  },
  17: (t) => ['((n+n)−n)', '((n−n)+n)'].includes(form(t.left)) && operations(t.left, 0).every((o) => regroups(o) >= 1),
  // 3-digit − 3-digit, the borrow crossing a zero.
  18: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n−n)' && len(a) === 3 && len(b) === 3 && digitsOf(a)[1] === 0 && a % 10 < b % 10
  },
  19: (t) => /^\(\(n×n\)[+−]\(n×n\)\)$/.test(form(t.left)),
  // Brackets; never a friendly ×10 or 25×4.
  20: (t) => hasParen(t.left) && operations(t.left, 0).every((o) => !(o.op === '×' && (o.a % 10 === 0 || o.b % 10 === 0 || (o.a * o.b) % 100 === 0))),
  21: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n+n)' && len(a) === 3 && len(b) === 3 && carries(a, b) >= 2
  },
  22: (t) => {
    const [a, b] = numbers(t.left) as number[]
    const friendly = [a, b].some((x) => x === 11 || x === 15 || x === 25) || (a <= 19 && b <= 19)
    return form(t.left) === '(n×n)' && len(a) === 2 && len(b) === 2 && friendly
  },
  23: (t) => /^\(\((n×\?|\?×n)\)[+−]n\)$/.test(form(t.left)),
  24: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n÷n)' && len(a) === 3 && b <= 9 && mulCarries(a / b, b) >= 2
  },
  25: (t) => {
    const [a, b] = numbers(t.left) as number[]
    return form(t.left) === '(n×n)' && len(a) === 2 && len(b) === 2
  },
}

describe('Quick Math: each band is what the plan says (placement mode, 1000 each)', () => {
  for (const band of BANDS.slice(0, 25)) {
    it(`band ${band}`, () => {
      expect(atBand(band, 1000).filter((t) => !BAND_CHECKS[band](t)).map((t) => `${t.tokens.join(' ')} → ${t.answer}`).slice(0, 5)).toEqual([])
    })
  }

  it('band 4: factors 3–9, and facts with a 6–9 come at least 1.8× as often as 3–5 facts', () => {
    const count = new Map<string, number>()
    for (const t of atBand(4, 4000)) {
      const [a, b] = numbers(t.left) as number[]
      count.set(`${a}x${b}`, (count.get(`${a}x${b}`) ?? 0) + 1)
    }
    const mean = (keep: (a: number, b: number) => boolean) => {
      const facts: number[] = []
      for (let a = 3; a <= 9; a++) for (let b = 3; b <= 9; b++) if (keep(a, b)) facts.push(count.get(`${a}x${b}`) ?? 0)
      return facts.reduce((x, y) => x + y, 0) / facts.length
    }
    expect(mean((a, b) => Math.max(a, b) >= 6) / mean((a, b) => Math.max(a, b) <= 5)).toBeGreaterThanOrEqual(1.8)
  })

  it('from band 2: no 0 or 1 anywhere, no ×1, ×10 or ÷1, no n − n', () => {
    const c = collect()
    const unit = (x: number) => x === 1 || x === 10 || x === 100 || x === 1000
    for (const band of BANDS.slice(1)) {
      for (const t of atBand(band, 300, 1)) {
        const at = () => `B${band}: ${t.tokens.join(' ')}`
        c.check([...numbers(t.left).map((n) => n ?? t.answer), ...(t.right === null ? [] : [t.right])].every((v) => v > 1), at)
        for (const o of operations(t.left, t.answer)) {
          c.check(!(o.op === '×' && (unit(o.a) || unit(o.b))), at)
          c.check(!(o.op === '÷' && (unit(o.b) || o.a === o.b)), at)
          c.check(!(o.op === '−' && o.a === o.b), at)
        }
      }
    }
    expect(c.out).toEqual([])
  })

  it('bands 26–41: add/subtract regroups twice (or borrows across zeros), a one-digit multiplier carries twice, no round dividend', () => {
    const c = collect()
    for (const band of BANDS.slice(25)) {
      for (const t of atBand(band, 500, 2)) {
        const at = () => `B${band} ${t.kind}: ${t.tokens.join(' ')}`
        const ops = operations(t.left, t.answer)
        const [a, b] = numbers(t.left) as number[]
        if (t.kind === 'add') c.check(ops.some((o) => regroups(o) >= 2) || (form(t.left) === '((n−n)+n)' && digitsOf(a)[1] === 0 && a % 10 < b % 10), at)
        if (t.kind === 'mul' && Math.min(a, b) <= 9) c.check(mulCarries(Math.max(a, b), Math.min(a, b)) >= 2, at)
        if (t.kind === 'div') c.check(form(t.left) === '(n÷n)' && a % 10 !== 0, at)
        if (t.kind === 'order') c.check(opCount(t.left) >= 2 && ops.some((o) => o.op === '×'), at)
        if (t.kind === 'missing') c.check(t.right !== null, at)
      }
    }
    expect(c.out).toEqual([])
  })
})

/** Needs a carry, a borrow, a table or division fact, a missing operand or an order-of-operations step. */
function needsWork(t: Trial): boolean {
  if (t.right !== null || hasParen(t.left)) return true
  const ops = operations(t.left, t.answer)
  const ranks = new Set(ops.map((o) => (o.op === '×' || o.op === '÷' ? 'mul' : 'add')))
  if (ranks.size === 2) return true
  return ops.some((o) => o.op === '×' || o.op === '÷' || regroups(o) >= 1)
}

describe('Quick Math: hard enough', () => {
  it('from L5 every trial needs a carry, a borrow, a fact, a missing operand or an order-of-operations step', () => {
    const c = collect()
    for (const level of BANDS.slice(4)) for (const t of chain(level, 400, 7)) c.check(needsWork(t), () => `L${level} B${t.band}: ${t.tokens.join(' ')}`)
    expect(c.out).toEqual([])
  })

  it('the last digit never gives it away: answers ≥ 20 beyond one single-digit fact have two distractors sharing the units digit; every option but a trap within ±max(20%, 20)', () => {
    // The plan asked this of add/subtract answers ≥ 50. The sample tables (§6.2) showed products,
    // missing operands and mixed expressions answerable from the last digit alone (48-62% of bands
    // 19-25), so it holds for every problem that is more than one single-digit fact.
    const c = collect()
    let sameUnits = 0
    let addSub50 = 0
    for (const level of [...BANDS, 13.5, 20.5]) {
      for (const t of chain(level, 400, 9)) {
        const at = () => `L${level} B${t.band}: ${t.tokens.join(' ')} [${t.options}]`
        const traps = t.band === 13 ? [leftToRight(t.tokens.slice(0, -2))] : t.band === 20 ? [bracketsIgnored(t.tokens.slice(0, -2))] : []
        c.check(t.options.every((v) => traps.includes(v) || Math.abs(v - t.answer) <= Math.max(t.answer * 0.2, 20)), at)
        const ops = t.tokens.filter((x) => x === '+' || x === '−' || x === '×' || x === '÷').length
        const beyondOneFact = ops >= 2 || t.tokens.some((x) => typeof x === 'number' && x >= 10)
        if (t.answer >= 20 && beyondOneFact) {
          sameUnits++
          if (t.answer >= 50 && operations(t.left, t.answer).every((o) => o.op === '+' || o.op === '−')) addSub50++
          c.check(t.options.filter((v) => v !== t.answer && v % 10 === t.answer % 10).length >= 2, at)
        }
      }
    }
    expect(c.out).toEqual([])
    expect(addSub50).toBeGreaterThan(1000)
    expect(sameUnits).toBeGreaterThan(8000)
  }, SLOW)

  it('bands 26–41: each kind gets bigger every four levels and never smaller; L40 bigger than L30', () => {
    // How big a problem of each kind is: add/subtract its widest number; multiply the digit
    // products long multiplication needs; divide the digits of dividend and divisor; order of
    // operations every digit on screen; missing number its steps (it grows in steps, not digits).
    const size: Record<string, (t: Trial) => number> = {
      add: (t) => Math.max(...(numbers(t.left) as number[]).map(len)),
      mul: (t) => (numbers(t.left) as number[]).map(len).reduce((a, b) => a * b, 1),
      div: (t) => (numbers(t.left) as number[]).map(len).reduce((a, b) => a + b, 0),
      order: (t) => (numbers(t.left) as number[]).map(len).reduce((a, b) => a + b, 0),
      missing: (t) => opCount(t.left),
    }
    const bySize = new Map<string, { min: number; max: number }>()
    for (const band of BANDS.slice(25)) {
      const trials = atBand(band, 600, 4)
      for (const kind of MATH_DEEP_KINDS) {
        const sizes = trials.filter((t) => t.kind === kind).map(size[kind])
        expect(sizes.length, `B${band} ${kind} appears`).toBeGreaterThan(50)
        const prev = bySize.get(`${kind}${band - 1}`)
        if (prev) expect(Math.min(...sizes), `${kind} at B${band}`).toBeGreaterThanOrEqual(prev.max)
        bySize.set(`${kind}${band}`, { min: Math.min(...sizes), max: Math.max(...sizes) })
      }
    }
    for (const kind of MATH_DEEP_KINDS) expect(bySize.get(`${kind}40`)!.min, kind).toBeGreaterThan(bySize.get(`${kind}30`)!.max)
  })

  it('bands 26–41: the five kinds take turns — never one of the last two kinds', () => {
    for (const level of [26, 31, 36, 41]) {
      const trials = chain(level, 600, 13, { trialKind: 'placement' })
      expect(trials.findIndex((t, i) => i >= 2 && (t.kind === trials[i - 1].kind || t.kind === trials[i - 2].kind)), `L${level}`).toBe(-1)
    }
  })

  it('variety: ≥ 150 different problems per level at L4–7, ≥ 300 from L8 (1000 trials)', () => {
    for (const level of BANDS.slice(3)) {
      const sigs = new Set(Array.from({ length: 1000 }, (_, i) => math.signature(math.create(level, createRng(level * 31337 + i), DEFAULT_CONTEXT))))
      expect(sigs.size, `L${level}`).toBeGreaterThanOrEqual(level >= 8 ? 300 : 150)
    }
  }, SLOW)
})

describe('Quick Math: the clock', () => {
  it('pars as in the plan (bands 1–25), and × 0.95 per level inside each deep block', () => {
    const PLAN = [9.5, 9.5, 9.5, 6.5, 7, 7, 7.5, 8, 8.5, 8.5, 9, 10, 10, 10, 9, 11, 11, 12, 14, 12, 12, 13, 13, 13, 16]
    PLAN.forEach((s, i) => expect(mathPar(i + 1, 'add'), `B${i + 1}`).toBe(s * 1000))
    for (const kind of MATH_DEEP_KINDS) {
      for (const start of [26, 30, 34, 38]) {
        for (let k = 1; k < 4; k++) expect(mathPar(start + k, kind) / mathPar(start + k - 1, kind), `${kind} B${start + k}`).toBeCloseTo(0.95, 2)
      }
    }
  })

  it("limit = the trial's band par × (1.15 − 0.4·frac(L)); bands 1–3 never under 9 s", () => {
    for (const level of [1, 1.5, 2.99, 3.4, 4, 4.75, 12.25, 13.5, 25.9, 26, 33.3, 41]) {
      const frac = level - Math.floor(level)
      const wrong = chain(level, 200, 17).filter((t) => {
        const raw = Math.round(mathPar(t.band, t.kind as Any) * (1.15 - 0.4 * frac))
        const want = t.band <= 3 ? Math.max(9000, raw) : raw
        return math.timeLimitMs(t.s) !== want || mathLimitMs(t.band, t.kind as Any, level) !== want || (t.band <= 3 && want < 9000)
      })
      expect(wrong.map((t) => `L${level} B${t.band} ${t.kind}: ${t.s.limitMs}`)).toEqual([])
    }
  })
})

describe('Quick Math: rules', () => {
  const RULES = ['math.missing', 'math.twoStep']

  it('with math.missing and math.twoStep blocked, neither ever appears (any level, any kind of trial)', () => {
    for (const level of [...BANDS, 11.5, 13.5, 23.5, 35.5]) {
      for (const trialKind of ['counted', 'placement', 'intro'] as const) {
        const leaked = chain(level, 150, 19, { blockRules: RULES, trialKind }).filter((t) => t.right !== null || math.mechanics(t.s).some((g) => RULES.includes(g)))
        expect(leaked.map((t) => `L${level} ${trialKind}: ${t.tokens.join(' ')}`)).toEqual([])
      }
    }
  })

  it('a blocked band gives way to the one below: 11 → 10, 13 → 12, 23 → 22', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(trial(11, seed, { trialKind: 'placement', blockRules: ['math.missing'] }).band).toBe(10)
      expect(trial(13, seed, { trialKind: 'placement', blockRules: ['math.twoStep'] }).band).toBe(12)
      expect(trial(23, seed, { trialKind: 'placement', blockRules: ['math.twoStep'] }).band).toBe(22)
      // Only the unseen rule with the lowest `from` is let through: missing (11) while twoStep waits.
      expect(trial(15, seed, { trialKind: 'placement', blockRules: ['math.twoStep'] }).band).toBe(15)
    }
  })

  it('tags say what the problem shows', () => {
    const c = collect()
    for (const band of BANDS.slice(1)) {
      for (const t of atBand(band, 100, 3)) {
        const tags = math.mechanics(t.s)
        const at = () => `B${band}: ${t.tokens.join(' ')} ${tags}`
        const ops = operations(t.left, t.answer)
        // An order-of-operations step: × or ÷ next to + or −, not settled by brackets alone.
        const mixed = new Set(ops.map((o) => (o.op === '×' || o.op === '÷' ? 'mul' : 'add'))).size === 2
        c.check(tags.includes('math.missing') === (t.right !== null), at)
        c.check(tags.includes('math.parens') === t.tokens.includes('('), at)
        c.check(tags.includes('math.sub') === t.tokens.includes('−'), at)
        c.check(tags.includes('math.mul') === t.tokens.includes('×'), at)
        c.check(tags.includes('math.div') === t.tokens.includes('÷'), at)
        c.check(tags.includes('math.threeDigit') === t.tokens.some((x) => typeof x === 'number' && x >= 100), at)
        c.check(!tags.includes('math.twoStep') || mixed, at)
        if (!hasParen(t.left)) c.check(tags.includes('math.twoStep') === mixed, at)
      }
    }
    expect(c.out).toEqual([])
  })
})

describe('Quick Math: what the player sees', () => {
  it('tokens, and a plain-text copy of them; numeric options carry their value', () => {
    for (const band of [1, 11, 20, 30, 41]) {
      for (const t of atBand(band, 50, 6)) {
        const view = math.view(t.s) as ChoiceView
        expect(view.stimulus.text).toBe(t.tokens.join(' '))
        expect(math.signature(t.s)).toBe(`ma:${view.stimulus.text}`)
        for (const o of view.options) expect(o.text).toBe(String(o.value))
      }
    }
  })

  it('after the answer, the worked line: the part done first highlighted, the missing number filled in', () => {
    for (const band of BANDS.slice(1)) {
      for (const t of atBand(band, 60, 8)) {
        expect((math.view(t.s) as ChoiceView).stimulus.reveal, 'not before the answer').toBeUndefined()
        const done = math.tap(t.s, (t.s.correctIndex + 1) % 4)
        const reveal = (math.view(done) as ChoiceView).stimulus.reveal!
        const line = reveal.lines![0]
        const words = line.split(' ')
        const at = `B${band}: ${line}`
        if (t.right === null) {
          expect(line.startsWith(t.tokens.slice(0, -2).join(' ')), at).toBe(true)
          expect(line.endsWith(`= ${t.answer}`), at).toBe(true)
        } else {
          expect(line, at).toBe(t.tokens.map((x) => (x === '?' ? t.answer : x)).join(' '))
          expect(words.slice(...reveal.highlight!), at).toEqual([String(t.answer)])
        }
        if (reveal.highlight) {
          const [a, b] = reveal.highlight
          expect(a >= 0 && b > a && b <= words.indexOf('=') && !words.slice(a, b).includes('→'), at).toBe(true)
        }
      }
    }
    // 6 + 4 × 7 → 6 + 28 = 34, "4 × 7" lit.
    const t = atBand(13, 200).find((x) => form(x.left) === '(n+(n×n))')!
    const reveal = (math.view(math.tap(t.s, t.s.correctIndex)) as ChoiceView).stimulus.reveal!
    const [a, b, c] = numbers(t.left) as number[]
    expect(reveal.lines).toEqual([`${a} + ${b} × ${c} → ${a} + ${b * c} = ${a + b * c}`])
    expect(reveal.highlight).toEqual([2, 5])
  })
})
