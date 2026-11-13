import { clamp, range, type Rng } from '../rng'
import type { BrainGameDef, CellView, CreateContext, GridView } from '../types'

/**
 * Tiles flash one after another; repeat the order. Sequential memory span — the Corsi block task:
 * the level IS the length (level 1 = 3 tiles, L = length − 2), presented at one tile per second as
 * the standard administration does (Kessels 2000), never faster (GAMES_DIFFICULTY_PLAN §3.7).
 *
 * Forward up to 5 tiles on 3×3; from L4 (6 tiles) always in reverse — a rule card, then for good;
 * from L5 on 4×4 where the screen has room. A tile never repeats, three tiles never sweep along a
 * straight line, and from 5 tiles the path crosses itself at least once, so it cannot be held as one
 * simple shape. The cap is every tile of the board once.
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

export const SEQUENCE_FLASH_MS = 700
export const SEQUENCE_GAP_MS = 300
export const SEQUENCE_LEAD_MS = 1000
/** From this level every sequence is repeated in reverse (mechanics `sequence.reverse`). */
export const SEQUENCE_REVERSE_FROM = 4
/** From this level the board is 4×4, on a screen with room for it (mechanics `sequence.grid4`). */
export const SEQUENCE_GRID4_FROM = 5
const REVERSE_RULE = 'sequence.reverse'
/** Rejection sampling stops here; a search then finds a sequence that keeps every rule. */
const MAX_TRIES = 300

/** The biggest board this screen gives Sequence: 4×4, or 3×3 on a screen narrower than 4 cells. */
function boardSide(ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): number {
  return Math.min(ctx.maxCols, ctx.maxRows ?? 7) >= 4 ? 4 : 3
}

/** Every tile once: n² tiles is length n² − 2 + 2. */
export function sequenceMaxLevel(ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): number {
  const n = boardSide(ctx)
  return n * n - 2
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

export const sequence: BrainGameDef<SequenceState> = {
  id: 'sequence',
  maxLevel: (ctx) => sequenceMaxLevel(ctx),
  spanLength: (level, ctx) => levelOf(level, ctx) + 2,
  create(level, rng, ctx) {
    const lv = levelOf(level, ctx)
    const length = lv + 2
    const n = lv >= SEQUENCE_GRID4_FROM ? boardSide(ctx) : 3
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
      flashMs: SEQUENCE_FLASH_MS,
      gapMs: SEQUENCE_GAP_MS,
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
  signature: (s) => `sq:${s.n}:${s.reverse ? 'r' : 'f'}:${s.seq.join(',')}`,
  mechanics: (s) => [...(s.n >= 4 ? ['sequence.grid4'] : []), ...(s.reverse ? ['sequence.reverse'] : [])],
  solution(s) {
    if (s.phase !== 'input') return null
    const order = s.reverse ? [...s.seq].reverse() : s.seq
    return order.slice(s.inputs.length)
  },
}
