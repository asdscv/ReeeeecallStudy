import type { BrainGameDef, CellTone, CreateContext, RecentTrial, SetAttribute, SetCard, SetColor, SetFill, SetMatchView, SetShape } from '../types'
import type { Rng } from '../rng'

/**
 * Set Match (합 찾기) — find three cards where every attribute is all the same or all different.
 *
 * The owner's quality bar for the new games (2026-11-13, «새로운 게임은 처음부터 내 피드백 수준으로
 * 만들어라»): level 1 is easy and a capable adult meets real challenge within a few trials; every
 * level changes the board — more cards, fewer sets to find, look-alike decoys, or less time; each
 * new attribute starts small again (4 cards → 6 → 9 → 12) with a rule card; the top is hard enough
 * that a sharp adult loses there. What makes a board hard is read off the board itself:
 *
 *   - cards: more pairs to check (a set is found pair by pair: the two cards fix the third).
 *   - sets: how many the board holds, exactly — one set among 12 cards is three times the search of
 *     three, and the generator deals the count the band asks for (`sets`), not what chance gives
 *     (12 random cards with three attributes hold about nine sets).
 *   - decoys: «near sets», triples that fail on a single attribute — few on teaching boards, as many
 *     as the generator can find at the top, so a glance is never enough.
 *   - spread: how many attributes the hidden set has all different (the hardest sets to see).
 *   - the clock, generous at the bottom (25 s for four cards) and tight at the top.
 *
 * The ladder (band b is SET_MATCH_LADDER[b − 1]):
 *   L1-3   shape · count             4 cards, one set → 6 cards, three sets → 6 cards, two sets, faster
 *   L4-7   + colour (rule)           4 / 6 / 9 / 12 cards (one / two / two / four sets — the fewest 12 can hold)
 *   L8-12  + fill (rule) — full SET  4 / 6 / 9 / 12 / 12 cards (one / one / two / three / two sets)
 *   L13-15 exactly one set among 12, more decoys, the clock tightening
 *   L16-17 «없음» (rule): a quarter of boards hold no set — from 9 cards again, then 12
 *   L18-24 15 cards, one set or none (up to a third), the clock tightening to 30 s
 *
 * Two attributes can only make 9 different cards (a 9-card board is every card, and every pair
 * completes a set), so the shape-and-count stage stops at six cards and its third level is the
 * same six cards with fewer sets and less time.
 *
 * Unseen rules (ctx.blockRules — placement, practice, the card budget) take their attribute off the
 * board. Past the last band that attribute count can fill, the board stays that stage's hardest and
 * only the clock keeps tightening (18% a level): a blocked placement trial at level 12 is six
 * shape-and-count cards on a 4 s clock, not twelve cards it cannot draw — so placement still tells
 * a quick player from a slow one. A rule a round meets for the first time above its own start
 * (placement handed over high, a card the round had to wait for) opens on its first, smallest board,
 * and the board that brings colour or fill hides a set with that attribute all different — the new
 * rule is on show the first time, not a set the old rules alone would have made.
 */

export type SetDecoys = 'few' | 'some' | 'many'

export interface SetMatchBand {
  /** The attributes that change from card to card; the rest are fixed (black, solid). */
  vary: readonly SetAttribute[]
  cards: number
  /** Sets on a board that has any, exactly (fewer means a longer search). */
  sets: number
  /** The «exactly one set» stage (board notice 'setMatch.oneSet'); 4 attributes, 9+ cards. */
  oneSet: boolean
  /** Share of boards with no set at all («없음»; 4 attributes only). */
  none: number
  /** The band's clock at its first level, ms. */
  parMs: number
  /** Near-miss pressure: 'few' on teaching boards, 'many' at the top (the most of six candidates). */
  decoys: SetDecoys
  /** A one-set board's set has at least this many attributes all different. */
  spread: number
}

const A2: readonly SetAttribute[] = ['shape', 'count']
const A3: readonly SetAttribute[] = ['shape', 'count', 'color']
const A4: readonly SetAttribute[] = ['shape', 'count', 'color', 'fill']

interface RowOptions {
  oneSet?: boolean
  none?: number
  decoys?: SetDecoys
  spread?: number
}
const row = (vary: readonly SetAttribute[], cards: number, sets: number, parMs: number, o: RowOptions = {}): SetMatchBand => ({
  vary,
  cards,
  sets,
  oneSet: o.oneSet ?? false,
  none: o.none ?? 0,
  parMs,
  decoys: o.decoys ?? 'some',
  spread: o.spread ?? 1,
})
const TOP = { oneSet: true, decoys: 'many', spread: 3 } as const

/** Band b is SET_MATCH_LADDER[b − 1]. Clocks are model values (EVIDENCE §4.5), checked by the persona model in brain-set-match-ladder.test.ts. */
export const SET_MATCH_LADDER: readonly SetMatchBand[] = [
  row(A2, 4, 1, 25_000, { decoys: 'few' }),
  row(A2, 6, 3, 30_000),
  row(A2, 6, 2, 24_000, { decoys: 'many' }),
  // Colour — a rule card, back to four cards.
  row(A3, 4, 1, 30_000, { decoys: 'few' }),
  row(A3, 6, 2, 40_000),
  row(A3, 9, 2, 65_000),
  row(A3, 12, 4, 52_000, { decoys: 'many' }),
  // Fill — a rule card, back to four cards: the full game.
  row(A4, 4, 1, 35_000, { decoys: 'few' }),
  row(A4, 6, 1, 45_000),
  row(A4, 9, 2, 60_000),
  row(A4, 12, 3, 75_000),
  row(A4, 12, 2, 72_000),
  // Exactly one set.
  row(A4, 12, 1, 100_000, { oneSet: true, spread: 2 }),
  row(A4, 12, 1, 85_000, TOP),
  row(A4, 12, 1, 72_000, TOP),
  // «없음» — a rule card, back to nine cards.
  row(A4, 9, 1, 65_000, { ...TOP, none: 0.25 }),
  row(A4, 12, 1, 80_000, { ...TOP, none: 0.25 }),
  // Fifteen cards: only the clock and the empty share climb.
  row(A4, 15, 1, 90_000, { ...TOP, none: 0.25 }),
  row(A4, 15, 1, 76_000, { ...TOP, none: 0.3 }),
  row(A4, 15, 1, 64_000, { ...TOP, none: 0.3 }),
  row(A4, 15, 1, 54_000, { ...TOP, none: 1 / 3 }),
  row(A4, 15, 1, 45_000, { ...TOP, none: 1 / 3 }),
  row(A4, 15, 1, 37_000, { ...TOP, none: 1 / 3 }),
  row(A4, 15, 1, 30_000, { ...TOP, none: 1 / 3 }),
]

export const SET_MATCH_MAX_LEVEL = SET_MATCH_LADDER.length

/** Where each rule starts: its first band, the smallest board of its stage. */
export const SET_MATCH_RULE_START = { color: 4, fill: 8, none: 16 } as const

/** Within a band the clock tightens to this share of its par before the board changes. */
const IN_BAND = 0.8
/** Past what a blocked attribute count can draw, the clock alone tightens this much a level … */
const SUBSTITUTE_RATE = 0.82
/** … to a floor (two attributes: six cards; three: twelve). */
const SUBSTITUTE_FLOOR_MS: Record<number, number> = { 2: 2_000, 3: 8_000 }

const clampLevel = (level: number) => (Number.isFinite(level) ? Math.min(SET_MATCH_MAX_LEVEL, Math.max(1, level)) : 1)

/** Same board kind, only the clock differs: the clock runs on smoothly from one band into the next. */
const sameBoard = (a: SetMatchBand, b: SetMatchBand) => a.vary.length === b.vary.length && a.cards === b.cards && a.sets === b.sets

/** A band's clock at the end of its last level. */
function bandEndMs(b: number): number {
  const at = SET_MATCH_LADDER[b - 1]
  const next = SET_MATCH_LADDER[b]
  return next && sameBoard(at, next) ? next.parMs : at.parMs * IN_BAND
}

/**
 * The ladder's clock at a level: the band's par at its first level, tightening geometrically to
 * the next band's par when only the clock changes there (no saw-tooth on clock-only bands), else to
 * 80% of its own par before the board grows.
 */
export function setMatchLimitMs(level: number): number {
  const lv = clampLevel(level)
  const b = Math.floor(lv)
  const par = SET_MATCH_LADDER[b - 1].parMs
  return Math.round(par * (bandEndMs(b) / par) ** (lv - b))
}

// ── planning a trial: blocked rules, substitutes, rules arriving ─────────────

export interface SetMatchPlan extends SetMatchBand {
  /** The band whose board this trial deals (a substitute's or an arriving rule's, else the level's). */
  band: number
  limitMs: number
  /** The rules open on this board: 'l' colour, 'f' fill, 'n' «없음» — carried in ctx.recent. */
  open: string
  /** The attribute this board introduces (colour or fill arriving): its set has it all different, so the new rule is on show. */
  feature: SetAttribute | null
}

const RULE_LETTER: Record<keyof typeof SET_MATCH_RULE_START, string> = { color: 'l', fill: 'f', none: 'n' }

/** The rule a board opens though the round has not shown it, above the rule's own start (see the header). */
function arrivingRule(recent: readonly RecentTrial[], open: string): keyof typeof SET_MATCH_RULE_START | null {
  if (recent.length === 0) return null
  const met = (letter: string) => recent.some((r) => r.carry === undefined || r.carry.split('|')[0].includes(letter))
  let found: keyof typeof SET_MATCH_RULE_START | null = null
  for (const rule of ['color', 'fill', 'none'] as const) {
    if (open.includes(RULE_LETTER[rule]) && !met(RULE_LETTER[rule])) found = rule
  }
  return found
}

/** What a trial at this level deals, given the round's blocked rules and its last trials. */
export function setMatchPlan(level: number, ctx: Pick<CreateContext, 'blockRules' | 'trialKind' | 'recent'>): SetMatchPlan {
  const lv = clampLevel(level)
  const b = Math.floor(lv)
  const at = SET_MATCH_LADDER[b - 1]
  const blocked = (rule: string) => (ctx.blockRules ?? []).includes(`setMatch.${rule}`)
  const vary = at.vary.filter((a) => !(a === 'color' && blocked('color')) && !(a === 'fill' && blocked('fill')))
  const noneOpen = at.none > 0 && vary.length === 4 && !blocked('none')
  const open = `${vary.includes('color') ? 'l' : ''}${vary.includes('fill') ? 'f' : ''}${noneOpen ? 'n' : ''}`

  const trial = ctx.trialKind ?? 'counted'
  const rule = trial === 'counted' || trial === 'intro' ? arrivingRule(ctx.recent ?? [], open) : null
  const feature: SetAttribute | null = rule === 'color' || rule === 'fill' ? rule : null
  if (rule && b > SET_MATCH_RULE_START[rule]) {
    const start = SET_MATCH_RULE_START[rule]
    const first = SET_MATCH_LADDER[start - 1]
    const startVary = first.vary.filter((a) => vary.includes(a))
    const opened = `${startVary.includes('color') ? 'l' : ''}${startVary.includes('fill') ? 'f' : ''}${rule === 'none' ? 'n' : ''}`
    return { ...first, vary: startVary, none: rule === 'none' ? first.none : 0, band: start, limitMs: setMatchLimitMs(start), open: opened, feature }
  }

  if (vary.length < at.vary.length) {
    // The stage's hardest board for this many attributes, then the clock alone.
    let last = b
    while (last > 1 && SET_MATCH_LADDER[last - 1].vary.length > vary.length) last--
    const sub = SET_MATCH_LADDER[last - 1]
    const ms = bandEndMs(last) * SUBSTITUTE_RATE ** Math.max(0, lv - (last + 1))
    return { ...sub, vary, oneSet: false, none: 0, band: last, limitMs: Math.round(Math.max(SUBSTITUTE_FLOOR_MS[vary.length] ?? 0, ms)), open, feature: null }
  }

  // «없음» blocked: the same board without the button (exactly one set), at the same clock.
  return { ...at, vary, none: noneOpen ? at.none : 0, band: b, limitMs: setMatchLimitMs(lv), open, feature }
}

/** The ladder's band for a level, with the round's unseen rules swapped out (ctx.blockRules). */
export function setMatchBand(level: number, blockRules: readonly string[] = []): SetMatchPlan {
  return setMatchPlan(level, { blockRules, trialKind: 'counted', recent: [] })
}

// ── the board's shape on this screen ─────────────────────────────────────────

/** [cols, rows] for a board of n cards, portrait and landscape. */
const SHAPES: Record<number, readonly (readonly [number, number])[]> = {
  4: [[2, 2]],
  6: [[2, 3], [3, 2]],
  9: [[3, 3]],
  12: [[3, 4], [4, 3]],
  15: [[3, 5], [5, 3]],
  18: [[3, 6], [6, 3]],
  20: [[4, 5], [5, 4]],
}

/**
 * The board for n cards on this screen (landscape first on a screen at least as wide as tall);
 * fewer cards when it does not fit. A screen known to be short (under 7 rows) keeps a row free for
 * the «없음» button when the board offers one.
 */
export function setMatchBoard(n: number, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>, noneButton = false): { cards: number; cols: number; rows: number } {
  const maxCols = Math.max(3, Math.min(7, ctx.maxCols))
  const tall = Math.max(3, Math.min(7, ctx.maxRows ?? 7))
  const maxRows = noneButton && tall < 7 ? tall - 1 : tall
  const sizes = [20, 18, 15, 12, 9, 6, 4].filter((s) => s <= n)
  for (const size of sizes) {
    const shapes = maxCols >= maxRows ? [...SHAPES[size]].reverse() : SHAPES[size]
    const fit = shapes.find(([c, r]) => c <= maxCols && r <= maxRows)
    if (fit) return { cards: size, cols: fit[0], rows: fit[1] }
  }
  return { cards: 4, cols: 2, rows: 2 }
}

// ── cards as numbers ─────────────────────────────────────────────────────────
//
// A card is 0-80: one base-3 digit per attribute in ATTRS order (shape, count, colour, fill). A
// fixed attribute is digit 0 (black, solid). Three cards are a set exactly when every digit sums to
// 0 mod 3 (all same: 3x; all different: 0+1+2), so the card completing a pair is a digit-wise sum.

const ATTRS: readonly SetAttribute[] = ['shape', 'count', 'color', 'fill']
const ATTR_LETTER: Record<SetAttribute, string> = { shape: 's', count: 'c', color: 'l', fill: 'f' }
const SHAPES_ALL: readonly SetShape[] = ['circle', 'triangle', 'square', 'diamond']
/** Index 0 is the fixed value when an attribute does not vary: black, solid. */
const COLORS: readonly SetColor[] = ['black', 'blue', 'vermillion']
const FILLS: readonly SetFill[] = ['solid', 'striped', 'outline']
const DECK = 81
const POW = [1, 3, 9, 27]

const digit = (card: number, d: number) => Math.floor(card / POW[d]) % 3

let thirdTable: Uint8Array | null = null
/** The card that completes a set with a and b. */
function third(a: number, b: number): number {
  if (!thirdTable) {
    thirdTable = new Uint8Array(DECK * DECK)
    for (let x = 0; x < DECK; x++) {
      for (let y = 0; y < DECK; y++) {
        let z = 0
        for (let d = 0; d < 4; d++) z += ((6 - digit(x, d) - digit(y, d)) % 3) * POW[d]
        thirdTable[x * DECK + y] = z
      }
    }
  }
  return thirdTable[a * DECK + b]
}

/** Every card for these varying digits, the others at 0. */
function deckOf(open: readonly number[]): number[] {
  const out: number[] = []
  for (let card = 0; card < DECK; card++) if ([0, 1, 2, 3].every((d) => open.includes(d) || digit(card, d) === 0)) out.push(card)
  return out
}

function countSets(board: readonly number[]): number {
  const on = new Uint8Array(DECK)
  for (const c of board) on[c] = 1
  let pairs = 0
  for (let i = 0; i < board.length; i++) for (let j = i + 1; j < board.length; j++) if (on[third(board[i], board[j])]) pairs++
  return pairs / 3
}

/** Near sets: triples that fail on exactly one of the varying attributes. */
function nearMisses(board: readonly number[], open: readonly number[]): number {
  let n = 0
  for (let i = 0; i < board.length; i++) {
    for (let j = i + 1; j < board.length; j++) {
      for (let k = j + 1; k < board.length; k++) {
        let broken = 0
        for (const d of open) if ((digit(board[i], d) + digit(board[j], d) + digit(board[k], d)) % 3 !== 0) broken++
        if (broken === 1) n++
      }
    }
  }
  return n
}

/** Greedy: add cards from the pool while they complete no set with any pair already chosen. */
function grow(start: readonly number[], pool: readonly number[], n: number): number[] | null {
  const out = start.slice()
  const banned = new Uint8Array(DECK)
  const taken = new Uint8Array(DECK)
  for (let i = 0; i < out.length; i++) {
    taken[out[i]] = 1
    for (let j = i + 1; j < out.length; j++) banned[third(out[i], out[j])] = 1
  }
  for (const v of pool) {
    if (out.length >= n) break
    if (taken[v] || banned[v]) continue
    for (const w of out) banned[third(v, w)] = 1
    out.push(v)
    taken[v] = 1
  }
  return out.length >= n ? out : null
}

/** Sets through card v on the board (on[] marks it), leaving out the card at `skip`. */
function setsThrough(board: readonly number[], skip: number, v: number, on: Uint8Array): number {
  let pairs = 0
  for (let i = 0; i < board.length; i++) {
    if (i === skip) continue
    const t = third(board[i], v)
    if (t !== v && on[t]) pairs++
  }
  return pairs / 2
}

/** Local search to exactly `target` sets: swap a card for one off the board while that gets no further. */
function exactSets(rng: Rng, deck: readonly number[], n: number, target: number): number[] | null {
  for (let restart = 0; restart < 12; restart++) {
    const board = rng.sample(deck, n)
    const on = new Uint8Array(DECK)
    for (const c of board) on[c] = 1
    let sets = countSets(board)
    for (let step = 0; step < 800 && sets !== target; step++) {
      const i = rng.int(0, n - 1)
      const swap = rng.pick(deck)
      if (on[swap]) continue
      const old = board[i]
      on[old] = 0
      const lose = setsThrough(board, i, old, on)
      on[swap] = 1
      const next = sets - lose + setsThrough(board, i, swap, on)
      if (Math.abs(next - target) <= Math.abs(sets - target)) {
        board[i] = swap
        sets = next
      } else {
        on[swap] = 0
        on[old] = 1
      }
    }
    if (sets === target) return board
  }
  return null
}

/** The fewest sets n cards can hold with this many attributes (two make 9 cards, three 27). */
function fewestSets(attrs: number, n: number): number {
  if (attrs === 2) return n >= 9 ? 12 : n >= 6 ? 2 : 0
  if (attrs === 3) return n >= 15 ? 13 : n >= 12 ? 4 : 0
  return 0
}

/**
 * Which attributes the hidden set has all different: at least `spread`, the attribute a board
 * introduces among them, never the last trial's kind, likelier the more (as chance deals them)
 * except on teaching boards.
 */
function pickMask(rng: Rng, open: readonly number[], spread: number, avoid: string, uniform: boolean, must: number | null): number[] {
  const masks: number[][] = []
  for (let m = 1; m < 1 << open.length; m++) {
    const mask = open.filter((_, i) => m & (1 << i))
    if (mask.length >= Math.min(spread, open.length) && (must === null || !open.includes(must) || mask.includes(must))) masks.push(mask)
  }
  const fresh = masks.filter((m) => maskLetters(m) !== avoid)
  const pool = fresh.length > 0 ? fresh : masks
  const weight = (m: number[]) => (uniform ? 1 : 2 ** m.length)
  let r = rng.next() * pool.reduce((s, m) => s + weight(m), 0)
  for (const m of pool) {
    r -= weight(m)
    if (r < 0) return m
  }
  return pool[pool.length - 1]
}

const maskLetters = (digits: readonly number[]) => digits.map((d) => ATTR_LETTER[ATTRS[d]]).join('')

/** A set with exactly the `mask` digits all different. */
function plantSet(rng: Rng, deck: readonly number[], mask: readonly number[]): [number, number, number] {
  const a = rng.pick(deck)
  let b = a
  for (const d of mask) b += ((digit(a, d) + rng.int(1, 2)) % 3 - digit(a, d)) * POW[d]
  return [a, b, third(a, b)]
}

/** The digits two cards of a set differ on — the set's all-different attributes. */
function setMask(a: number, b: number): number[] {
  return [0, 1, 2, 3].filter((d) => digit(a, d) !== digit(b, d))
}

/**
 * The board: `target` sets exactly (0 for a «없음» board), the near-miss pressure the band asks for
 * (the fewest or the most among a few candidates), and — with one set — a set of the asked spread
 * that is not the last trial's kind. Never fails: when the asked board cannot be built the fallback
 * is a planted set on random cards, so a board without «없음» always holds a set.
 */
function dealBoard(rng: Rng, plan: SetMatchPlan, n: number, empty: boolean, avoidMask: string): number[] {
  const open = plan.vary.map((a) => ATTRS.indexOf(a))
  const deck = deckOf(open)
  const floor = fewestSets(open.length, n)
  const target = Math.max(floor, empty ? 0 : Math.min(n === 4 ? 1 : Infinity, plan.sets))
  const candidates = plan.decoys === 'some' ? 1 : plan.decoys === 'few' ? 4 : 6
  let best: number[] | null = null
  let bestScore = 0
  for (let k = 0; k < candidates; k++) {
    let board: number[] | null = null
    for (let attempt = 0; attempt < 24 && !board; attempt++) {
      if (target === 0) board = grow([], rng.shuffle(deck), n)
      else if (target === 1) {
        const set = plantSet(rng, deck, pickMask(rng, open, plan.spread, avoidMask, plan.decoys === 'few', plan.feature ? ATTRS.indexOf(plan.feature) : null))
        board = grow(set, rng.shuffle(deck.filter((c) => !set.includes(c))), n)
      } else board = exactSets(rng, deck, n, target)
    }
    if (!board) continue
    if (candidates === 1) {
      best = board
      break
    }
    const score = nearMisses(board, open)
    if (!best || (plan.decoys === 'few' ? score < bestScore : score > bestScore)) {
      best = board
      bestScore = score
    }
  }
  if (!best) {
    // Never reached in the tests' thousands of boards; a planted set on random cards is always a valid board.
    const [a, b, c] = plantSet(rng, deck, open)
    const rest = rng.shuffle(deck.filter((x) => x !== a && x !== b && x !== c)).slice(0, n - 3)
    best = [a, b, c, ...rest]
  }
  return rng.shuffle(best)
}

// ── the game ────────────────────────────────────────────────────────────────

export interface SetMatchState {
  cards: SetCard[]
  cols: number
  rows: number
  vary: readonly SetAttribute[]
  /** A «없음» button is on the board (this band can deal set-free boards). */
  noneOffered: boolean
  /** The set the answer shows — the first in index order; null when the board has none. */
  set: [number, number, number] | null
  picked: number[]
  /** 'set' (three picked) or 'none' («없음»), once answered. */
  answered: 'set' | 'none' | null
  timedOut: boolean
  limitMs: number
  tags: string[]
  band: number
  /** The open rules ('l' 'f' 'n') and the answer set's all-different attributes — ctx.recent's carry. */
  carry: string
}

const SIG_COLOR: Record<SetColor, string> = { black: 'k', blue: 'b', vermillion: 'v' }
const SIG_FILL: Record<SetFill, string> = { solid: 'f', striped: 'h', outline: 'o' }

function numberCard(card: number, shapes: readonly SetShape[]): SetCard {
  return { shape: shapes[digit(card, 0)], count: (digit(card, 1) + 1) as 1 | 2 | 3, color: COLORS[digit(card, 2)], fill: FILLS[digit(card, 3)] }
}

/** Every set on a board, as index triples in ascending order. */
export function setsOn(cards: readonly SetCard[]): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) for (let k = j + 1; k < cards.length; k++) if (isSet(cards[i], cards[j], cards[k])) out.push([i, j, k])
  return out
}

/** The attributes on which three cards are neither all the same nor all different ([] = a set). */
export function brokenAttributes(a: SetCard, b: SetCard, c: SetCard): SetAttribute[] {
  const ok = <T>(x: T, y: T, z: T) => (x === y && y === z) || (x !== y && y !== z && x !== z)
  return ATTRS.filter((attr) => !ok(a[attr], b[attr], c[attr]))
}

export function isSet(a: SetCard, b: SetCard, c: SetCard): boolean {
  return brokenAttributes(a, b, c).length === 0
}

function over(s: SetMatchState): boolean {
  return s.answered !== null || s.timedOut
}

function won(s: SetMatchState): boolean {
  if (s.answered === 'none') return s.set === null
  if (s.answered === 'set') return s.picked.length === 3 && isSet(s.cards[s.picked[0]], s.cards[s.picked[1]], s.cards[s.picked[2]])
  return false
}

export const setMatch: BrainGameDef<SetMatchState> = {
  id: 'setMatch',
  create(level, rng, ctx) {
    const plan = setMatchPlan(level, ctx)
    const noneOffered = plan.none > 0
    const board = setMatchBoard(plan.cards, ctx, noneOffered)
    // A trial uses three of the four shapes, so «all different» is one shape each.
    const shapes = rng.sample(SHAPES_ALL, 3)
    const empty = noneOffered && rng.chance(plan.none)
    const last = (ctx.recent ?? []).length > 0 ? ctx.recent[ctx.recent.length - 1].carry : undefined
    const dealt = dealBoard(rng, plan, board.cards, empty, last?.split('|')[1] ?? '')
    const cards = dealt.map((c) => numberCard(c, shapes))
    const sets = setsOn(cards)
    const set = sets[0] ?? null
    const tags: string[] = []
    if (board.cards === 6) tags.push('setMatch.board6')
    if (board.cards === 9) tags.push('setMatch.board9')
    if (board.cards === 12) tags.push('setMatch.board12')
    if (board.cards === 15) tags.push('setMatch.board15')
    if (plan.vary.includes('color')) tags.push('setMatch.color')
    if (plan.vary.includes('fill')) tags.push('setMatch.fill')
    if (plan.oneSet && sets.length === 1) tags.push('setMatch.oneSet')
    if (noneOffered) tags.push('setMatch.none')
    const mask = set ? maskLetters(setMask(dealt[set[0]], dealt[set[1]])) : ''
    return {
      cards,
      cols: board.cols,
      rows: board.rows,
      vary: plan.vary,
      noneOffered,
      set,
      picked: [],
      answered: null,
      timedOut: false,
      limitMs: plan.limitMs,
      tags,
      band: plan.band,
      carry: `${plan.open}|${mask}`,
    }
  },
  pendingMs: () => null,
  advance: (s) => s,
  acceptsInput: (s) => !over(s),
  tap(s, index) {
    if (over(s)) return s
    if (s.noneOffered && index === s.cards.length) return { ...s, answered: 'none' }
    if (!Number.isInteger(index) || index < 0 || index >= s.cards.length) return s
    if (s.picked.includes(index)) return { ...s, picked: s.picked.filter((i) => i !== index) }
    const picked = [...s.picked, index]
    return picked.length === 3 ? { ...s, picked, answered: 'set' } : { ...s, picked }
  },
  timeout: (s) => (over(s) ? s : { ...s, timedOut: true }),
  outcome(s) {
    if (!over(s)) return null
    return { correct: won(s), accuracy: won(s) ? 1 : 0 }
  },
  timeLimitMs: (s) => s.limitMs,
  view(s): SetMatchView {
    const done = over(s)
    const right = done && won(s)
    const answer: readonly number[] = s.set ?? []
    const cards = s.cards.map((card, i) => {
      let tone: CellTone = s.picked.includes(i) ? 'lit' : 'idle'
      if (done) {
        if (right) tone = s.picked.includes(i) ? 'correct' : 'idle'
        else if (answer.includes(i)) tone = s.picked.includes(i) ? 'correct' : 'missed'
        else tone = s.picked.includes(i) ? 'wrong' : 'idle'
      }
      return { card, tone }
    })
    const view: SetMatchView = {
      kind: 'setMatch',
      prompt: { key: 'play.setMatchFind' },
      cols: s.cols,
      rows: s.rows,
      cards,
      vary: s.vary,
      picked: done ? Math.min(3, s.picked.length) : s.picked.length,
      locked: done,
    }
    if (s.noneOffered) {
      const extra: SetMatchView['extra'] = { key: 'play.setMatchNone', index: s.cards.length }
      if (done) {
        if (s.answered === 'none') extra.tone = right ? 'correct' : 'wrong'
        else if (s.set === null) extra.tone = 'missed'
      }
      view.extra = extra
    }
    if (done) {
      view.answer = [...answer]
      if (s.answered === 'set' && !right && s.picked.length === 3) view.broken = brokenAttributes(s.cards[s.picked[0]], s.cards[s.picked[1]], s.cards[s.picked[2]])
    }
    return view
  },
  // One letter per value, distinct within each attribute (black ≠ blue, square ≠ solid).
  signature: (s) => `sm:${s.cols}x${s.rows}:${s.cards.map((c) => `${c.shape[0]}${c.count}${SIG_COLOR[c.color]}${SIG_FILL[c.fill]}`).join('.')}`,
  solution(s) {
    if (over(s)) return null
    if (s.set === null) return [s.cards.length]
    const set = s.set
    const off = s.picked.filter((i) => !set.includes(i))
    return [...off, ...set.filter((i) => !s.picked.includes(i))]
  },
  mechanics: (s) => s.tags,
  maxLevel: () => SET_MATCH_MAX_LEVEL,
  trialInfo: (s) => ({ kind: `b${s.band}`, carry: s.carry }),
}
