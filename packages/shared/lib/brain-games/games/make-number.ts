import type { BrainGameDef, CreateContext, MakeNumberView, MakeOp, MakeToken } from '../types'
import type { Rng } from '../rng'

/**
 * Make the Number (숫자 만들기) — make the target from the number tiles, each used exactly once,
 * with + − × ÷ ² (later brackets), like the 24 game. Owner 2026-11-13: «숫자 만들기 가능한가?», and for
 * every new game «새로운 게임은 처음부터 내 피드백 수준으로 만들어라».
 *
 * The ladder: start with two +/− tiles, increase the count, then restart at two tiles
 * for ×, ÷ and ². Each new operator is required by the puzzle, not just an extra button.
 * L1-2 +/− (2, 4 tiles), L3-4 × (2, 3), L5-6 ÷ (2, 4), L7-9 ² (2, 3, 4),
 * L10-12 any order (3, 4, 4), L13-15 brackets (3, 4, 4), L16 make 24,
 * L17-21 fractions on the way. Squaring is once per number tile, before ×/÷.
 * In fixed order the numbers place themselves: the player taps the sign between them and the next
 * number follows (`view.order`). The running value is shown as a help on the first band of each new operator.
 *
 * Every puzzle is solved before it is shown: the generator enumerates every expression in exact
 * rational arithmetic (fixed order: every choice of signs; any order: every expression tree, so
 * «brackets needed» means no bracket-free expression in any order makes it, and «a fraction on the
 * way» means every way passes a non-whole value). The witness (`solution()`, the reveal) uses
 * whole, non-negative values on the way wherever the band allows it. A band's `hard` picks, among the
 * targets the numbers can make, any (0), the fewer-ways half (0.5) or the fewest ways (1). Trivial
 * puzzles are refused: the plain sum (fixed + −), a target the band's new operator is not needed for,
 * × or ÷ by 1 (no 1 among those bands' numbers), a fixed-order puzzle the shown order already makes
 * (any order).
 *
 * Unseen rules (ctx.blockRules: placement, practice, the card budget) are never used. A level whose
 * band needs one deals the highest band below that it can, stretched — one more number from two
 * levels past it, bigger numbers, the fewest ways, the clock 12% shorter a level (12 s floor) — so a
 * placement trial at L12 is still a hard puzzle, not L3's. A rule a round meets for the first time
 * above its own start opens on its first, smallest band (ctx.recent's carry says which rules were open).
 */

export type MakeNumberKind = 'plus' | 'times' | 'divide' | 'square' | 'anyOrder' | 'brackets' | 'make24' | 'fraction'
export type MakeNumberRule = 'multiply' | 'divide' | 'square' | 'anyOrder' | 'brackets' | 'fraction'

export interface MakeNumberBand {
  kind: MakeNumberKind
  tiles: number
  /** 'fixed': the numbers stay in the order shown and place themselves; the player picks the signs. */
  order: 'fixed' | 'any'
  /** × available (its rule), ÷ available, brackets available. */
  times: boolean
  divide: boolean
  square: boolean
  brackets: boolean
  /** What every way to make the target must use: the band's new idea. */
  need: '×' | '÷' | '²' | '()' | null
  /** Every way to make the target passes a non-whole value (needs ÷ and brackets). */
  fraction: boolean
  minTile: number
  maxTile: number
  maxTarget: number
  /** Exactly 24. */
  target24: boolean
  /** The expression's value is shown while building (a help, low levels only). */
  preview: boolean
  tries: number
  parMs: number
  /** 0 any target the numbers make · 0.5 the fewer-ways half · 1 the fewest ways. */
  hard: number
}

const KIND: Record<MakeNumberKind, Pick<MakeNumberBand, 'order' | 'times' | 'divide' | 'square' | 'brackets' | 'need' | 'fraction' | 'target24'>> = {
  plus: { order: 'fixed', times: false, divide: false, square: false, brackets: false, need: null, fraction: false, target24: false },
  times: { order: 'fixed', times: true, divide: false, square: false, brackets: false, need: '×', fraction: false, target24: false },
  divide: { order: 'fixed', times: true, divide: true, square: false, brackets: false, need: '÷', fraction: false, target24: false },
  square: { order: 'fixed', times: true, divide: true, square: true, brackets: false, need: '²', fraction: false, target24: false },
  anyOrder: { order: 'any', times: true, divide: true, square: true, brackets: false, need: null, fraction: false, target24: false },
  brackets: { order: 'any', times: true, divide: true, square: true, brackets: true, need: '()', fraction: false, target24: false },
  make24: { order: 'any', times: true, divide: true, square: true, brackets: true, need: '()', fraction: false, target24: true },
  fraction: { order: 'any', times: true, divide: true, square: true, brackets: true, need: null, fraction: true, target24: false },
}

const row = (kind: MakeNumberKind, tiles: number, minTile: number, maxTile: number, maxTarget: number, preview: boolean, tries: number, parMs: number, hard: number): MakeNumberBand => ({
  kind,
  ...KIND[kind],
  tiles,
  minTile,
  maxTile,
  maxTarget,
  preview,
  tries,
  parMs,
  hard,
})

/** Band b is MAKE_NUMBER_LADDER[b − 1]. */
export const MAKE_NUMBER_LADDER: readonly MakeNumberBand[] = [
  row('plus', 2, 1, 9, 20, true, 3, 30_000, 0),
  row('plus', 4, 1, 9, 40, true, 3, 45_000, 0.5),
  row('times', 2, 2, 9, 81, true, 3, 45_000, 0),
  row('times', 3, 2, 9, 99, false, 3, 50_000, 0.5),
  row('divide', 2, 2, 12, 99, true, 3, 45_000, 0),
  row('divide', 4, 2, 9, 99, false, 2, 65_000, 0.5),
  row('square', 2, 2, 9, 99, true, 3, 55_000, 0),
  row('square', 3, 2, 9, 99, false, 2, 65_000, 0.5),
  row('square', 4, 2, 9, 99, false, 2, 75_000, 1),
  row('anyOrder', 3, 2, 9, 99, false, 2, 60_000, 0),
  row('anyOrder', 4, 2, 9, 99, false, 2, 85_000, 0.5),
  row('anyOrder', 4, 2, 13, 99, false, 2, 85_000, 1),
  row('brackets', 3, 2, 9, 99, false, 2, 60_000, 0),
  row('brackets', 4, 1, 9, 99, false, 2, 95_000, 0.5),
  row('brackets', 4, 1, 9, 99, false, 2, 85_000, 1),
  row('make24', 4, 1, 13, 24, false, 2, 80_000, 0.5),
  row('fraction', 4, 1, 9, 99, false, 3, 150_000, 0),
  row('fraction', 4, 1, 9, 99, false, 2, 120_000, 0.5),
  row('fraction', 4, 1, 13, 99, false, 2, 90_000, 0.5),
  row('fraction', 4, 1, 13, 99, false, 2, 70_000, 1),
  row('fraction', 4, 1, 13, 99, false, 2, 50_000, 1),
]

export const MAKE_NUMBER_MAX_LEVEL = MAKE_NUMBER_LADDER.length

export const MAKE_NUMBER_RULE_TAG: Readonly<Record<MakeNumberRule, string>> = {
  multiply: 'makeNumber.multiply',
  divide: 'makeNumber.divide',
  square: 'makeNumber.square',
  anyOrder: 'makeNumber.anyOrder',
  brackets: 'makeNumber.brackets',
  fraction: 'makeNumber.fraction',
}

/** Where each rule's first band is (mechanics.ts `from`). */
export const MAKE_NUMBER_RULE_START: Readonly<Record<MakeNumberRule, number>> = { multiply: 3, divide: 5, square: 7, anyOrder: 10, brackets: 13, fraction: 17 }

const RULES: readonly MakeNumberRule[] = ['multiply', 'divide', 'square', 'anyOrder', 'brackets', 'fraction']
const LETTER: Readonly<Record<MakeNumberRule, string>> = { multiply: 'x', divide: 'd', square: 's', anyOrder: 'o', brackets: 'b', fraction: 'f' }
const NEEDS: Readonly<Record<MakeNumberKind, readonly MakeNumberRule[]>> = {
  plus: [],
  times: ['multiply'],
  divide: ['multiply', 'divide'],
  square: ['multiply', 'divide', 'square'],
  anyOrder: ['multiply', 'divide', 'square', 'anyOrder'],
  brackets: ['multiply', 'divide', 'square', 'anyOrder', 'brackets'],
  make24: ['multiply', 'divide', 'square', 'anyOrder', 'brackets'],
  fraction: ['multiply', 'divide', 'square', 'anyOrder', 'brackets', 'fraction'],
}

/** A stretched band (a rule blocked): the clock shortens this much a level past the band, to this floor. */
export const MAKE_NUMBER_STRETCH_RATE = 0.94
export const MAKE_NUMBER_STRETCH_RATE_OPS = 0.95
export const MAKE_NUMBER_STRETCH_FLOOR_MS = 12_000

export interface MakeNumberPlan extends MakeNumberBand {
  /** The ladder band whose kind this trial deals (a stretched band's or an arriving rule's, else the level's). */
  band: number
  limitMs: number
  /** The rules open on this trial, as letters (x d o b f) — carried in ctx.recent. */
  open: string
}

function clampLevel(level: number): number {
  return Math.min(MAKE_NUMBER_MAX_LEVEL, Math.max(1, Number.isFinite(level) ? level : 1))
}

export function makeNumberLimitMs(level: number, parMs: number): number {
  const lv = clampLevel(level)
  return Math.round(parMs * (1.15 - 0.4 * (lv - Math.floor(lv))))
}

/** Band e, stretched to level lv (> e) because the bands above it need a rule this trial may not use. */
function stretched(e: number, lv: number, open: string): MakeNumberPlan {
  const r = MAKE_NUMBER_LADDER[e - 1]
  const g = lv - e
  const plus = r.kind === 'plus'
  const tiles = plus && g >= 3 ? Math.min(6, r.tiles + 1) : r.tiles
  const maxTile = plus ? Math.min(30, r.maxTile + Math.round(2 * g)) : Math.min(13, r.maxTile + Math.round(g))
  const parMs = Math.round(r.parMs * (plus ? MAKE_NUMBER_STRETCH_RATE : MAKE_NUMBER_STRETCH_RATE_OPS) ** g)
  return {
    ...r,
    tiles,
    maxTile,
    maxTarget: r.target24 ? 24 : 99,
    hard: 1,
    preview: r.preview && lv < 5,
    tries: lv >= 7 ? Math.min(r.tries, 2) : r.tries,
    parMs,
    band: e,
    limitMs: Math.max(MAKE_NUMBER_STRETCH_FLOOR_MS, parMs),
    open,
  }
}

/** What a trial at this level deals, given the round's blocked rules and its last trials. */
export function makeNumberPlan(level: number, ctx: Partial<Pick<CreateContext, 'blockRules' | 'trialKind' | 'recent'>> = {}): MakeNumberPlan {
  const lv = clampLevel(level)
  const b = Math.floor(lv)
  const blocked = new Set(ctx.blockRules ?? [])
  const isOpen = (r: MakeNumberRule) => !blocked.has(MAKE_NUMBER_RULE_TAG[r])
  const open = RULES.filter(isOpen)
    .map((r) => LETTER[r])
    .join('')
  const fits = (band: number) => NEEDS[MAKE_NUMBER_LADDER[band - 1].kind].every(isOpen)
  const recent = ctx.recent ?? []
  const trial = ctx.trialKind ?? 'counted'
  if ((trial === 'counted' || trial === 'intro' || trial === 'placement') && recent.length > 0) {
    const met = (r: MakeNumberRule) => recent.some((t) => t.carry === undefined || t.carry.includes(LETTER[r]))
    const arriving = RULES.find((r) => isOpen(r) && !met(r) && b > MAKE_NUMBER_RULE_START[r] && fits(MAKE_NUMBER_RULE_START[r]))
    if (arriving) {
      const start = MAKE_NUMBER_RULE_START[arriving]
      const r = MAKE_NUMBER_LADDER[start - 1]
      return { ...r, band: start, limitMs: makeNumberLimitMs(start, r.parMs), open }
    }
  }
  if (fits(b)) {
    const r = MAKE_NUMBER_LADDER[b - 1]
    return { ...r, band: b, limitMs: makeNumberLimitMs(lv, r.parMs), open }
  }
  let e = b
  while (e > 1 && !fits(e)) e--
  return stretched(e, lv, open)
}

/** The ladder's band for a level, with the round's unseen rules swapped out (ctx.blockRules). */
export function makeNumberBand(level: number, blockRules: readonly string[] = []): MakeNumberPlan {
  return makeNumberPlan(level, { blockRules, trialKind: 'counted', recent: [] })
}

// ── exact rational arithmetic ───────────────────────────────────────────────

export interface Frac {
  /** Numerator, sign carried here. */
  n: number
  /** Denominator, > 0, in lowest terms with n. */
  d: number
}

const gcd = (a: number, b: number): number => {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a || 1
}

function frac(n: number, d = 1): Frac | null {
  if (d === 0 || !Number.isFinite(n) || !Number.isFinite(d)) return null
  const g = gcd(n, d)
  const s = d < 0 ? -1 : 1
  return { n: (s * n) / g || 0, d: (s * d) / g }
}

function apply(a: Frac, op: MakeOp, b: Frac): Frac | null {
  switch (op) {
    case '+':
      return frac(a.n * b.d + b.n * a.d, a.d * b.d)
    case '−':
      return frac(a.n * b.d - b.n * a.d, a.d * b.d)
    case '×':
      return frac(a.n * b.n, a.d * b.d)
    case '÷':
      return b.n === 0 ? null : frac(a.n * b.d, a.d * b.n)
    default:
      return null
  }
}

/**
 * The exact value of an expression: × ÷ before + −, left to right, brackets first. Null when it is
 * not a complete expression (a dangling operator, an unclosed bracket) or divides by zero.
 */
export function evaluate(tokens: readonly MakeToken[]): Frac | null {
  let i = 0
  const peek = () => tokens[i]
  const isOp = (t: MakeToken | undefined, ...ops: MakeOp[]) => t?.kind === 'op' && ops.includes(t.op)
  const factor = (): Frac | null => {
    const t = peek()
    if (!t) return null
    if (t.kind === 'num') {
      i++
      if (isOp(peek(), '²')) {
        i++
        return frac(t.value * t.value)
      }
      return frac(t.value)
    }
    if (t.op === '(') {
      i++
      const v = expr()
      if (!isOp(peek(), ')')) return null
      i++
      return v
    }
    return null
  }
  const term = (): Frac | null => {
    let v = factor()
    while (v && isOp(peek(), '×', '÷')) {
      const op = (peek() as { op: MakeOp }).op
      i++
      const r = factor()
      v = r ? apply(v, op, r) : null
    }
    return v
  }
  const expr = (): Frac | null => {
    let v = term()
    while (v && isOp(peek(), '+', '−')) {
      const op = (peek() as { op: MakeOp }).op
      i++
      const r = term()
      v = r ? apply(v, op, r) : null
    }
    return v
  }
  const v = expr()
  return v && i === tokens.length ? v : null
}

/** '24', '3/4', '−2'. */
export function formatFrac(v: Frac): string {
  const sign = v.n < 0 ? '−' : ''
  return v.d === 1 ? `${sign}${Math.abs(v.n)}` : `${sign}${Math.abs(v.n)}/${v.d}`
}

// ── the solver ──────────────────────────────────────────────────────────────

const num = (value: number, tile: number): MakeToken => ({ kind: 'num', value, tile })
const op = (o: MakeOp): MakeToken => ({ kind: 'op', op: o })

/** Fixed order: the exact value of t0 o1 t1 o2 t2 … (× ÷ first), and whether every value on the way is whole and ≥ 0. */
export function fixedValue(nums: readonly number[], ops: readonly MakeOp[]): { n: number; d: number; clean: boolean } | null {
  let sumN = 0
  let sumD = 1
  let clean = true
  let termN = nums[0]
  let termD = 1
  let sign = 1
  const close = () => {
    const n = sumN * termD + sign * termN * sumD
    const d = sumD * termD
    const g = gcd(n, d)
    sumN = n / g || 0
    sumD = d / g
    if (sumD !== 1 || sumN < 0) clean = false
  }
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i]
    const x = nums[i + 1]
    if (o === '×' || o === '÷') {
      if (o === '×') termN *= x
      else termD *= x
      const g = gcd(termN, termD)
      termN /= g
      termD /= g
      if (termD !== 1) clean = false
    } else {
      close()
      sign = o === '+' ? 1 : -1
      termN = x
      termD = 1
    }
  }
  close()
  return { n: sumN, d: sumD, clean }
}

/** Every choice of signs between `count` numbers (count − 1 slots), from `ops`. */
function* signChoices(slots: number, ops: readonly MakeOp[]): Generator<MakeOp[]> {
  const total = ops.length ** slots
  for (let k = 0; k < total; k++) {
    const out: MakeOp[] = []
    let x = k
    for (let i = 0; i < slots; i++) {
      out.push(ops[x % ops.length])
      x = Math.floor(x / ops.length)
    }
    yield out
  }
}

/** An expression tree: a tile, or two subtrees joined by an operator. */
export interface MakeTree {
  n: number
  d: number
  op: MakeOp | null
  /** Written with no brackets at all (minimal brackets: × ÷ before + −, left to right). */
  flat: boolean
  /** Every value in it is whole. */
  int: boolean
  /** Every value in it is whole and ≥ 0. */
  clean: boolean
  /** The tile index (leaves only; −1 inside). */
  tile: number
  l: MakeTree | null
  r: MakeTree | null
}

/** Does `child` need brackets as the left / right operand of `parent`? */
function wraps(parent: MakeOp, child: MakeOp | null, right: boolean): boolean {
  if (child === null || child === '²') return false
  const sum = child === '+' || child === '−'
  switch (parent) {
    case '+':
      return false
    case '−':
      return right && sum
    case '×':
      return sum
    case '÷':
      return right ? true : sum
    default:
      return false
  }
}

function join(a: MakeTree, o: MakeOp, b: MakeTree): MakeTree | null {
  let n: number
  let d: number
  switch (o) {
    case '+':
      n = a.n * b.d + b.n * a.d
      d = a.d * b.d
      break
    case '−':
      n = a.n * b.d - b.n * a.d
      d = a.d * b.d
      break
    case '×':
      n = a.n * b.n
      d = a.d * b.d
      break
    default:
      if (b.n === 0) return null
      n = a.n * b.d
      d = a.d * b.n
  }
  if (d < 0) {
    n = -n
    d = -d
  }
  const g = gcd(n, d)
  n = n / g || 0
  d = d / g
  const int = a.int && b.int && d === 1
  return { n, d, op: o, flat: a.flat && b.flat && !wraps(o, a.op, false) && !wraps(o, b.op, true), int, clean: int && a.clean && b.clean && n >= 0, tile: -1, l: a, r: b }
}

const leaf = (value: number, tile: number): MakeTree => ({ n: value, d: 1, op: null, flat: true, int: true, clean: value >= 0, tile, l: null, r: null })

/**
 * Every expression tree over the tiles (each used once): every pair joined by every operator
 * allowed, both ways round for − and ÷, until one value is left. `flatOnly` skips anything that
 * needs brackets (a bracketed part can never become bracket-free). Four tiles: 3888 trees.
 */
export function eachTree(tiles: readonly number[], allow: { times: boolean; divide: boolean; square?: boolean; flatOnly?: boolean }, visit: (t: MakeTree) => void): void {
  const walk = (items: MakeTree[]) => {
    if (items.length === 1) {
      visit(items[0])
      return
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]
        const b = items[j]
        const rest = items.filter((_, k) => k !== i && k !== j)
        const tryJoin = (x: MakeTree, o: MakeOp, y: MakeTree) => {
          const t = join(x, o, y)
          if (t && (!allow.flatOnly || t.flat)) walk([...rest, t])
        }
        tryJoin(a, '+', b)
        tryJoin(a, '−', b)
        tryJoin(b, '−', a)
        if (allow.times) tryJoin(a, '×', b)
        if (allow.divide) {
          tryJoin(a, '÷', b)
          tryJoin(b, '÷', a)
        }
      }
    }
  }
  const variants = (at: number, items: MakeTree[]) => {
    if (at === tiles.length) return walk(items)
    const t = leaf(tiles[at], at)
    variants(at + 1, [...items, t])
    if (allow.square) variants(at + 1, [...items, { ...t, n: t.n * t.n, op: '²', l: t }])
  }
  variants(0, [])
}

/** A tree written out with as few brackets as it needs; leaves carry `tileAt[leaf.tile]` as their tile. */
export function treeTokens(t: MakeTree, tileAt: (tile: number) => number = (x) => x): MakeToken[] {
  if (t.op === '²' && t.l) return [...treeTokens(t.l, tileAt), op('²')]
  if (t.op === null || !t.l || !t.r) return [num(t.n, tileAt(t.tile))]
  const l = treeTokens(t.l, tileAt)
  const r = treeTokens(t.r, tileAt)
  return [...(wraps(t.op, t.l.op, false) ? [op('('), ...l, op(')')] : l), op(t.op), ...(wraps(t.op, t.r.op, true) ? [op('('), ...r, op(')')] : r)]
}

const brackets = (tokens: readonly MakeToken[]) => tokens.filter((t) => t.kind === 'op' && t.op === '(').length

/** For each whole target in 1..maxTarget the tiles can make: how many trees, and which kinds of way exist. */
interface TreeStat {
  ways: number
  flatWays: number
  flatClean: boolean
  int: boolean
  clean: boolean
}

// Repeated draws use the same exact solver result. Bound memory on phones; cached data never
// consumes randomness, so a seed produces the same puzzle before and after a cache hit.
const statsCache = new Map<string, Map<number, TreeStat>>()
const witnessCache = new Map<string, MakeTree[]>()
const solverKey = (tiles: readonly number[], allow: { times: boolean; divide: boolean; square?: boolean; flatOnly?: boolean }) =>
  `${tiles.join(',')}:${+allow.times}${+allow.divide}${+!!allow.square}${+!!allow.flatOnly}`
function cacheResult<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= 128) cache.delete(cache.keys().next().value!)
  cache.set(key, value)
  return value
}

function treeStats(tiles: readonly number[], allow: { times: boolean; divide: boolean; square?: boolean; flatOnly?: boolean }, maxTarget: number): Map<number, TreeStat> {
  const key = `${solverKey(tiles, allow)}:${maxTarget}`
  const cached = statsCache.get(key)
  if (cached) return cached
  const out = new Map<number, TreeStat>()
  eachTree(tiles, allow, (t) => {
    if (t.d !== 1 || t.n < 1 || t.n > maxTarget) return
    let s = out.get(t.n)
    if (!s) {
      s = { ways: 0, flatWays: 0, flatClean: false, int: false, clean: false }
      out.set(t.n, s)
    }
    s.ways++
    if (t.flat) {
      s.flatWays++
      if (t.clean) s.flatClean = true
    }
    if (t.int) s.int = true
    if (t.clean) s.clean = true
  })
  return cacheResult(statsCache, key, out)
}

/** The witness: among the trees making `target` that pass `ok`, the fewest brackets (ties at random). */
function bestTree(tiles: readonly number[], target: number, allow: { times: boolean; divide: boolean; square?: boolean; flatOnly?: boolean }, cleanOnly: boolean, rng: Rng): MakeTree | null {
  const key = `${solverKey(tiles, allow)}:${target}:${+cleanOnly}`
  const cached = witnessCache.get(key)
  if (cached) return cached.length ? rng.pick(cached) : null
  let best: MakeTree[] = []
  let fewest = Infinity
  eachTree(tiles, allow, (t) => {
    if (t.d !== 1 || t.n !== target || (cleanOnly && !t.clean)) return
    const k = brackets(treeTokens(t))
    if (k < fewest) {
      fewest = k
      best = [t]
    } else if (k === fewest && best.length < 8) best.push(t)
  })
  cacheResult(witnessCache, key, best)
  return best.length ? rng.pick(best) : null
}

// ── the a-fraction-on-the-way puzzles ───────────────────────────────────────

/**
 * Four numbers (1-13) and a target (10-99) that only a non-whole value on the way can make — every
 * one of the 16 such 24s (1 3 4 6: 6 ÷ (1 − 3 ÷ 4)), and for every other target up to two with
 * numbers to 9 and two with bigger ones. Found by enumerating all 1820 sets of four (the same solver
 * as eachTree, offline: a full pass takes about a third of a second, too long on a phone); the test
 * re-solves every entry. Six characters each: four tiles in base 14, the target in two digits.
 */
const FRACTION_TABLE =
  '11581034781028ac10116c10445911222711138b11147b1122551222771222bd12348a12337813167713158d13149d13' +
  '24991422571413bb14117c1413451517881522bd15222b15555916135516366a16155b16337817188917227c17222d17' +
  '337718555718336a18155d18358819344719468a19556b19334820229920248d2022bb20244621338821168c2139aa21' +
  '249922268822557d2226bd22335623335823557c2333cd2322bb24338824337724134624577b2418cc24155524277a24' +
  '24aa2422dd24166824235c24557b24255a244477241456243447252289253bcc25224a25356626155526158a26458c26' +
  '338827244627288b274aad27666828178928178a283bdd284559292478294aab29667d2933483045583028bb3048cc30' +
  '33783133493123bb3135cc3123663233883215ab32667a3226793338893333ab33459c3346773426663415ac3428dd34' +
  '157835156735124a35346a3515573617893633ac3633dd36556737566737777c3723dd37347838579938777b3823cc38' +
  '46683956693939aa39566a3926674015784014ab40689c4045994156774133ab41699d41445842477842125c42277c42' +
  '57784356884333ab4368ac4335694415994448dd44168b44367745449945248c45247c4515994634694637dd46778a46' +
  '259947567747557c4758bb47168948558848689c48155a48459949558949155a4925aa49346750268850348d50156a50' +
  '456951577851155a5168ac5126695225895255dd5228dd5255895358995325bb5368ac53147854156954125c54457a54' +
  '678855166955129a55467a552669562699566abb5625ab5667995726675725bb57236d5757995877795848cd5869bc58' +
  '566959479959556d59166a59477860248860777b6055dd60679961388861777c61166a61346962678862457a62566c62' +
  '178963188863689c63279d6335696417996445cc64346c642779652799657bbc6544aa65148866288866257a66558a66' +
  '5889674779677abb67566c67248968678968338c6826bb68467969677969268c6978bb6977997014897017ab7068dd70' +
  '78887178997166ab71166c711acc72557d7266ad73477b73148974458874668b74888a74678975699975247a7527ab75' +
  '238876468876238d768bbc76589977499977566c776acc77478878689978127c78569a78789979299979779a79667c79' +
  '199980477c8018ab8018aa81477b81199982458982288a82348b82299983388a8388cd83689984258884178c8458ab84' +
  '499985588a85248a854789865999865abc86667c8669998769dd8747dd87799988359c8818ab888999896bdd897bbc89' +
  '489990478d9089cc90178d91388b91258992278992999b9258ac92288c9338cc9336bc94259a9447dd95259a9557dd96' +
  '588a9699bc9718cc979acc9889cd98588d99388c99'

/** Offline exhaustive solutions: no runtime search, including for ² variants. */
function readSolvedTable(table: string): Puzzle[] {
  return table.split('|').map((entry) => {
    const [digits, target, ways, expr] = entry.split(':')
    const tiles = [...digits].map((n) => parseInt(n, 14))
    const witness = [...expr].map((c) => {
      const tile = 'ABCD'.indexOf(c)
      return tile >= 0 ? num(tiles[tile], tile) : op(c as MakeOp)
    })
    return { tiles, target: Number(target), ways: parseInt(ways, 36), witness }
  })
}

const SQUARE_FRACTION_TABLE =
  '1126:54:8:D²×(B+A÷C)|1126:45:8:D²×(B+A÷C²)|1128:96:8:D²×(B+A÷C)|1128:80:8:D²×(B+A÷C²)|112a:75:8:D²×(B−A÷C²)|11' +
  '3a:75:8:D²÷(B+A÷C)|1146:45:8:D²×(B+A÷C)|114a:75:8:D²×(B−A÷C)|1156:45:8:D²÷(B−A÷C)|1158:10:8:D÷(B−A÷C)|115a:12:' +
  '8:D×(B+A÷C)|115a:80:8:D²×(B−A÷C)|115c:10:8:D÷(B+A÷C)|1169:32:8:C²×(B−A÷D)|116a:12:8:D÷(B−A÷C)|116c:14:8:D×(B+A' +
  '÷C)|116c:10:8:D×(B−A÷C)|116c:39:8:C²×(B+A÷D)|116c:33:8:C²×(B−A÷D)|117a:98:8:D²÷(B+A÷C²)|117c:14:8:D÷(B−A÷C)|12' +
  '34:88:2:D²×(A+C²÷B)|1348:74:2:D×(B²+A÷C)|137a:75:2:D²÷(C÷B−A)|13ab:45:4:C÷(D÷B²−A)|1458:82:2:B²×(C+A÷D)|1458:7' +
  '8:2:B²×(C−A÷D)|145a:42:4:D×(B+A÷C)|146a:96:2:C²÷(A−D÷B²)|1478:90:2:D×(C²÷B−A)|1489:54:4:D²÷(A+B÷C)|148a:82:2:C' +
  '×(D+A÷B)|148b:86:2:C×(D−A÷B)|148c:98:2:C×(D+A÷B)|148c:94:2:C×(D−A÷B)|1567:21:4:C÷(A−B÷D)|1567:15:4:C÷(D÷B−A)|1' +
  '569:64:2:C²×(B²÷D−A)|156a:62:4:D×(C+A÷B)|156a:48:2:C²÷(A−B²÷D²)|156c:62:4:D×(B+A÷C)|156c:58:2:D×(B−A÷C)|159a:9' +
  '2:2:D×(C+A÷B)|159a:88:2:D×(C−A÷B)|15ac:42:2:D×(A+B²÷C)|15bc:99:2:D²÷(A+B÷C)|15bc:45:2:D²÷(A+C÷B)|166c:27:8:C²÷' +
  '(A+D÷B²)|166c:45:4:C²×(A+B²÷D²)|167a:84:2:B²÷(D÷C−A)|167b:99:2:B²÷(A−C÷D)|167b:63:2:B²÷(D÷C−A)|167c:86:4:D×(C+' +
  'A÷B)|167c:82:2:D×(C−A÷B)|167c:57:2:B²×(A+C÷D)|168b:96:2:B²÷(D÷C−A)|168b:99:2:D²÷(A+C÷B²)|168c:38:4:B×(A+C²÷D)|' +
  '168c:34:2:B²×(A−C÷D²)|169a:80:4:D²÷(A+C÷B²)|16bc:69:2:B²×(A+C÷D)|16cd:75:2:B²×(A+D÷C)|16cd:92:2:C²×(A−D÷B²)|17' +
  '89:36:4:C÷(A−B÷D)|1789:28:4:C÷(D÷B−A)|178a:35:2:B÷(A−C÷D)|178c:98:2:B²÷(D÷C−A)|179a:35:2:D÷(C÷B−A)|17ac:42:2:B' +
  '÷(A−C÷D)|17bc:21:2:D÷(C÷B−A)|188a:40:4:C÷(A−B÷D)|189a:15:2:C²÷(B²÷D−A)|189a:96:2:C²÷(A−D÷B²)|189c:57:2:C×(A+B²' +
  '÷D)|189c:39:2:C×(B²÷D−A)|18aa:40:4:D÷(C÷B−A)|18ad:52:2:D÷(C÷B−A)|18bc:22:2:C÷(D÷B−A)|18cc:24:4:D÷(C÷B−A)|18cd:' +
  '26:2:D÷(C÷B−A)|19ab:55:4:C÷(A−B÷D)|19ab:45:4:C÷(D÷B−A)|19ac:66:2:B×(C²÷D−A)|19bc:66:2:D÷(A−B÷C)|19cd:64:2:C²×(' +
  'D÷B−A)|1aac:60:4:C÷(A−B÷D)|1abc:66:4:C÷(A−B÷D)|1abc:36:2:C÷(A−B²÷D²)|1abc:25:2:C÷(D²÷B²−A)|1abd:65:2:B÷(A−C÷D)' +
  '|1abd:55:2:B÷(D÷C−A)|1acc:60:4:D÷(C÷B−A)|1acd:78:2:D÷(A−B÷C)|1acd:65:2:D÷(C÷B−A)|1acd:52:4:C÷(A−B÷D)|1acd:40:2' +
  ':C÷(D÷B−A)|1bcd:78:4:C÷(A−B÷D)|1bcd:66:4:C÷(D÷B−A)|2226:90:6:D²×(B+A÷C²)|2226:27:6:D×(C²+A÷B²)|222a:35:6:D×(C²' +
  '−A÷B²)|2246:99:2:D×(C²+A÷B²)|2246:93:2:D×(C²−A÷B²)|2246:81:2:D²×(A+B²÷C²)|2246:63:2:D²×(A−B²÷C²)|224c:45:2:D×(' +
  'B²−A²÷C²)|226d:75:2:C×(D−A÷B²)|229c:51:2:D×(A+C÷B²)|2336:62:2:D×(C²+A²÷B)|2336:92:2:D²×(B−A²÷C²)|2336:82:2:C²×' +
  '(B²+A²÷D²)|2336:80:2:C²×(B²−A²÷D²)|233c:92:2:D×(C²−A²÷B)|2446:99:2:D×(C²+A÷B)|2446:93:2:D×(C²−A÷B)|2446:81:2:D' +
  '²×(A+B÷C²)|2446:63:2:D²×(A−B÷C²)|244c:45:4:D×(B−A²÷C²)|246c:97:1:C×(B²+A÷D)|246c:95:1:C×(B²−A÷D)|248c:49:2:B×(' +
  'D+A÷C)|248c:47:2:B×(D−A÷C)|248c:93:1:D×(C−A²÷B²)|2668:99:2:C²×(A+B÷D)|268c:81:1:D²÷(A−C÷B²)|269b:93:2:B×(D+C÷A' +
  ')|269c:49:1:A²×(D+C÷B²)|269c:47:1:A²×(D−C÷B²)|26cc:49:2:A²×(C+B²÷D²)|26cc:47:2:A²×(C−B²÷D²)|28cc:51:2:C×(A+D²÷' +
  'B²)|28cc:75:2:C×(A²+D²÷B²)|28cc:57:2:A²×(C+D²÷B²)|2acc:45:2:D²÷(A+C÷B)|3336:56:6:D×(C²+A÷B²)|3336:52:6:D×(C²−A' +
  '÷B²)|333c:32:6:D×(B−A÷C²)|3346:62:2:D×(B²+C÷A)|3346:98:2:D×(C²+A÷B²)|3346:94:2:D×(C²−A÷B²)|3346:86:2:D×(B²+C²÷' +
  'A)|3346:82:2:B²×(A²+C÷D²)|3348:90:2:D×(B²+A²÷C)|334c:82:2:B²×(A²+C²÷D²)|336a:74:2:C×(B²+D÷A)|336a:68:2:C²×(A−D' +
  '÷B²)|336a:56:2:B²×(A²−D²÷C²)|336c:76:2:D×(C+A÷B²)|336c:68:2:D×(C−A÷B²)|336c:74:2:C×(D+A÷B²)|336c:62:2:C×(B²+D÷' +
  'A²)|336d:56:2:C²×(A−D÷B²)|337c:80:4:D×(C−A÷B²)|33ac:68:2:D×(B²−C÷A)|3448:70:4:C²×(B+A÷D)|3448:58:2:C²×(B−A÷D)|' +
  '3448:82:2:C²×(B+A²÷D)|3458:86:1:B²×(C+A÷D)|3458:98:2:B²×(A+C²÷D)|346b:58:1:C×(D−B÷A)|3478:86:1:D×(A²+C÷B)|348c' +
  ':78:2:C×(D−A²÷B)|34bc:98:1:A²×(C−B²÷D²)|356b:96:1:C²×(D−B²÷A)|35ac:87:1:B×(A+D²÷C)|3669:92:2:C²×(A−B²÷D²)|366c' +
  ':80:2:D×(C+B÷A²)|366c:64:2:D×(C−B÷A²)|367b:66:1:D²÷(A−C÷B)|368a:85:1:D×(C+A÷B)|368a:97:1:A²×(C+D²÷B²)|368d:94:' +
  '1:B×(D+C÷A)|368d:46:1:B×(C²−D²÷A)|36cc:37:2:A×(D+C÷B²)|38ad:16:1:D²÷(A²+C²÷B²)|38bc:86:1:B×(C−A÷D)|38bd:33:1:C' +
  '²÷(B−D÷A)|3aac:55:2:A×(B+C²÷D)|3acd:68:1:C×(B−D÷A)|3bcd:80:1:C×(B−D÷A)|444c:45:6:D×(B−A÷C²)|4458:74:2:B²×(A+C÷' +
  'D)|445a:78:2:C×(B²−A÷D)|445a:88:2:C×(B²+A²÷D)|4468:93:4:C×(B²−A÷D)|446a:81:4:C×(B²−D÷A)|446c:75:4:D×(C+A÷B²)|4' +
  '46c:69:2:D×(C−A÷B²)|446c:98:2:C×(B²+A÷D)|446c:94:2:C×(B²−A÷D)|446c:65:2:A×(B²+C²÷D²)|4478:78:2:B²×(A+C÷D)|4489' +
  ':70:2:C×(D−A÷B²)|4489:46:2:B²×(A−D÷C)|4489:94:2:B²×(A²−D²÷C)|448b:90:2:C×(D+A÷B²)|448b:86:4:C×(D−A÷B²)|448c:93' +
  ':2:D×(C−A÷B²)|448c:98:2:C×(D+A÷B²)|448c:94:2:C×(D−A÷B²)|448c:58:2:A×(B²−D÷C)|448d:90:2:B²×(A+D÷C)|448d:38:2:B²' +
  '×(A−D÷C)|448d:82:2:B²×(D²÷C−A²)|455a:38:2:D×(A−B÷C²)|455a:88:2:A²×(C+B÷D)|455a:72:2:A²×(C−B÷D)|456a:62:1:B×(A²' +
  '−C²÷D)|4578:94:1:A²×(B+C÷D)|458c:54:2:D×(B−A÷C)|459a:58:2:D×(A+C÷B)|459a:53:1:B×(C+A²÷D)|459c:46:1:C×(B+A²÷D²)' +
  '|45ab:63:1:B×(D+A²÷C)|4668:51:4:B×(A+C²÷D)|466d:99:2:C²×(B−D÷A)|468a:55:2:D×(B−A÷C)|468a:57:2:B×(D−A÷C)|468a:5' +
  '1:1:B×(D²÷C−A)|468a:85:1:D×(A+B²÷C)|4699:37:2:A×(D+C÷B²)|4699:35:2:A×(D−C÷B²)|469b:93:1:C×(D−A÷B)|46ab:81:1:B×' +
  '(D+C÷A)|46bd:78:1:D²÷(A−C÷B)|46bd:66:1:C²÷(A−D÷B)|4778:70:2:D×(C+B÷A)|4778:42:4:D×(C−B÷A)|4789:94:1:A²×(B−D÷C)' +
  '|478c:90:2:D×(B+A÷C)|478c:78:2:D×(B−A÷C)|488c:99:2:D×(B+A²÷C²)|488c:93:2:D×(B−A²÷C²)|4899:90:4:B×(D+C÷A)|4899:' +
  '54:2:B×(D−C÷A)|489c:66:2:B×(C²÷A−D)|489c:74:1:B×(A²−C²÷D)|48aa:85:4:C×(D²÷B−A)|48bc:74:1:B×(D−C÷A)|48bc:38:1:A' +
  '×(C−D÷B)|48bc:94:1:B×(C+D÷A²)|48cc:75:2:C×(A+D²÷B²)|48cd:58:1:A×(D+C÷B)|48cd:46:1:A×(D−C÷B)|48cd:98:1:B×(D−C÷A' +
  '²)|49ac:45:1:C²÷(A−D²÷B²)|49bc:87:1:B×(C−A²÷D)|4aac:45:2:D×(B−C²÷A²)|4abc:87:1:D×(B−C÷A)|556a:58:2:D×(C−A÷B²)|' +
  '55ac:66:2:D×(B+A÷C)|55ac:76:2:C²×(D²÷B²−A)|569c:98:1:D×(C−A÷B)|56ab:98:1:C×(D−B÷A)|56ab:63:1:B×(D−A÷C)|56ab:73' +
  ':1:A×(D+B²÷C)|56bc:82:2:D×(A+C÷B)|56cd:38:1:C×(D²÷B−A²)|577c:28:2:D²÷(A+B÷C²)|57ac:78:1:D×(B−A÷C)|588a:72:2:A×' +
  '(B+C²÷D)|589a:62:1:D×(B−C÷A)|589b:45:1:C²÷(B²÷A−D)|589c:93:1:C×(A+B²÷D)|5abc:86:1:B×(C−D÷A)|5acc:54:2:A×(D−C÷B' +
  ')|5ccc:15:6:D²÷(C−B÷A)|667c:69:2:B²×(A−C²÷D)|6689:50:2:C×(A+D÷B²)|6689:70:2:D×(A+C²÷B²)|668a:87:2:A×(D+B²÷C)|6' +
  '68c:99:2:A×(D+B²÷C)|66ac:65:2:C×(B+A÷D)|66ac:55:2:C×(B−A÷D)|66cd:94:2:C×(B²−D²÷A)|6789:58:1:C×(B+D÷A²)|67ab:66' +
  ':1:D²÷(C−B²÷A)|6899:84:2:B×(D+C÷A)|689b:87:1:C×(D−B÷A)|689b:70:1:B×(D−C²÷A²)|68ac:85:1:C×(B+A÷D)|68ac:53:1:A×(' +
  'B+C÷D)|68ac:43:1:A×(B−C÷D)|69ac:83:1:B×(D−C²÷A²)|6aac:65:2:A×(C+B÷D)|6acd:44:1:C×(B²÷A−D)|777c:21:6:D²÷(B−A÷C²' +
  ')|78bd:91:1:D²÷(C−B²÷A)|889c:78:2:C×(B+A÷D)|88cc:54:4:D²÷(A−B²÷C)|88cc:69:4:C×(A−D²÷B²)|89ac:93:1:D×(B−C÷A)|89' +
  'ad:65:1:D²÷(B−A²÷C)|89ad:16:1:D²÷(B+C²÷A²)|89bc:93:1:B×(C−A÷D)|8abc:48:1:B²÷(C²÷D−A)|99cc:64:4:D²÷(A−B²÷C)|9ac' +
  'd:42:1:A×(D−B²÷C)|abcc:54:2:D²÷(B−A²÷C)'
const SQUARE_FRACTION_PUZZLES = readSolvedTable(SQUARE_FRACTION_TABLE)

export interface FractionPuzzle {
  tiles: number[]
  target: number
}

const fractionPuzzles: Partial<Record<'plain' | 'square', FractionPuzzle[]>> = {}

export function makeNumberFractionPuzzles(square = false): readonly FractionPuzzle[] {
  if (square) return SQUARE_FRACTION_PUZZLES
  const key = 'plain'
  if (!fractionPuzzles[key]) {
    const table = FRACTION_TABLE
    const out: FractionPuzzle[] = []
    for (let i = 0; i + 6 <= table.length; i += 6) {
      const s = table.slice(i, i + 6)
      out.push({ tiles: [0, 1, 2, 3].map((k) => parseInt(s[k], 14)), target: Number(s.slice(4)) })
    }
    fractionPuzzles[key] = out
  }
  return fractionPuzzles[key]!
}

// ── puzzles ─────────────────────────────────────────────────────────────────

interface Puzzle {
  /** In the order shown. */
  tiles: number[]
  target: number
  /** One way, its tiles indexing `tiles`. */
  witness: MakeToken[]
  /** Ways the generator counted (sign choices in fixed order, trees otherwise) — fewer is harder. */
  ways: number
}

const draw = (p: MakeNumberBand, rng: Rng) => Array.from({ length: p.tiles }, () => rng.int(p.minTile, p.maxTile))
const sum = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0)

/** A target by the band's `hard`: any, the fewer-ways half, or the fewest. */
function chooseTarget<T extends { ways: number }>(valid: readonly [number, T][], hard: number, rng: Rng): [number, T] | null {
  if (valid.length === 0) return null
  if (hard <= 0) return rng.pick(valid)
  const ways = valid.map(([, s]) => s.ways).sort((a, b) => a - b)
  const cap = hard >= 1 ? ways[0] : ways[Math.floor((ways.length - 1) / 2)]
  return rng.pick(valid.filter(([, s]) => s.ways <= cap))
}

/** Fixed order: the tiles as drawn, a sign between each pair. */
function fixedPuzzle(p: MakeNumberBand, rng: Rng): Puzzle | null {
  const ops: MakeOp[] = ['+', '−', ...(p.times ? (['×'] as const) : []), ...(p.divide ? (['÷'] as const) : [])]
  for (let attempt = 0; attempt < 400; attempt++) {
    const tiles = draw(p, rng)
    const by = new Map<number, { ways: number; clean: { signs: MakeOp[]; mask: number }[]; bad: boolean }>()
    for (let mask = 0; mask < (p.square ? 2 ** tiles.length : 1); mask++) {
      for (const signs of signChoices(tiles.length - 1, ops)) {
        const v = fixedValue(tiles.map((v, i) => mask & (1 << i) ? v * v : v), signs)
        if (!v || v.d !== 1 || v.n < 1 || v.n > p.maxTarget) continue
        let s = by.get(v.n)
        if (!s) {
          s = { ways: 0, clean: [], bad: false }
          by.set(v.n, s)
        }
        s.ways++
        // Every way must use the band's new idea: a − (the plain sum is no puzzle), a ×, a ÷.
        if (p.kind === 'plus' && tiles.length > 2 && !signs.includes('−')) s.bad = true
        if (p.need === '×' && !signs.includes('×')) s.bad = true
        if (p.need === '÷' && !signs.includes('÷')) s.bad = true
        if (p.need === '²' && mask === 0) s.bad = true
        if (v.clean) s.clean.push({ signs, mask })
      }
    }
    const valid = [...by].filter(([, s]) => !s.bad && s.clean.length > 0)
    // The hardest bands ask for the one way there is.
    const pick = chooseTarget(p.hard >= 1 ? valid.filter(([, s]) => s.ways === 1) : valid, p.hard, rng)
    if (!pick) continue
    const { signs, mask } = rng.pick(pick[1].clean)
    const witness: MakeToken[] = []
    tiles.forEach((v, i) => {
      if (i > 0) witness.push(op(signs[i - 1]))
      witness.push(num(v, i))
      if (mask & (1 << i)) witness.push(op('²'))
    })
    return { tiles, target: pick[0], witness, ways: pick[1].ways }
  }
  return null
}

/** A shown order the target cannot be made in as it stands (any-order bands: the order is part of the puzzle). */
function unhelpfulOrder(tiles: readonly number[], target: number, ops: readonly MakeOp[], rng: Rng, square = false): number[] | null {
  const perms: number[][] = []
  const permute = (prefix: number[], left: number[]) => {
    if (left.length === 0) perms.push(prefix)
    left.forEach((x, i) => permute([...prefix, x], [...left.slice(0, i), ...left.slice(i + 1)]))
  }
  permute([], tiles.map((_, i) => i))
  for (const order of rng.shuffle(perms)) {
    const shown = order.map((i) => tiles[i])
    let makes = false
    for (let mask = 0; mask < (square ? 2 ** shown.length : 1) && !makes; mask++) {
      for (const signs of signChoices(shown.length - 1, ops)) {
        const v = fixedValue(shown.map((v, i) => mask & (1 << i) ? v * v : v), signs)
        if (v && v.d === 1 && v.n === target) {
          makes = true
          break
        }
      }
    }
    if (!makes) return order
  }
  return null
}

/** The witness tree written with each leaf pointing at its tile's place in the shown order. */
function shownWitness(t: MakeTree, order: readonly number[]): MakeToken[] {
  return treeTokens(t, (drawn) => order.indexOf(drawn))
}

/** Any order, no brackets. */
function anyOrderPuzzle(p: MakeNumberBand, rng: Rng): Puzzle | null {
  const allow = { times: true, divide: true, square: p.square, flatOnly: true }
  const ops: MakeOp[] = ['+', '−', '×', '÷']
  for (let attempt = 0; attempt < 200; attempt++) {
    const tiles = draw(p, rng).sort((a, b) => a - b)
    const stats = treeStats(tiles, allow, p.maxTarget)
    const total = sum(tiles)
    let valid = [...stats].filter(([t, s]) => s.flatClean && t !== total).map(([t, s]) => [t, { ways: s.flatWays }] as [number, { ways: number }])
    for (let k = 0; k < 4 && valid.length > 0; k++) {
      const pick = chooseTarget(valid, p.hard, rng)!
      const order = unhelpfulOrder(tiles, pick[0], ops, rng, p.square)
      if (!order) {
        valid = valid.filter(([t]) => t !== pick[0])
        continue
      }
      const w = bestTree(tiles, pick[0], allow, true, rng)!
      return { tiles: order.map((i) => tiles[i]), target: pick[0], witness: shownWitness(w, order), ways: pick[1].ways }
    }
  }
  return null
}

/** Any order with brackets, and no way without them (24 every time on the 24 band). */
function bracketPuzzle(p: MakeNumberBand, rng: Rng): Puzzle | null {
  if (p.target24 && p.square) return square24Puzzle(p, rng)
  const allow = { times: true, divide: true, square: p.square }
  for (let attempt = 0; attempt < 400; attempt++) {
    const tiles = draw(p, rng).sort((a, b) => a - b)
    const stats = treeStats(tiles, allow, p.maxTarget)
    const valid = [...stats].filter(([t, s]) => s.flatWays === 0 && s.clean && (!p.target24 || t === 24))
    const pick = chooseTarget(valid, p.hard, rng)
    if (!pick) continue
    const w = bestTree(tiles, pick[0], allow, true, rng)!
    const order = rng.shuffle(tiles.map((_, i) => i))
    return { tiles: order.map((i) => tiles[i]), target: pick[0], witness: shownWitness(w, order), ways: pick[1].ways }
  }
  return null
}

/** Solved offline over all 1..13 tile sets, with optional squares: 24 needs brackets.
 * Store each set plus its exact solution count so live generation never searches rejected sets. */
const SQUARE_24_TABLE =
  '1117:24:1c:(D²−C)÷(A+B)|1118:24:o:D×(C+A+B)|111b:24:1c:(A+B)×(C+D)|111c:24:9c:(A+B)×C×D|111d:24:1c:(A+B)×(D−C)' +
  '|1122:24:o:D²×(C²+A+B)|1123:24:1s:(A+B)×C²×D|1124:24:18:D×(C²+A+B)|1127:24:7k:(D²−A×B)÷C|1128:24:70:D×(C+A×B)|' +
  '1129:24:1c:(A+C)×(D−B)|1133:24:6w:C×(D²−A×B)|1136:24:4o:C×(D+A+B)|1137:24:4k:C×(D+A×B)|1139:24:3g:C×(D−A×B)|11' +
  '3a:24:k:C×(D−A−B)|113b:24:g:(C−A)×(B+D)|113c:24:3o:D×(C−A×B)|1144:24:1k:D×(C+A+B)|1145:24:3g:C×(D+A×B)|114b:24' +
  ':g:(D²−B)÷(A+C)|114c:24:1c:C×D÷(A+B)|1156:24:3g:D×(C−A×B)|1158:24:c:D×(C−A−B)|115a:24:8:D²÷(C−A)−B|115b:24:38:' +
  '(D²−A×B)÷C|115c:24:30:D²÷(C+A×B)|115d:24:8:(A+B)×(C²−D)|1166:24:1c:D×(C−A−B)|1168:24:o:C×D÷(A+B)|1169:24:4:C+D' +
  '×(A+B)|117a:24:4:D+C×(A+B)|117c:24:30:D²÷(C−A×B)|117d:24:38:(D²−A×B)÷C|1188:24:g:D+C×(A+B)|118c:24:c:D²÷(C−A−B' +
  ')|118d:24:w:(D²−B)÷(C−A)|1222:24:8o:(A+B)×C×D²|125b:24:22:(A+D²−B)÷C|1277:24:i:(C×D−A)÷B|1299:24:o:(D²−C)÷(A+B' +
  ')|12bd:24:1q:D+C×(B−A)|133a:24:w:C×(A+D−B)|135d:24:1e:A×B×(D−C)|137b:24:16:(D²−A×C²)÷B|138a:24:g:C×(D−A)÷B|139' +
  '9:24:2k:(C−A)×D÷B|139a:24:s:B×(A+D)−C|13ad:24:q:A+(D²−C²)÷B|13bd:24:g:(D²−C²)÷(B−A)|1459:24:k:D+C×(B−A)|145b:2' +
  '4:1s:A×B×(D−C)|146a:24:12:D×(B−A)−C|146c:24:3c:C×D÷(B−A)|147b:24:a:C×(A+B)−D|14ac:24:22:C×D÷(A+B)|14bb:24:g:(D' +
  '²−A)÷(B²−C)|14bd:24:8:(D²−A)÷(C−B)|1559:24:8:(A+B)×(D−C)|155c:24:18:D×(A+B÷C)|1569:24:18:C×(D−A×B)|156b:24:a:B' +
  '×(A+C)−D|158d:24:2:B×(D−C)−A|159c:24:g:C×(B−A)−D|159d:24:4:(A+B)×(D−C)|15ad:24:g:(D−A)×C÷B|1668:24:s:B×C²÷(A+D' +
  ')|1678:24:8:(C²−A)÷(D−B)|1679:24:i:(C−A)×B²÷D|167d:24:a:(B+D²)÷C−A|1688:24:w:D×(A+C−B)|168d:24:q:B×(D−A−C)|169' +
  'c:24:12:D×(C−A−B)|169d:24:u:A×B×(D−C)|16aa:24:4:D²÷(C−B)−A|16ab:24:4:B²−(D²−A)÷C|16ad:24:a:B×(A+D−C)|16bc:24:q' +
  ':(A+C)×D÷B|16bd:24:2:(A+C×D)÷B|16cd:24:o:(D−A)×C÷B|177c:24:c:D×(A+B÷C)|178b:24:c:C×(D−A−B)|178d:24:4:A+(D²−C)÷' +
  'B|179a:24:8:(C−A)×(D−B)|179b:24:c:(A+D)×(C−B)|179d:24:g:(B−A)×(D−C)|17ac:24:s:D×(C−A−B)|17ad:24:6:B+(A+D²)÷C|1' +
  '7bc:24:8:(C²−A)÷(D−B)|188a:24:o:C×(A+D−B)|188c:24:w:C×(D−A−B)|18aa:24:2:(C²+D²)÷B−A|18bd:24:i:B×(A+D−C)|18cd:2' +
  '4:a:C²÷(A+D−B)|19ac:24:a:D×(A+C−B)|19ad:24:g:D+(C²−A)÷B|19bb:24:8:(A+C)×(D−B)|19bc:24:u:D×(C−A×B)|19bd:24:8:(D' +
  '−A)×(C−B)|19cc:24:g:D×(C−A−B)|1aac:24:8:D×(A+B÷C)|1abc:24:k:D×(A+C−B)|1abd:24:2:D+C²÷(A+B)|1acd:24:m:C×(D−A−B)' +
  '|1bcd:24:10:C×(D−A×B)|2388:24:19:D×(C−A−B)|23ab:24:c:A×(D+C−B²)|244d:24:w:A×(D−B÷C)|25bd:24:n:B²−D÷(A+C)|266b:' +
  '24:g:A×(D+B÷C)|266d:24:i:A×(D−B÷C)|267b:24:j:A×(D+C−B)|2777:24:1u:(D²−B÷C)÷A|2799:24:g:(B²−C÷D)÷A|27bb:24:8:(B' +
  '²−C÷D)÷A|27cd:24:g:C+A×(D−B)|2889:24:q:C×(A+D−B)|288b:24:8:A×(D+B÷C)|28bd:24:e:A²×(B+C−D)|29ab:24:c:A×(D+C−B)|' +
  '29cd:24:g:C÷A×(D−B)|2aad:24:c:A×(D−B÷C)|2abd:24:9:A×(B+D−C)|2bcc:24:14:A×C×(D−B)|2ccd:24:14:A×B×(D−C)|333d:24:' +
  'u:(A+B)×(D−C²)|3368:24:2i:D×(A×B−C)|339d:24:i:(A+B)×(D−C)|33aa:24:8:A×(B²−C÷D)|33ac:24:i:D×(A+B²−C)|33dd:24:8:' +
  'A×(B²−C÷D)|3577:24:4:(A²−C)×(B+D)|35bc:24:m:D÷A×(C−B)|366b:24:m:(C+B×D)÷A|367b:24:a:B²−A×(D−C)|36bd:24:v:A×(B+' +
  'D−C)|377b:24:1:(D²−B×C)÷A|377c:24:8:D×(A−B÷C)|378a:24:8:C²−D×(B−A)|3799:24:a:(D+B×C)÷A|37bd:24:4:(D²−C²)÷(A²−B' +
  ')|388a:24:2:(B×D−C)÷A|38ab:24:c:A×B×(D−C)|399a:24:b:A×(B+C−D)|399d:24:8:(B−A)×(D−C)|39aa:24:4:A×(B−C÷D)|39ac:2' +
  '4:9:D×(A+B−C)|39dd:24:4:A×(B−C÷D)|3abd:24:s:A×(B+C−D)|3acc:24:q:D²÷(B−C÷A)|3bbd:24:8:(D²−C²)÷(B−A²)|3ccd:24:g:' +
  'C×(A+B−D)|3cdd:24:4:B×(A−C÷D)|444d:24:6:(A+B)×(C²−D)|4456:24:22:D×(C−A÷B)|448d:24:f:C×(A×B−D)|449a:24:u:B+D²÷(' +
  'C−A)|44bb:24:a:A×(C+D−B²)|4566:24:2a:A×C×(D−B)|457d:24:d:(B+C×D)÷A|4599:24:4:A×(B+C÷D)|459b:24:b:B×(A²−C)−D|45' +
  'bb:24:9:B×(C−A)−D|45bd:24:f:D+C×(B−A)|466b:24:2:B×(A²−D)−C|466d:24:12:B×(D−C²÷A)|468b:24:3:B²−A×(D−C)|46ab:24:' +
  'k:A×B×(D−C)|46cd:24:j:A×B×(D−C)|477c:24:5:A×(C²−B)−D²|488b:24:s:(C+B×D)÷A|48ab:24:l:B×(A+C−D)|48ad:24:6:A+C²÷(' +
  'D−B)|499d:24:8:(C²−B)÷(A²−D)|49ad:24:q:A×(B+C−D)|4bbc:24:5:D²÷(B+C−A²)|4bcc:24:2:C×(B−D²÷A²)|4ccd:24:2:B×(A²−D' +
  ')−C|559b:24:g:(C−A)×(D−B)|5668:24:q:C+B×(D−A)|5679:24:a:B+D×(C−A)|567b:24:l:B+(A+D²)÷C|5688:24:u:D×(A+B−C)|568' +
  'b:24:g:B×C²÷(A+D)|568c:24:j:B×D÷(C−A)|5699:24:w:D+A×(C−B)|569b:24:z:C×(A+D)÷B|569d:24:4:(D−A)×(C−B)|56bb:24:4:' +
  'B×(A−C÷D)|56bd:24:h:D+C×(B−A)|5779:24:4:(A+B)×(D−C)|578b:24:9:(B+D²−C)÷A|579c:24:r:D×(A+C)÷B|57bc:24:r:(C+D²)÷' +
  'A−B|588c:24:c:D²÷(A+B÷C)|58bd:24:c:B×(A+C−D)|58cc:24:2:C×(B−A)−D|59bd:24:c:(C−A)×(D−B)|59cc:24:g:D×(A+B−C)|5aa' +
  'd:24:2:(B×D−C)÷A|5bdd:24:c:(B²−C÷D)÷A|6678:24:s:A×(B²−D)÷C|6679:24:12:B×(A+C−D)|667a:24:a:B+A×(D−C)|6688:24:s:' +
  'B×D÷(C−A)|668b:24:o:B+A×(D−C)|668d:24:2:A×(D−C)−B|669a:24:u:D×(C−A)−B|669b:24:q:B×(A+C−D)|66ab:24:e:A×C²÷(B²−D' +
  ')|677a:24:5:A×(B+C−D)|6789:24:k:A×C÷(D−B)|679b:24:5:A×(C²−B×D)|679c:24:a:A×(B+C−D)|68bc:24:9:A×D÷(C−B)|69ac:24' +
  ':x:B×(C−A)−D|69bd:24:8:A+B×(D−C)|69dd:24:2:A×(D²÷C−B)|6acd:24:r:A×C÷(D−B)|777c:24:2i:D×(A+B)÷C|778b:24:5:C×(A+' +
  'B−D)|778d:24:a:(A+D²−C)÷B|779c:24:2:D×(C−B²÷A)|77ab:24:e:A+(B²+D²)÷C|77ac:24:3:D×(C²−A²−B²)|788b:24:e:B×(D−A)−' +
  'C|788d:24:k:C×(B+D)÷A|789a:24:6:B×C÷(D−A)|789b:24:2:B+(D²−C)÷A|789c:24:t:D×(A+C)÷B|789d:24:f:B×(A+C−D)|78aa:24' +
  ':7:D+A×(C−B)|78cc:24:c:D+C×(B−A)|78dd:24:a:D+(B²+C)÷A|799a:24:8:(C²−B)÷(D−A)|79bc:24:h:D×(A+C)÷B|79bd:24:4:(D²' +
  '−C²)÷(B−A)|79cd:24:7:C×(D²−A)÷B²|7aac:24:8:C+A×(D−B)|7abc:24:b:D²÷(A+B−C)|7abd:24:c:B+A×(D−C)|7acc:24:e:C×(B−A' +
  ')−D|7bbc:24:4:D²÷(A−B÷C)|7bcc:24:o:D²÷(A+B−C)|7ccc:24:o:A×(B+C)−D²|7ddd:24:c:(D²−B÷C)÷A|88aa:24:a:(D²+C²−A)÷B|' +
  '89ab:24:a:C+(D²−B)÷A|8aab:24:3:(C²+A²+B²)÷D|8aad:24:2:A×(D−C²÷B)|8abd:24:4:(D²−C²)÷(B−A)|8acd:24:9:B×C÷(D−A)|8' +
  'bcc:24:2:C×(B−A)−D|8bcd:24:j:(D²+B+C)÷A|8ccc:24:f:D²÷(B−A)−C|999c:24:30:D×(A+B)÷C|9abb:24:2:C+(A+D²)÷B|9abd:24' +
  ':d:D+C×(B−A)|9acc:24:e:D+C×(B−A)|9bbd:24:8:(D²−C²)÷(B−A)|9bcd:24:a:C×(A+D)÷B|9ccd:24:2:C²÷(D−A)−B|abcc:24:s:D+' +
  'C×(B−A)'
const SQUARE_24_PUZZLES = readSolvedTable(SQUARE_24_TABLE)

/** The stored witness uses canonical tile positions; randomise the visible positions each time. */
function shuffledPuzzle(puzzle: Puzzle, rng: Rng): Puzzle {
  const order = rng.shuffle(puzzle.tiles.map((_, i) => i))
  return {
    ...puzzle,
    tiles: order.map((i) => puzzle.tiles[i]),
    witness: puzzle.witness.map((t) => t.kind === 'num' ? num(t.value, order.indexOf(t.tile)) : t),
  }
}

function square24Puzzle(p: MakeNumberBand, rng: Rng): Puzzle {
  const candidates = SQUARE_24_PUZZLES.map((f, i) => [i, f] as [number, typeof f])
  return shuffledPuzzle(chooseTarget(candidates, p.hard, rng)![1], rng)
}

/** A non-whole value on every way: from the table, numbers to 9 or to 13 as the band says. */
function fractionPuzzle(p: MakeNumberBand, rng: Rng): Puzzle {
  if (p.square) {
    const pool = SQUARE_FRACTION_PUZZLES.filter((f) => Math.max(...f.tiles) <= p.maxTile && f.tiles.every((x) => x >= p.minTile))
    return shuffledPuzzle(rng.pick(pool), rng)
  }
  const allow = { times: true, divide: true, square: p.square }
  const pool = makeNumberFractionPuzzles(p.square).filter((f) => Math.max(...f.tiles) <= p.maxTile && f.tiles.every((x) => x >= p.minTile))
  const f = rng.pick(pool)
  let ways = 0
  eachTree(f.tiles, allow, (t) => {
    if (t.d === 1 && t.n === f.target) ways++
  })
  const w = bestTree(f.tiles, f.target, allow, false, rng)!
  const order = rng.shuffle(f.tiles.map((_, i) => i))
  return { tiles: order.map((i) => f.tiles[i]), target: f.target, witness: shownWitness(w, order), ways }
}

function makePuzzle(p: MakeNumberPlan, rng: Rng): Puzzle {
  const gen = (q: MakeNumberBand): Puzzle | null => {
    if (q.kind === 'fraction') return fractionPuzzle(q, rng)
    if (q.order === 'fixed') return fixedPuzzle(q, rng)
    if (!q.brackets) return anyOrderPuzzle(q, rng)
    return bracketPuzzle(q, rng)
  }
  // The hardest pick can fail on a narrow band; the same band at any target never does in practice.
  const got = gen(p) ?? gen({ ...p, hard: 0 })
  if (got) return got
  // Never reached in the tests' sampling; a valid puzzle all the same.
  const tiles = [rng.int(5, 9), rng.int(1, 4), rng.int(1, 4)]
  return { tiles, target: tiles[0] - tiles[1] + tiles[2], witness: [num(tiles[0], 0), op('−'), num(tiles[1], 1), op('+'), num(tiles[2], 2)], ways: 1 }
}

// ── the expression as it is built ───────────────────────────────────────────

const expectsOperand = (expr: readonly MakeToken[]) => {
  const last = expr[expr.length - 1]
  return !last || (last.kind === 'op' && last.op !== ')' && last.op !== '²')
}
const openBrackets = (expr: readonly MakeToken[]) => expr.reduce((n, t) => n + (t.kind === 'op' ? (t.op === '(' ? 1 : t.op === ')' ? -1 : 0) : 0), 0)
const usedTiles = (expr: readonly MakeToken[]) => new Set(expr.flatMap((t) => (t.kind === 'num' ? [t.tile] : [])))

// ── the game ────────────────────────────────────────────────────────────────

export interface MakeNumberState {
  /** In the order shown. */
  tiles: number[]
  target: number
  /** 'fixed': the tiles place themselves in order; only signs are tapped. */
  order: 'fixed' | 'any'
  ops: MakeOp[]
  witness: MakeToken[]
  expr: MakeToken[]
  preview: boolean
  triesLeft: number
  tries: number
  wrong: number
  lastValue: string | null
  solved: boolean
  timedOut: boolean
  limitMs: number
  tags: string[]
  /** The ladder band this trial deals (see makeNumberPlan). */
  band: number
  kind: MakeNumberKind
  /** Ways to make the target, as the generator counted them. */
  ways: number
  /** The rules open on this trial — ctx.recent's carry. */
  carry: string
}

const over = (s: MakeNumberState) => s.solved || s.triesLeft <= 0 || s.timedOut

const idx = {
  op: (s: MakeNumberState, i: number) => s.tiles.length + i,
  undo: (s: MakeNumberState) => s.tiles.length + s.ops.length,
  clear: (s: MakeNumberState) => s.tiles.length + s.ops.length + 1,
  submit: (s: MakeNumberState) => s.tiles.length + s.ops.length + 2,
}

function opEnabled(s: MakeNumberState, o: MakeOp): boolean {
  const want = expectsOperand(s.expr)
  if (o === '²') return s.expr.at(-1)?.kind === 'num'
  if (s.order === 'fixed') return !want && usedTiles(s.expr).size < s.tiles.length
  if (o === '(') return want && usedTiles(s.expr).size < s.tiles.length
  if (o === ')') return !want && openBrackets(s.expr) > 0
  return !want
}

const complete = (s: MakeNumberState) => !expectsOperand(s.expr) && openBrackets(s.expr) === 0 && usedTiles(s.expr).size === s.tiles.length
const start = (s: Pick<MakeNumberState, 'order' | 'tiles'>): MakeToken[] => (s.order === 'fixed' ? [num(s.tiles[0], 0)] : [])

const signature = (order: 'fixed' | 'any', tiles: readonly number[], target: number) =>
  order === 'fixed' ? `mn:f:${tiles.join(',')}=${target}` : `mn:${[...tiles].sort((a, b) => a - b).join(',')}=${target}`

export const makeNumber: BrainGameDef<MakeNumberState> = {
  id: 'makeNumber',
  create(level, rng, ctx) {
    const p = makeNumberPlan(level, ctx)
    const puzzle = makePuzzle(p, rng)
    const ops: MakeOp[] = ['+', '−', ...(p.times ? (['×'] as const) : []), ...(p.divide ? (['÷'] as const) : []), ...(p.square ? (['²'] as const) : []), ...(p.brackets ? (['(', ')'] as const) : [])]
    const tags: string[] = []
    if (puzzle.tiles.length >= 4) tags.push('makeNumber.tiles4')
    if (p.times) tags.push('makeNumber.multiply')
    if (p.divide) tags.push('makeNumber.divide')
    if (p.square) tags.push('makeNumber.square')
    if (p.order === 'any') tags.push('makeNumber.anyOrder')
    if (p.brackets) tags.push('makeNumber.brackets')
    if (p.target24) tags.push('makeNumber.target24')
    if (p.kind === 'fraction') tags.push('makeNumber.fraction')
    const s: MakeNumberState = {
      tiles: puzzle.tiles,
      target: puzzle.target,
      order: p.order,
      ops,
      witness: puzzle.witness,
      expr: [],
      preview: p.preview,
      triesLeft: p.tries,
      tries: p.tries,
      wrong: 0,
      lastValue: null,
      solved: false,
      timedOut: false,
      limitMs: p.limitMs,
      tags,
      band: p.band,
      kind: p.kind,
      ways: puzzle.ways,
      carry: p.open,
    }
    return { ...s, expr: start(s) }
  },
  pendingMs: () => null,
  advance: (s) => s,
  acceptsInput: (s) => !over(s),
  tap(s, i) {
    if (over(s) || !Number.isInteger(i)) return s
    const edit = (expr: MakeToken[]): MakeNumberState => ({ ...s, expr, lastValue: null })
    const fixed = s.order === 'fixed'
    if (i >= 0 && i < s.tiles.length) {
      // Fixed order places the tiles itself.
      if (fixed || !expectsOperand(s.expr) || usedTiles(s.expr).has(i)) return s
      return edit([...s.expr, num(s.tiles[i], i)])
    }
    if (i >= idx.op(s, 0) && i < idx.op(s, s.ops.length)) {
      const o = s.ops[i - idx.op(s, 0)]
      if (!opEnabled(s, o)) return s
      if (!fixed || o === '²') return edit([...s.expr, op(o)])
      const next = usedTiles(s.expr).size
      return edit([...s.expr, op(o), num(s.tiles[next], next)])
    }
    const base = start(s)
    if (i === idx.undo(s)) return s.expr.length > base.length ? edit(s.expr.slice(0, fixed && s.expr.at(-1)?.kind === 'num' ? -2 : -1)) : s
    if (i === idx.clear(s)) return s.expr.length > base.length ? edit(base) : s
    if (i === idx.submit(s)) {
      if (!complete(s)) return s
      const v = evaluate(s.expr)
      if (v && v.d === 1 && v.n === s.target) return { ...s, solved: true }
      return { ...s, triesLeft: s.triesLeft - 1, wrong: s.wrong + 1, lastValue: v ? formatFrac(v) : '?' }
    }
    return s
  },
  timeout: (s) => (over(s) ? s : { ...s, timedOut: true }),
  outcome(s) {
    if (!over(s)) return null
    return { correct: s.solved, accuracy: s.solved ? 1 : 0, mistakes: s.wrong }
  },
  timeLimitMs: (s) => s.limitMs,
  view(s): MakeNumberView {
    const done = over(s)
    const used = usedTiles(s.expr)
    const want = expectsOperand(s.expr)
    const fixed = s.order === 'fixed'
    const view: MakeNumberView = {
      kind: 'makeNumber',
      prompt: { key: fixed ? 'play.makeNumberSigns' : 'play.makeNumberTarget', params: { target: s.target } },
      target: s.target,
      order: s.order,
      tiles: s.tiles.map((value, i) => ({ value, index: i, used: used.has(i), disabled: fixed || done || used.has(i) || !want })),
      ops: s.ops.map((o, i) => ({ op: o, index: idx.op(s, i), disabled: done || !opEnabled(s, o) })),
      undo: { index: idx.undo(s), disabled: done || s.expr.length <= start(s).length },
      clear: { index: idx.clear(s), disabled: done || s.expr.length <= start(s).length },
      submit: { index: idx.submit(s), disabled: done || !complete(s) },
      expression: s.expr.map((t) => ({ ...t })),
      tries: { left: Math.max(0, s.triesLeft), total: s.tries },
      locked: done,
    }
    if (s.preview && s.expr.length > 0 && !want && openBrackets(s.expr) === 0) {
      const v = evaluate(s.expr)
      if (v) view.preview = formatFrac(v)
    }
    if (s.lastValue !== null) view.lastValue = s.lastValue
    if (done && !s.solved) {
      const line = s.witness.map((t) => (t.kind === 'num' ? String(t.value) : t.op)).join(' ')
      view.reveal = { lines: [`${line} = ${s.target}`] }
    }
    return view
  },
  signature: (s) => signature(s.order, s.tiles, s.target),
  solution(s) {
    if (over(s)) return null
    const tokenIndex = (t: MakeToken) => (t.kind === 'num' ? t.tile : idx.op(s, s.ops.indexOf(t.op)))
    const same = (a: MakeToken, b: MakeToken) => (a.kind === 'num' ? b.kind === 'num' && a.tile === b.tile : b.kind === 'op' && a.op === b.op)
    const prefix = s.expr.length <= s.witness.length && s.expr.every((t, i) => same(t, s.witness[i]))
    const from = prefix ? s.expr.length : start(s).length
    // Fixed order: only the signs are tapped (each brings its tile).
    const rest = s.witness.slice(from).filter((t) => s.order === 'any' || t.kind === 'op').map(tokenIndex)
    return [...(prefix ? [] : [idx.clear(s)]), ...rest, idx.submit(s)]
  },
  mechanics: (s) => s.tags,
  maxLevel: () => MAKE_NUMBER_MAX_LEVEL,
  trialInfo: (s) => ({ kind: `b${s.band}`, carry: s.carry }),
}
