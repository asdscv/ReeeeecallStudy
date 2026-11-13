import { clamp, range, type Rng } from '../rng'
import type { BrainGameDef, CellView, CreateContext, GridView } from '../types'

/**
 * Cells light up for a moment; tap the ones that were lit. Spatial memory span practice.
 *
 * A span task: the level IS the length (level 1 = 3 cells, L = cells − 2) and moves by the Corsi
 * rule in rules.ts (GAMES_DIFFICULTY_PLAN §3.6). The board follows an explicit ladder — 3×3 up to 3
 * cells, 4×4 up to 6, 5×5 up to 9, 6×5 / 5×6 up to 12, 7×5 / 5×7 up to 14 (never over 40% lit) — and
 * only as big as keeps cells ≥ 56dp on this screen; a screen no regular board fits takes a 50%
 * board instead. Lit patterns hold no easy chunks: from L4 no lit 2×2, from L8 no 3 in a row.
 * Past the most cells this screen holds, the same cells come in waves: two (L+1), then three
 * shorter ones (L+2, the cap). Difficulty never comes from shrinking cells.
 */
export interface MemoryGridState {
  cols: number
  rows: number
  /** Every lit cell, sorted. */
  targets: number[]
  /** The targets as shown, wave by wave: disjoint, together exactly `targets`. One wave = all at once. */
  waves: number[][]
  /** The wave on screen (show), or the one just shown (gap). */
  wave: number
  /** How long each wave stays lit. */
  showMs: number
  /** The blank between waves. */
  gapMs: number
  phase: 'show' | 'gap' | 'recall' | 'done'
  picked: number[]
  wrong: number | null
  timedOut: boolean
  /** A 50%-density board (a screen no regular board fits). */
  fallback: boolean
}

/** The most cells a trial ever shows — 7×5 / 5×7 at 40%. */
export const FLASH_GRID_MAX_CELLS = 14
/** The blank between waves, ms. */
export const FLASH_GRID_GAP_MS = 500
/** A wave is never shorter than this, so wave onsets stay ≥ 1s apart. */
const MIN_WAVE_MS = 500
/** Rejection sampling stops here (then a checkerboard pattern, which breaks every ban). */
const MAX_TRIES = 300

type Shape = readonly [cols: number, rows: number]
interface Step {
  holds: number
  shapes: readonly Shape[]
}

/** Regular boards, ≤ 40% lit; each step comes landscape and portrait where it is not square. */
const REGULAR: readonly Step[] = [
  { holds: 3, shapes: [[3, 3]] },
  { holds: 6, shapes: [[4, 4]] },
  { holds: 9, shapes: [[5, 5]] },
  { holds: 12, shapes: [[6, 5], [5, 6]] },
  { holds: 14, shapes: [[7, 5], [5, 7]] },
]

/** 50%-density boards for a screen no regular board fits (only a lit 2×2 and 4 in a row banned). */
const FALLBACK: readonly Step[] = [
  { holds: 12, shapes: [[4, 6], [6, 4], [5, 5]] },
  { holds: 14, shapes: [[4, 7], [7, 4]] },
  { holds: 15, shapes: [[5, 6], [6, 5]] },
]

export interface FlashGridBoard {
  cols: number
  rows: number
  fallback: boolean
}

function screen(ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): { cols: number; rows: number } {
  return { cols: clamp(ctx.maxCols, 3, 7), rows: clamp(ctx.maxRows ?? 7, 3, 7) }
}

/** The board for `k` cells on this screen: the regular ladder, else the smallest 50% board; null when none fits. */
export function flashGridBoard(k: number, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): FlashGridBoard | null {
  const sc = screen(ctx)
  // Landscape first on a screen at least as wide as it is tall (desktop), portrait first on a phone.
  const order = (shapes: readonly Shape[]) => (sc.cols >= sc.rows ? shapes : [...shapes].sort((a, b) => a[0] - a[1] - (b[0] - b[1])))
  const fit = (steps: readonly Step[]) => {
    for (const step of steps) {
      if (step.holds < k) continue
      const shape = order(step.shapes).find(([c, r]) => c <= sc.cols && r <= sc.rows)
      if (shape) return { cols: shape[0], rows: shape[1] }
    }
    return null
  }
  // A regular board one step up from the smallest that fails never fits either (each is wider and taller).
  const first = REGULAR.find((s) => s.holds >= k)
  const regular = first ? fit([first]) : null
  if (regular) return { ...regular, fallback: false }
  const half = fit(FALLBACK)
  return half ? { ...half, fallback: true } : null
}

/** The most cells this screen shows at once (≤ 14). */
export function flashGridCapacity(ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): number {
  let k = 3
  while (k < FLASH_GRID_MAX_CELLS && flashGridBoard(k + 1, ctx)) k++
  return k
}

/** Exposure for `k` cells shown at once: 180ms a cell on 1s, never over 3s. */
export function flashGridExposureMs(k: number): number {
  return Math.min(3000, 1000 + 180 * k)
}

/** What a level means on this screen: cells, how many waves they come in, and for how long each. */
export function flashGridLevel(level: number, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): { level: number; cells: number; waves: number; showMs: number } {
  const kmax = flashGridCapacity(ctx)
  // L1 … kmax − 2 add a cell each; the two levels past them show the same cells in 2, then 3 waves.
  const lv = clamp(Math.round(Number.isFinite(level) ? level : 1), 1, kmax)
  const cells = Math.min(lv + 2, kmax)
  const waves = lv <= kmax - 2 ? 1 : lv - (kmax - 2) + 1
  const exposure = flashGridExposureMs(cells)
  const showMs = waves === 1 ? exposure : Math.max(MIN_WAVE_MS, Math.round((exposure - FLASH_GRID_GAP_MS) / waves))
  return { level: lv, cells, waves, showMs }
}

/** The lit cells break a ban: a lit 2×2, or `run` lit in a row (across or down). */
function breaksBans(cols: number, rows: number, lit: ReadonlySet<number>, opts: { square: boolean; run: number | null }): boolean {
  const on = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && lit.has(r * cols + c)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!on(c, r)) continue
      if (opts.square && on(c + 1, r) && on(c, r + 1) && on(c + 1, r + 1)) return true
      if (opts.run !== null) {
        let across = true
        let down = true
        for (let i = 1; i < opts.run; i++) {
          across &&= on(c + i, r)
          down &&= on(c, r + i)
        }
        if (across || down) return true
      }
    }
  }
  return false
}

function pattern(board: FlashGridBoard, k: number, rng: Rng): number[] {
  const area = board.cols * board.rows
  // Regular boards: from L4 (6 cells) no lit 2×2, from L8 (10 cells) no 3 in a row. 50% boards
  // (only ever from 7 cells) ban a lit 2×2 and 4 in a row.
  const bans = board.fallback ? { square: true, run: 4 } : { square: k >= 6, run: k >= 10 ? 3 : null }
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const cells = rng.sample(range(area), k)
    if (!breaksBans(board.cols, board.rows, new Set(cells), bans)) return cells.sort((a, b) => a - b)
  }
  // Practically never reached (worst board: ~2·10⁻⁹): one colour of a checkerboard has no two cells side by side.
  const parity = rng.int(0, 1)
  const squares = range(area).filter((i) => (Math.floor(i / board.cols) + (i % board.cols)) % 2 === parity)
  const pool = squares.length >= k ? squares : range(area).filter((i) => !squares.includes(i))
  return rng.sample(pool, k).sort((a, b) => a - b)
}

/** The targets split into `count` waves of near-equal size, in random membership. */
function splitWaves(targets: readonly number[], count: number, rng: Rng): number[][] {
  if (count <= 1) return [targets.slice()]
  const shuffled = rng.shuffle(targets)
  const out: number[][] = []
  let at = 0
  for (let w = 0; w < count; w++) {
    const size = Math.floor(targets.length / count) + (w < targets.length % count ? 1 : 0)
    out.push(shuffled.slice(at, at + size).sort((a, b) => a - b))
    at += size
  }
  return out
}

export const memoryGrid: BrainGameDef<MemoryGridState> = {
  id: 'memoryGrid',
  // The most cells this screen holds, plus the two wave levels: past that the puzzle stops changing.
  maxLevel: (ctx) => flashGridCapacity(ctx),
  spanLength: (level, ctx) => flashGridLevel(level, ctx).cells,
  create(level, rng, ctx) {
    const lv = flashGridLevel(level, ctx)
    // Every level up to the capacity has a board on this screen, by construction.
    const board = flashGridBoard(lv.cells, ctx) ?? { cols: 3, rows: 3, fallback: false }
    const targets = pattern(board, lv.cells, rng)
    return {
      cols: board.cols,
      rows: board.rows,
      targets,
      waves: splitWaves(targets, lv.waves, rng),
      wave: 0,
      showMs: lv.showMs,
      gapMs: FLASH_GRID_GAP_MS,
      phase: 'show',
      picked: [],
      wrong: null,
      timedOut: false,
      fallback: board.fallback,
    }
  },
  pendingMs: (s) => (s.phase === 'show' ? s.showMs : s.phase === 'gap' ? s.gapMs : null),
  advance(s) {
    if (s.phase === 'show') return s.wave + 1 < s.waves.length ? { ...s, phase: 'gap' } : { ...s, phase: 'recall' }
    if (s.phase === 'gap') return { ...s, phase: 'show', wave: s.wave + 1 }
    return s
  },
  acceptsInput: (s) => s.phase === 'recall',
  tap(s, i) {
    if (s.phase !== 'recall' || s.picked.includes(i)) return s
    if (!s.targets.includes(i)) return { ...s, wrong: i, phase: 'done' }
    const picked = [...s.picked, i]
    return { ...s, picked, phase: picked.length === s.targets.length ? 'done' : 'recall' }
  },
  timeout: (s) => (s.phase === 'done' ? s : { ...s, timedOut: true, phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    return {
      correct: s.wrong === null && !s.timedOut && s.picked.length === s.targets.length,
      accuracy: s.picked.length / s.targets.length,
    }
  },
  timeLimitMs: (s) => 3000 + s.targets.length * 900,
  view(s) {
    const showing = s.phase === 'show' ? s.waves[s.wave] : []
    const cells: CellView[] = range(s.cols * s.rows).map((i) => {
      if (s.phase === 'show') return { tone: showing.includes(i) ? 'lit' : 'idle' }
      if (s.phase === 'gap') return { tone: 'idle' }
      if (s.picked.includes(i)) return { tone: 'correct' }
      if (s.phase === 'done') {
        if (i === s.wrong) return { tone: 'wrong' }
        if (s.targets.includes(i)) return { tone: 'missed' }
      }
      return { tone: 'idle' }
    })
    const memorising = s.phase === 'show' || s.phase === 'gap'
    const view: GridView = {
      kind: 'grid',
      cols: s.cols,
      rows: s.rows,
      cells,
      locked: s.phase !== 'recall',
      prompt: memorising ? { key: 'play.memorize' } : { key: 'play.tapLit', params: { left: s.targets.length - s.picked.length } },
      // The header says how many cells this trial is («9칸»).
      chip: { key: 'play.cells', params: { count: s.targets.length } },
    }
    // Waves shown so far (●○○), through every show and blank of a wave trial — its sound reads them.
    if (memorising && s.waves.length > 1) view.progress = { kind: 'waves', done: s.wave + 1, total: s.waves.length }
    if (s.phase === 'show') view.showBar = { ms: s.showMs }
    return view
  },
  signature: (s) => `mg:${s.cols}x${s.rows}:${s.waves.length}:${s.waves.map((w) => w.join(',')).join('|')}`,
  solution: (s) => (s.phase === 'recall' ? s.targets.filter((t) => !s.picked.includes(t)) : null),
  mechanics(s) {
    // Board size by area (portrait and landscape count alike): 4×4, then 5×5 (or a 4×6 board), then
    // 30 cells (6×5), then 35 (7×5).
    const area = s.cols * s.rows
    const tags: string[] = []
    if (area >= 16) tags.push('memoryGrid.grid4')
    if (area >= 24) tags.push('memoryGrid.grid5')
    if (area >= 30) tags.push('memoryGrid.grid6')
    if (area >= 35) tags.push('memoryGrid.grid7')
    if (s.waves.length >= 2) tags.push('memoryGrid.waves')
    if (s.waves.length >= 3) tags.push('memoryGrid.fastShow')
    return tags
  },
}
