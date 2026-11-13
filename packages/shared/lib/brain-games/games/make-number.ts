import type { BrainGameDef, CreateContext, MakeNumberView, MakeOp, MakeToken } from '../types'
import type { Rng } from '../rng'

/**
 * Make the Number (숫자 만들기) — make the target from the number tiles, each used exactly once,
 * with + − × ÷ (later brackets), like the 24 game. Owner 2026-11-13: «숫자 만들기 가능한가?», and for
 * every new game «새로운 게임은 처음부터 내 피드백 수준으로 만들어라».
 *
 * The ladder — each new idea starts small again (three numbers) with a rule card, then more numbers
 * or fewer ways to make it, then less time:
 *   L1-3   + −, numbers in a FIXED order: choose the sign between them   3 / 4 / 5 numbers
 *   L4-6   + − × (rule) in fixed order: × before + −                       3 / 4 / 5 numbers
 *   L7-9   + − × ÷ (rule) in fixed order                                   3 / 4 / 5 numbers
 *   L10-12 any order (rule): pick the order too                            3 / 4 / 4 numbers (to 13)
 *   L13-15 brackets (rule): no way without them                            3 / 4 / 4 numbers
 *   L16    24 from four numbers up to 13, brackets needed (the classic 24 game)
 *   L17-21 a fraction on the way (rule): every way passes a non-whole value — 8 ÷ (3 − 8 ÷ 3) = 24 —
 *          the clock tightening from 120 s to 45 s, three tries then two
 * In fixed order the numbers place themselves: the player taps the sign between them and the next
 * number follows (`view.order`). The running value is shown as a help up to L4.
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

export type MakeNumberKind = 'plus' | 'times' | 'divide' | 'anyOrder' | 'brackets' | 'make24' | 'fraction'
export type MakeNumberRule = 'multiply' | 'divide' | 'anyOrder' | 'brackets' | 'fraction'

export interface MakeNumberBand {
  kind: MakeNumberKind
  tiles: number
  /** 'fixed': the numbers stay in the order shown and place themselves; the player picks the signs. */
  order: 'fixed' | 'any'
  /** × available (its rule), ÷ available, brackets available. */
  times: boolean
  divide: boolean
  brackets: boolean
  /** What every way to make the target must use: the band's new idea. */
  need: '×' | '÷' | '()' | null
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

const KIND: Record<MakeNumberKind, Pick<MakeNumberBand, 'order' | 'times' | 'divide' | 'brackets' | 'need' | 'fraction' | 'target24'>> = {
  plus: { order: 'fixed', times: false, divide: false, brackets: false, need: null, fraction: false, target24: false },
  times: { order: 'fixed', times: true, divide: false, brackets: false, need: '×', fraction: false, target24: false },
  divide: { order: 'fixed', times: true, divide: true, brackets: false, need: '÷', fraction: false, target24: false },
  anyOrder: { order: 'any', times: true, divide: true, brackets: false, need: null, fraction: false, target24: false },
  brackets: { order: 'any', times: true, divide: true, brackets: true, need: '()', fraction: false, target24: false },
  make24: { order: 'any', times: true, divide: true, brackets: true, need: '()', fraction: false, target24: true },
  fraction: { order: 'any', times: true, divide: true, brackets: true, need: null, fraction: true, target24: false },
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
  row('plus', 3, 1, 9, 30, true, 3, 45_000, 0),
  row('plus', 4, 1, 9, 40, true, 3, 60_000, 0.5),
  row('plus', 5, 1, 9, 45, true, 3, 70_000, 1),
  row('times', 3, 2, 9, 99, true, 3, 55_000, 0),
  row('times', 4, 2, 9, 99, false, 3, 65_000, 0.5),
  row('times', 5, 2, 9, 99, false, 3, 80_000, 1),
  row('divide', 3, 2, 9, 99, false, 2, 60_000, 0),
  row('divide', 4, 2, 9, 99, false, 2, 75_000, 0.5),
  row('divide', 4, 2, 9, 99, false, 2, 65_000, 1),
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
  anyOrder: 'makeNumber.anyOrder',
  brackets: 'makeNumber.brackets',
  fraction: 'makeNumber.fraction',
}

/** Where each rule's first band is (mechanics.ts `from`). */
export const MAKE_NUMBER_RULE_START: Readonly<Record<MakeNumberRule, number>> = { multiply: 4, divide: 7, anyOrder: 10, brackets: 13, fraction: 17 }

const RULES: readonly MakeNumberRule[] = ['multiply', 'divide', 'anyOrder', 'brackets', 'fraction']
const LETTER: Readonly<Record<MakeNumberRule, string>> = { multiply: 'x', divide: 'd', anyOrder: 'o', brackets: 'b', fraction: 'f' }
const NEEDS: Readonly<Record<MakeNumberKind, readonly MakeNumberRule[]>> = {
  plus: [],
  times: ['multiply'],
  divide: ['multiply', 'divide'],
  anyOrder: ['multiply', 'divide', 'anyOrder'],
  brackets: ['multiply', 'divide', 'anyOrder', 'brackets'],
  make24: ['multiply', 'divide', 'anyOrder', 'brackets'],
  fraction: ['multiply', 'divide', 'anyOrder', 'brackets', 'fraction'],
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
  if ((trial === 'counted' || trial === 'intro') && recent.length > 0) {
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
  if (child === null) return false
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
export function eachTree(tiles: readonly number[], allow: { times: boolean; divide: boolean; flatOnly?: boolean }, visit: (t: MakeTree) => void): void {
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
  walk(tiles.map((v, i) => leaf(v, i)))
}

/** A tree written out with as few brackets as it needs; leaves carry `tileAt[leaf.tile]` as their tile. */
export function treeTokens(t: MakeTree, tileAt: (tile: number) => number = (x) => x): MakeToken[] {
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

function treeStats(tiles: readonly number[], allow: { times: boolean; divide: boolean; flatOnly?: boolean }, maxTarget: number): Map<number, TreeStat> {
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
  return out
}

/** The witness: among the trees making `target` that pass `ok`, the fewest brackets (ties at random). */
function bestTree(tiles: readonly number[], target: number, allow: { times: boolean; divide: boolean; flatOnly?: boolean }, ok: (t: MakeTree) => boolean, rng: Rng): MakeTree | null {
  let best: MakeTree[] = []
  let fewest = Infinity
  eachTree(tiles, allow, (t) => {
    if (t.d !== 1 || t.n !== target || !ok(t)) return
    const k = brackets(treeTokens(t))
    if (k < fewest) {
      fewest = k
      best = [t]
    } else if (k === fewest) best.push(t)
  })
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

export interface FractionPuzzle {
  tiles: number[]
  target: number
}

let fractionPuzzles: FractionPuzzle[] | null = null

export function makeNumberFractionPuzzles(): readonly FractionPuzzle[] {
  if (!fractionPuzzles) {
    const out: FractionPuzzle[] = []
    for (let i = 0; i + 6 <= FRACTION_TABLE.length; i += 6) {
      const s = FRACTION_TABLE.slice(i, i + 6)
      out.push({ tiles: [0, 1, 2, 3].map((k) => parseInt(s[k], 14)), target: Number(s.slice(4)) })
    }
    fractionPuzzles = out
  }
  return fractionPuzzles
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
    const by = new Map<number, { ways: number; clean: MakeOp[][]; bad: boolean }>()
    for (const signs of signChoices(tiles.length - 1, ops)) {
      const v = fixedValue(tiles, signs)
      if (!v || v.d !== 1 || v.n < 1 || v.n > p.maxTarget) continue
      let s = by.get(v.n)
      if (!s) {
        s = { ways: 0, clean: [], bad: false }
        by.set(v.n, s)
      }
      s.ways++
      // Every way must use the band's new idea: a − (the plain sum is no puzzle), a ×, a ÷.
      if (p.kind === 'plus' && !signs.includes('−')) s.bad = true
      if (p.need === '×' && !signs.includes('×')) s.bad = true
      if (p.need === '÷' && !signs.includes('÷')) s.bad = true
      if (v.clean) s.clean.push(signs)
    }
    const valid = [...by].filter(([, s]) => !s.bad && s.clean.length > 0)
    // The hardest bands ask for the one way there is.
    const pick = chooseTarget(p.hard >= 1 ? valid.filter(([, s]) => s.ways === 1) : valid, p.hard, rng)
    if (!pick) continue
    const signs = rng.pick(pick[1].clean)
    const witness: MakeToken[] = [num(tiles[0], 0)]
    signs.forEach((o, i) => witness.push(op(o), num(tiles[i + 1], i + 1)))
    return { tiles, target: pick[0], witness, ways: pick[1].ways }
  }
  return null
}

/** A shown order the target cannot be made in as it stands (any-order bands: the order is part of the puzzle). */
function unhelpfulOrder(tiles: readonly number[], target: number, ops: readonly MakeOp[], rng: Rng): number[] | null {
  const perms: number[][] = []
  const permute = (prefix: number[], left: number[]) => {
    if (left.length === 0) perms.push(prefix)
    left.forEach((x, i) => permute([...prefix, x], [...left.slice(0, i), ...left.slice(i + 1)]))
  }
  permute([], tiles.map((_, i) => i))
  for (const order of rng.shuffle(perms)) {
    const shown = order.map((i) => tiles[i])
    let makes = false
    for (const signs of signChoices(shown.length - 1, ops)) {
      const v = fixedValue(shown, signs)
      if (v && v.d === 1 && v.n === target) {
        makes = true
        break
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
  const allow = { times: true, divide: true, flatOnly: true }
  const ops: MakeOp[] = ['+', '−', '×', '÷']
  for (let attempt = 0; attempt < 200; attempt++) {
    const tiles = draw(p, rng)
    const stats = treeStats(tiles, allow, p.maxTarget)
    const total = sum(tiles)
    let valid = [...stats].filter(([t, s]) => s.flatClean && t !== total).map(([t, s]) => [t, { ways: s.flatWays }] as [number, { ways: number }])
    for (let k = 0; k < 4 && valid.length > 0; k++) {
      const pick = chooseTarget(valid, p.hard, rng)!
      const order = unhelpfulOrder(tiles, pick[0], ops, rng)
      if (!order) {
        valid = valid.filter(([t]) => t !== pick[0])
        continue
      }
      const w = bestTree(tiles, pick[0], allow, (t) => t.clean, rng)!
      return { tiles: order.map((i) => tiles[i]), target: pick[0], witness: shownWitness(w, order), ways: pick[1].ways }
    }
  }
  return null
}

/** Any order with brackets, and no way without them (24 every time on the 24 band). */
function bracketPuzzle(p: MakeNumberBand, rng: Rng): Puzzle | null {
  const allow = { times: true, divide: true }
  for (let attempt = 0; attempt < 400; attempt++) {
    const tiles = draw(p, rng)
    const stats = treeStats(tiles, allow, p.maxTarget)
    const valid = [...stats].filter(([t, s]) => s.flatWays === 0 && s.clean && (!p.target24 || t === 24))
    const pick = chooseTarget(valid, p.hard, rng)
    if (!pick) continue
    const w = bestTree(tiles, pick[0], allow, (t) => t.clean, rng)!
    const order = rng.shuffle(tiles.map((_, i) => i))
    return { tiles: order.map((i) => tiles[i]), target: pick[0], witness: shownWitness(w, order), ways: pick[1].ways }
  }
  return null
}

/** A non-whole value on every way: from the table, numbers to 9 or to 13 as the band says. */
function fractionPuzzle(p: MakeNumberBand, rng: Rng): Puzzle {
  const allow = { times: true, divide: true }
  const pool = makeNumberFractionPuzzles().filter((f) => Math.max(...f.tiles) <= p.maxTile && f.tiles.every((x) => x >= p.minTile))
  const f = rng.pick(pool)
  let ways = 0
  eachTree(f.tiles, allow, (t) => {
    if (t.d === 1 && t.n === f.target) ways++
  })
  const w = bestTree(f.tiles, f.target, allow, () => true, rng)!
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
  return !last || (last.kind === 'op' && last.op !== ')')
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
    const ops: MakeOp[] = ['+', '−', ...(p.times ? (['×'] as const) : []), ...(p.divide ? (['÷'] as const) : []), ...(p.brackets ? (['(', ')'] as const) : [])]
    const tags: string[] = []
    if (puzzle.tiles.length >= 4) tags.push('makeNumber.tiles4')
    if (puzzle.tiles.length >= 5) tags.push('makeNumber.tiles5')
    if (p.times) tags.push('makeNumber.multiply')
    if (p.divide) tags.push('makeNumber.divide')
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
      if (!fixed) return edit([...s.expr, op(o)])
      const next = usedTiles(s.expr).size
      return edit([...s.expr, op(o), num(s.tiles[next], next)])
    }
    const base = start(s)
    if (i === idx.undo(s)) return s.expr.length > base.length ? edit(s.expr.slice(0, fixed ? -2 : -1)) : s
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
