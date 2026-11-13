import { clamp, range, type Rng } from '../rng'
import type { BrainGameDef, CellView, CreateContext, GridView } from '../types'

/**
 * Tiles flash one after another; repeat the order. Sequential memory span on Corsi blocks, with
 * the Corsi stop rule (rules.ts: two tries a level, both missed ends the round).
 *
 * The level is a row of SEQUENCE_LADDER: how many tiles, on how big a board, how fast. L1–5 are
 * the standard administration's lengths at one tile a second (Kessels 2000): forward 3–5 tiles on
 * 3×3, from L4 (6 tiles) always in reverse — a rule card, then for good — and from L5 on 4×4. Past
 * that the owner's «카드 갯수 늘리기 + 카드 더 빨리 순서 파밧» (2026-11-13): each level either adds a
 * tile or speeds the flashes up, and from L8 the board is 5×5 where the screen has room. The
 * flashes never come faster than three a second (flash + gap ≥ 340ms, EVIDENCE §5 / WCAG 2.3.1).
 * A screen too small for a row's board plays the same tiles at the same pace on the biggest board
 * it holds; the cap is the last row whose tiles fit that board once each.
 *
 * A tile never repeats, three tiles never sweep along a straight line, and from 5 tiles the path
 * crosses itself at least once, so it cannot be held as one simple shape.
 */
export interface SequenceState {
  n: number
  seq: number[]
  reverse: boolean
  flashMs: number
  gapMs: number
  /** The pause before the first flash. */
  leadMs: number
  phase: 'watch' | 'input' | 'done'
  /** -1 is the lead-in pause before the first flash. */
  step: number
  flashOn: boolean
  inputs: number[]
  wrong: number | null
  timedOut: boolean
}

/** One level: tiles in the sequence, the board side it wants, and one flash plus the gap after it. */
export interface SequenceRung {
  length: number
  side: 3 | 4 | 5
  intervalMs: number
}

/**
 * The level table, L1 first. Every row adds a tile, speeds the flashes up, or brings a rule or a
 * bigger board; reverse from L4 (SEQUENCE_REVERSE_FROM).
 */
export const SEQUENCE_LADDER: readonly SequenceRung[] = [
  { length: 3, side: 3, intervalMs: 1000 },
  { length: 4, side: 3, intervalMs: 1000 },
  { length: 5, side: 3, intervalMs: 1000 },
  { length: 6, side: 3, intervalMs: 1000 },
  { length: 7, side: 4, intervalMs: 1000 },
  { length: 7, side: 4, intervalMs: 750 },
  { length: 8, side: 4, intervalMs: 750 },
  { length: 8, side: 5, intervalMs: 600 },
  { length: 9, side: 5, intervalMs: 600 },
  { length: 9, side: 5, intervalMs: 480 },
  { length: 10, side: 5, intervalMs: 480 },
  { length: 10, side: 5, intervalMs: 400 },
  { length: 11, side: 5, intervalMs: 400 },
  { length: 11, side: 5, intervalMs: 340 },
  { length: 12, side: 5, intervalMs: 340 },
  { length: 13, side: 5, intervalMs: 340 },
]

/** The quickest a flash may follow the one before: under three a second (WCAG 2.3.1). */
export const SEQUENCE_MIN_INTERVAL_MS = 340
/** The share of each interval a tile stays lit (700 + 300 at one a second). */
const FLASH_SHARE = 0.7
/** One a second (L1–5): 700ms lit, 300ms dark. */
export const SEQUENCE_FLASH_MS = 700
export const SEQUENCE_GAP_MS = 300
export const SEQUENCE_LEAD_MS = 1000
/** From this level every sequence is repeated in reverse (mechanics `sequence.reverse`). */
export const SEQUENCE_REVERSE_FROM = 4
/** From this level the board is 4×4, on a screen with room for it (mechanics `sequence.grid4`). */
export const SEQUENCE_GRID4_FROM = 5
/** From this level the board is 5×5, on a screen with room for it (mechanics `sequence.grid5`). */
export const SEQUENCE_GRID5_FROM = 8
/** From this level the flashes come faster than one a second (mechanics `sequence.faster`). */
export const SEQUENCE_FASTER_FROM = 6
const REVERSE_RULE = 'sequence.reverse'
/** Rejection sampling stops here; a search then finds a sequence that keeps every rule. */
const MAX_TRIES = 300

/** The biggest board this screen gives Sequence: 5×5, 4×4, or 3×3 on a screen narrower than 4 cells. */
function screenSide(ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): number {
  return Math.max(3, Math.min(5, ctx.maxCols, ctx.maxRows ?? 7))
}

/** The last row whose tiles fit this screen's biggest board once each. */
export function sequenceMaxLevel(ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): number {
  const n = screenSide(ctx)
  let lv = 0
  while (lv < SEQUENCE_LADDER.length && SEQUENCE_LADDER[lv].length <= n * n) lv++
  return lv
}

/** A row's flash and gap: 70% of the interval lit, the rest dark. */
export function sequenceTiming(intervalMs: number): { flashMs: number; gapMs: number } {
  const interval = Math.max(SEQUENCE_MIN_INTERVAL_MS, intervalMs)
  const flashMs = Math.round(interval * FLASH_SHARE)
  return { flashMs, gapMs: interval - flashMs }
}

function point(n: number, tile: number): [number, number] {
  return [tile % n, Math.floor(tile / n)]
}

/** a → b → c run straight on in one direction (b on the line between a and c). */
function sweeps(n: number, a: number, b: number, c: number): boolean {
  const [ax, ay] = point(n, a)
  const [bx, by] = point(n, b)
  const [cx, cy] = point(n, c)
  const ux = bx - ax
  const uy = by - ay
  const vx = cx - bx
  const vy = cy - by
  return ux * vy - uy * vx === 0 && ux * vx + uy * vy > 0
}

/** Proper crossings of the path (segments between tile centres; a shared end point is not one). */
function crossings(n: number, seq: readonly number[]): number {
  const turn = (o: [number, number], a: [number, number], b: [number, number]) => Math.sign((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]))
  let count = 0
  for (let i = 0; i + 1 < seq.length; i++) {
    for (let j = i + 2; j + 1 < seq.length; j++) {
      const a = point(n, seq[i])
      const b = point(n, seq[i + 1])
      const c = point(n, seq[j])
      const d = point(n, seq[j + 1])
      if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) count++
    }
  }
  return count
}

function keepsRules(n: number, seq: readonly number[]): boolean {
  for (let i = 2; i < seq.length; i++) if (sweeps(n, seq[i - 2], seq[i - 1], seq[i])) return false
  return seq.length < 5 || crossings(n, seq) > 0
}

/** Never reached in practice (the rules reject at most ~60% of draws): a depth-first search in random order. */
function search(n: number, length: number, rng: Rng): number[] {
  const order = rng.shuffle(range(n * n))
  const seq: number[] = []
  const used = new Set<number>()
  const extend = (): boolean => {
    if (seq.length === length) return length < 5 || crossings(n, seq) > 0
    for (const tile of order) {
      if (used.has(tile)) continue
      if (seq.length >= 2 && sweeps(n, seq[seq.length - 2], seq[seq.length - 1], tile)) continue
      seq.push(tile)
      used.add(tile)
      if (extend()) return true
      seq.pop()
      used.delete(tile)
    }
    return false
  }
  extend()
  return seq
}

function expected(s: SequenceState): number {
  return s.reverse ? s.seq[s.seq.length - 1 - s.inputs.length] : s.seq[s.inputs.length]
}

function levelOf(level: number, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): number {
  return clamp(Math.round(Number.isFinite(level) ? level : 1), 1, sequenceMaxLevel(ctx))
}

/** A level's row on this screen: the table's, its board no bigger than the screen holds. */
export function sequenceRung(level: number, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): SequenceRung & { level: number } {
  const lv = levelOf(level, ctx)
  const rung = SEQUENCE_LADDER[lv - 1]
  return { ...rung, side: Math.min(rung.side, screenSide(ctx)) as 3 | 4 | 5, level: lv }
}

export const sequence: BrainGameDef<SequenceState> = {
  id: 'sequence',
  maxLevel: (ctx) => sequenceMaxLevel(ctx),
  spanLength: (level, ctx) => sequenceRung(level, ctx).length,
  create(level, rng, ctx) {
    const rung = sequenceRung(level, ctx)
    const lv = rung.level
    const length = rung.length
    const n = rung.side
    const { flashMs, gapMs } = sequenceTiming(rung.intervalMs)
    let seq: number[] | null = null
    for (let tries = 0; tries < MAX_TRIES && !seq; tries++) {
      const draw = rng.sample(range(n * n), length)
      if (keepsRules(n, draw)) seq = draw
    }
    return {
      n,
      seq: seq ?? search(n, length, rng),
      // Always reversed from L4 — unless the round is not introducing that rule yet (§2.4): then the
      // same length, forward.
      reverse: lv >= SEQUENCE_REVERSE_FROM && !ctx.blockRules.includes(REVERSE_RULE),
      flashMs,
      gapMs,
      leadMs: SEQUENCE_LEAD_MS,
      phase: 'watch',
      step: -1,
      flashOn: false,
      inputs: [],
      wrong: null,
      timedOut: false,
    }
  },
  pendingMs(s) {
    if (s.phase !== 'watch') return null
    if (s.step === -1) return s.leadMs
    return s.flashOn ? s.flashMs : s.gapMs
  },
  advance(s) {
    if (s.phase !== 'watch') return s
    if (s.step === -1) return { ...s, step: 0, flashOn: true }
    if (s.flashOn) return { ...s, flashOn: false }
    const step = s.step + 1
    if (step >= s.seq.length) return { ...s, step, phase: 'input' }
    return { ...s, step, flashOn: true }
  },
  acceptsInput: (s) => s.phase === 'input',
  tap(s, i) {
    if (s.phase !== 'input') return s
    if (i !== expected(s)) return { ...s, wrong: i, phase: 'done' }
    const inputs = [...s.inputs, i]
    return { ...s, inputs, phase: inputs.length === s.seq.length ? 'done' : 'input' }
  },
  timeout: (s) => (s.phase === 'done' ? s : { ...s, timedOut: true, phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    return {
      correct: s.wrong === null && !s.timedOut && s.inputs.length === s.seq.length,
      accuracy: s.inputs.length / s.seq.length,
    }
  },
  timeLimitMs: (s) => 3000 + s.seq.length * 1200,
  view(s) {
    const last = s.inputs[s.inputs.length - 1]
    const missedCell = s.phase === 'done' && s.wrong !== null ? expected(s) : null
    const cells: CellView[] = range(s.n * s.n).map((i) => {
      if (s.phase === 'watch') return { tone: s.flashOn && s.seq[s.step] === i ? 'lit' : 'idle' }
      if (s.phase === 'done' && i === s.wrong) return { tone: 'wrong' }
      if (i === missedCell) return { tone: 'missed' }
      if (i === last) return { tone: 'correct' }
      return { tone: 'idle' }
    })
    const view: GridView = {
      kind: 'grid',
      cols: s.n,
      rows: s.n,
      cells,
      locked: s.phase !== 'input',
      prompt:
        s.phase === 'watch'
          ? { key: s.reverse ? 'play.watchReverse' : 'play.watch' }
          : {
              key: s.reverse ? 'play.repeatReverse' : 'play.repeat',
              params: { done: s.inputs.length, total: s.seq.length },
            },
    }
    // «⟲ 거꾸로» stays up through the whole trial, watching included.
    if (s.reverse) view.badge = { key: 'play.reverseBadge' }
    return view
  },
  signature: (s) => `sq:${s.n}:${s.reverse ? 'r' : 'f'}:${s.flashMs + s.gapMs}:${s.seq.join(',')}`,
  mechanics: (s) => [
    ...(s.n >= 4 ? ['sequence.grid4'] : []),
    ...(s.n >= 5 ? ['sequence.grid5'] : []),
    ...(s.flashMs + s.gapMs < 1000 ? ['sequence.faster'] : []),
    ...(s.reverse ? ['sequence.reverse'] : []),
  ],
  solution(s) {
    if (s.phase !== 'input') return null
    const order = s.reverse ? [...s.seq].reverse() : s.seq
    return order.slice(s.inputs.length)
  },
}
