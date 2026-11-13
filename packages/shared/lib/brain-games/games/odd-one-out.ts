import { range, type Rng } from '../rng'
import type { BrainGameDef, CellInk, CellView, CreateContext, GridView, RecentTrial } from '../types'

/**
 * Every cell is the same except one. Find it. Selective attention.
 *
 * The level picks what the odd one is (GAMES_DIFFICULTY_PLAN §3.3), not just how big the board is:
 * a pop-out (L1-2), a same-colour look-alike (L3), the same glyph turned (L5, the turn shrinking
 * every level), confusable glyphs (L7), colour noise to ignore (L10), the one mirror image among
 * glyphs all turned at random (L12), boards with no odd one at all (L16, «없음»), and near-identical
 * CJK characters (L17). Kinds are drawn by weight, never the same one three times running; past
 * L25 only the clock tightens, to a floor.
 */
export type OddKind = 'pop' | 'lookalike' | 'rotation' | 'glyph' | 'noise' | 'mirror' | 'twin'

export interface OddOneOutState {
  level: number
  cols: number
  rows: number
  kind: OddKind
  common: string
  /** The odd cell's label (the common one on an empty board, and on rotation and mirror boards). */
  odd: string
  /** Per cell, degrees; 0 is upright. */
  rotations: number[]
  /** Per cell ink on colour-noise boards; empty otherwise. */
  inks: CellInk[]
  /** Mirror boards: the odd one is drawn mirrored. */
  mirror: boolean
  /** No odd one on this board: «없음» is the answer, and `oddIndex` is the cell count. */
  absent: boolean
  /**
   * The «없음» button is on the board. Once that rule is in play it is on every board, so its
   * presence never gives an empty board away.
   */
  none: boolean
  oddIndex: number
  limitMs: number
  phase: 'find' | 'done'
  picked: number | null
  timedOut: boolean
}

const RULE = { rotation: 'oddOneOut.rotation', mirror: 'oddOneOut.mirror', absent: 'oddOneOut.absent' } as const

/** Past this the puzzle is only its clock, and the clock is at its floor on the biggest board. */
export const ODD_MAX_LEVEL = 32

/** L1-2: the pair differs in shape AND colour — the only pop-out in the game (no colour-only pairs anywhere). */
export const POP_PAIRS: readonly (readonly [string, string])[] = [
  ['🍎', '🍌'], ['🌸', '🍀'], ['⚽', '🏀'], ['🍓', '🍇'],
  ['🐸', '🐷'], ['🍋', '🍆'], ['💧', '🔥'], ['🥕', '🥦'],
]

/** L3-6: same colour, similar outline. The last emoji in the game (none from L7). */
export const LOOKALIKE_PAIRS: readonly (readonly [string, string])[] = [
  ['🍊', '🍑'], ['🐯', '🦁'], ['🐭', '🐹'], ['🍋', '🍈'], ['🐸', '🐢'], ['🍒', '🍓'],
]

/** L7+: confusable glyphs — mirror images, a turned digit, one stroke more or less. */
export const GLYPH_PAIRS: readonly (readonly [string, string])[] = [
  ['b', 'd'], ['p', 'q'], ['E', 'F'], ['6', '9'], ['C', 'G'],
]

/** L17+: characters that differ only in a stroke's length (system CJK fonts; no bundled font). */
export const TWIN_PAIRS: readonly (readonly [string, string])[] = [
  ['日', '曰'], ['土', '士'], ['未', '末'], ['人', '入'],
]

/** No rotational symmetry, so a turned copy can never look identical. Letters only: no emoji from L7. */
export const ROTATABLE: readonly string[] = ['F', 'R', 'G', 'J', 'L', 'P', '4', '7']

/** No mirror symmetry under any turn: a mirrored copy is never the same glyph turned. */
export const MIRROR_GLYPHS: readonly string[] = ['F', 'P', 'G', 'J']

const INKS: readonly CellInk[] = ['neutral', 'amber', 'cyan']

/**
 * The content band a level is in (the rows of the plan's §3.3 table): 1-2 · 3-4 · 5 · 6 · 7-9 ·
 * 10-11 · 12-15 · 16 · 17 · 18-19 · 20-21 · 22-23 · 24-25 · 26+.
 */
export function oddOneOutBand(level: number): number {
  const starts = [1, 3, 5, 6, 7, 10, 12, 16, 17, 18, 20, 22, 24, 26]
  const lv = Math.floor(level)
  let band = 1
  starts.forEach((s, i) => {
    if (lv >= s) band = i + 1
  })
  return band
}

/** How far the odd one is turned on a rotation board: 120° at L5, × 0.86 a level, never under 15°. */
export function oddTurn(level: number): number {
  return Math.max(15, 120 * Math.pow(0.86, level - 5))
}

/** The kinds a level draws from, by weight, before rule gating and the no-three-in-a-row rule. */
export function oddKindWeights(level: number): Partial<Record<OddKind, number>> {
  const lv = Math.floor(level)
  if (lv < 3) return { pop: 1 }
  if (lv < 5) return { lookalike: 1 }
  if (lv < 7) return { rotation: 0.5, lookalike: 0.5 }
  if (lv < 10) return { glyph: 0.6, rotation: 0.4 }
  if (lv < 12) return { noise: 0.4, glyph: 0.3, rotation: 0.3 }
  if (lv < 17) return { mirror: 0.2, noise: 0.3, glyph: 0.25, rotation: 0.25 }
  if (lv < 20) return { mirror: 0.2, twin: 0.2, noise: 0.2, glyph: 0.2, rotation: 0.2 }
  return { mirror: 0.3, twin: 0.2, noise: 0.15, glyph: 0.15, rotation: 0.2 }
}

/** Share of boards with no odd one, once the «없음» rule is in play. */
export function oddAbsentShare(level: number): number {
  const lv = Math.floor(level)
  return lv < 16 ? 0 : lv < 22 ? 0.25 : 1 / 3
}

/** Search cost per cell for a kind (ms) — the clock's slope. Modelled, to be recalibrated (EVIDENCE §4.5). */
function itemMs(kind: OddKind, level: number, inked: boolean): number {
  switch (kind) {
    case 'pop':
      return 200
    case 'rotation':
      return 150 + 6000 / oddTurn(level)
    case 'noise':
      return 300
    case 'mirror':
      return 600
    case 'twin':
      return inked ? 300 : 260
    default:
      return 260
  }
}

/**
 * The input clock: max(900 + 45·cells, (3000 + cells·itemMs) × 0.925^(L−1)).
 *
 * An empty board has to be searched to the end, so the plan gives it 1.4× its kind's clock. But the
 * timer bar drains at 1/limit: a bar running 1.4× slower than that kind's usual one would say «this
 * board is empty» before the player has looked. So once the «없음» button is on the board (`none`),
 * every board — empty or not — gets the same 1 + 0.4·(empty share): 1.1× at L16–21, 1.13× from L22.
 * The average clock is the plan's (75% × 1 + 25% × 1.4 = 1.1), and the bar gives nothing away.
 */
export function oddOneOutLimitMs(kind: OddKind, level: number, cells: number, opts: { none?: boolean; inked?: boolean } = {}): number {
  const lv = Math.min(ODD_MAX_LEVEL, Math.max(1, level))
  const ms = Math.max(900 + 45 * cells, (3000 + cells * itemMs(kind, lv, opts.inked === true)) * Math.pow(0.925, lv - 1))
  return Math.round(opts.none ? ms * (1 + 0.4 * oddAbsentShare(lv)) : ms)
}

/**
 * The board's side: 3×3 to L2, 4×4 to L5, 5×5 from L6, 6×6 from L12, 7×7 from L18, as far as the
 * screen allows (a phone stays 5×5). A screen known to be short (fewer than 7 rows) keeps a row
 * free for the «없음» button.
 */
function gridSide(level: number, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>, none: boolean): number {
  const lv = Math.floor(level)
  const want = lv < 3 ? 3 : lv < 6 ? 4 : lv < 12 ? 5 : lv < 18 ? 6 : 7
  const maxRows = ctx.maxRows ?? 7
  const rows = maxRows >= 7 ? 7 : maxRows - (none ? 1 : 0)
  return Math.max(3, Math.min(want, ctx.maxCols, rows))
}

/**
 * The kind for this board. A blocked rule's share goes to that level's plain content (rotation:
 * look-alikes to L6, glyphs after; mirror: glyphs), and a kind the last two boards both had sits
 * this one out while any other remains.
 */
function pickKind(level: number, rng: Rng, recent: readonly RecentTrial[], blocked: (tag: string) => boolean): OddKind {
  const w = new Map(Object.entries(oddKindWeights(level)) as [OddKind, number][])
  const move = (from: OddKind, to: OddKind) => {
    const x = w.get(from)
    if (x === undefined) return
    w.delete(from)
    w.set(to, (w.get(to) ?? 0) + x)
  }
  if (blocked(RULE.rotation)) move('rotation', Math.floor(level) < 7 ? 'lookalike' : 'glyph')
  if (blocked(RULE.mirror)) move('mirror', 'glyph')
  const [a, b] = recent.slice(-2)
  if (a && b && a.kind === b.kind && w.has(a.kind as OddKind) && w.size > 1) w.delete(a.kind as OddKind)
  const total = [...w.values()].reduce((s, x) => s + x, 0)
  let r = rng.next() * total
  for (const [kind, x] of w) {
    r -= x
    if (r < 0) return kind
  }
  return [...w.keys()][w.size - 1]
}

/** Colour noise: every cell a random ink, the others in at least two; the odd one takes one of theirs. */
function noiseInks(cells: number, oddIndex: number, rng: Rng): CellInk[] {
  const inks = range(cells).map(() => rng.pick(INKS))
  const others = range(cells).filter((i) => i !== oddIndex)
  const [a, b] = rng.sample(others, 2)
  const [ia, ib] = rng.sample(INKS, 2)
  inks[a] = ia
  inks[b] = ib
  if (oddIndex < cells) inks[oddIndex] = inks[rng.pick(others)]
  return inks
}

const pairOf = (pairs: readonly (readonly [string, string])[], rng: Rng): [string, string] => {
  const p = rng.pick(pairs)
  return rng.chance(0.5) ? [p[0], p[1]] : [p[1], p[0]]
}

export const oddOneOut: BrainGameDef<OddOneOutState> = {
  id: 'oddOneOut',
  create(level, rng, ctx) {
    const lv = Number.isFinite(level) ? Math.min(ODD_MAX_LEVEL, Math.max(1, level)) : 1
    const whole = Math.floor(lv)
    const blocked = (tag: string) => (ctx.blockRules ?? []).includes(tag)
    const none = whole >= 16 && !blocked(RULE.absent)
    const kind = pickKind(lv, rng, ctx.recent ?? [], blocked)
    const side = gridSide(lv, ctx, none)
    const cells = side * side
    const absent = none && rng.chance(oddAbsentShare(lv))
    const oddIndex = absent ? cells : rng.int(0, cells - 1)

    let common: string
    let odd: string
    let rotations = range(cells).map(() => 0)
    let inks: CellInk[] = []
    let mirror = false
    switch (kind) {
      case 'pop':
        ;[common, odd] = pairOf(POP_PAIRS, rng)
        break
      case 'lookalike':
        ;[common, odd] = pairOf(LOOKALIKE_PAIRS, rng)
        break
      case 'glyph':
        ;[common, odd] = pairOf(GLYPH_PAIRS, rng)
        break
      case 'noise':
        ;[common, odd] = pairOf(GLYPH_PAIRS, rng)
        inks = noiseInks(cells, oddIndex, rng)
        break
      case 'twin':
        ;[common, odd] = pairOf(TWIN_PAIRS, rng)
        // From L24 the twins sit inside colour noise.
        if (whole >= 24) inks = noiseInks(cells, oddIndex, rng)
        break
      case 'rotation': {
        common = odd = rng.pick(ROTATABLE)
        const turn = oddTurn(lv)
        // From L18 every cell is tilted a little, never as far as the odd one is turned: the odd
        // one stays at least `turn` from upright, the rest within half of it (and ±8°).
        const tilt = whole >= 18 ? Math.min(8, turn / 2) : 0
        rotations = range(cells).map(() => (tilt ? Math.round((rng.next() * 2 - 1) * tilt) : 0))
        if (!absent) rotations[oddIndex] = (rng.chance(0.5) ? 1 : -1) * Math.round(turn + rng.next() * tilt)
        break
      }
      case 'mirror':
        common = odd = rng.pick(MIRROR_GLYPHS)
        rotations = range(cells).map(() => rng.int(0, 7) * 45)
        mirror = !absent
        break
    }
    if (absent) odd = common
    return {
      level: lv,
      cols: side,
      rows: side,
      kind,
      common,
      odd,
      rotations,
      inks,
      mirror,
      absent,
      none,
      oddIndex,
      limitMs: oddOneOutLimitMs(kind, lv, cells, { none, inked: inks.length > 0 }),
      phase: 'find',
      picked: null,
      timedOut: false,
    }
  },
  pendingMs: () => null,
  advance: (s) => s,
  acceptsInput: (s) => s.phase === 'find',
  tap(s, i) {
    const cells = s.cols * s.rows
    if (s.phase !== 'find' || i < 0 || i > cells || (i === cells && !s.none)) return s
    return { ...s, picked: i, phase: 'done' }
  },
  timeout: (s) => (s.phase === 'done' ? s : { ...s, timedOut: true, phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    const correct = s.picked === s.oddIndex && !s.timedOut
    return { correct, accuracy: correct ? 1 : 0 }
  },
  timeLimitMs: (s) => s.limitMs,
  // Where the slowest kind (mirror, 600ms a cell) meets the floor on this screen's deepest board:
  // L32 on a 7×7 desktop, L30 on a 5×5 phone — never at or below the master tier (26).
  maxLevel(ctx) {
    const side = gridSide(ODD_MAX_LEVEL, ctx, true)
    const cells = side * side
    const at = 1 + Math.log((900 + 45 * cells) / (3000 + cells * 600)) / Math.log(0.925)
    return Math.max(27, Math.min(ODD_MAX_LEVEL, Math.ceil(at)))
  },
  view(s) {
    const count = s.cols * s.rows
    const done = s.phase === 'done'
    const cells: CellView[] = range(count).map((i) => {
      const isOdd = i === s.oddIndex
      let tone: CellView['tone'] = 'idle'
      if (done) {
        if (isOdd) tone = s.picked === i ? 'correct' : 'missed'
        else if (s.picked === i) tone = 'wrong'
      }
      const cell: CellView = { label: isOdd ? s.odd : s.common, tone }
      if (s.rotations[i]) cell.rotate = s.rotations[i]
      if (isOdd && s.mirror) cell.mirror = true
      if (s.inks.length) cell.ink = s.inks[i]
      return cell
    })
    const view: GridView = {
      kind: 'grid',
      cols: s.cols,
      rows: s.rows,
      cells,
      locked: s.phase !== 'find',
      prompt: { key: s.none ? 'play.findOddOrNone' : 'play.findOdd' },
    }
    if (s.none) {
      let tone: CellView['tone'] | undefined
      if (done) tone = s.absent ? (s.picked === count ? 'correct' : 'missed') : s.picked === count ? 'wrong' : undefined
      view.extra = { key: 'play.noneOdd', index: count, ...(tone ? { tone } : {}) }
    }
    // After a miss: the odd one beside a typical one, both upright (a mirror image stays mirrored).
    // Not on a rotation board — upright, the two are the same glyph; the pulsing cell shows it.
    const missed = done && !(s.picked === s.oddIndex && !s.timedOut)
    if (missed && !s.absent && s.kind !== 'rotation') {
      view.missChip = { odd: { label: s.odd, tone: 'idle', ...(s.mirror ? { mirror: true } : {}) }, common: { label: s.common, tone: 'idle' } }
    }
    return view
  },
  signature: (s) => `oo:${s.kind}:${s.common}:${s.odd}:${s.oddIndex}`,
  solution: (s) => (s.phase === 'find' ? [s.oddIndex] : null),
  mechanics(s) {
    const tags: string[] = []
    for (let n = 4; n <= 7; n++) if (s.cols >= n) tags.push(`oddOneOut.grid${n}`)
    switch (s.kind) {
      case 'lookalike':
        tags.push('oddOneOut.lookalike')
        break
      case 'rotation':
        tags.push(RULE.rotation)
        break
      case 'glyph':
      case 'noise':
        tags.push('oddOneOut.glyphs')
        break
      case 'mirror':
        tags.push(RULE.mirror)
        break
      case 'twin':
        tags.push('oddOneOut.glyphTwin')
        break
    }
    if (s.inks.length) tags.push('oddOneOut.colorNoise')
    if (s.none) tags.push(RULE.absent)
    return tags
  },
  trialInfo: (s) => ({ kind: s.kind }),
}
