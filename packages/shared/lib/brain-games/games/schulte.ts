import { range, type Rng } from '../rng'
import { mechanicInfo } from '../mechanics'
import type { BrainGameDef, CellView, CreateContext, GridView } from '../types'

/**
 * Numbers scattered on a grid; tap them in order. Visual search and sustained attention.
 *
 * One grid is one trial, but lives are spent per wrong TAP inside it (a tap on a number that is
 * not the next one), not per grid: a slow, clean grid costs nothing, and the grid stops as soon as
 * the round's remaining lives are gone. A timeout costs no life.
 *
 * The ladder (GAMES_DIFFICULTY_PLAN §3.4) changes what is asked, not only how fast: 1→9, 1→16,
 * counting down, 1→25, a run of two-digit numbers, counting in 2s or 3s with no "next" shown, two
 * series taken in turn (white, and amber in a box), the amber one counting down, a board that
 * reshuffles after every tap, found numbers left unmarked, and on a desktop a 6×6 board. Cells never
 * shrink to make it harder (EVIDENCE §2.1): a phone stays at 5×5.
 *
 * At the top (L19-26) a memory board (owner 2026-11-13: «난이도 높은 것은 카드 뒤집어서 기억해서 하도록.
 * 난이도 더 높이려면 카드 갯수 늘리고 뒤집는 시간 빨리»): the numbers show for a moment, the cards turn
 * face down, and the player taps 1 → N from memory. A wrong tap is a miss as on any board (a life),
 * and turns that card up for a moment. It starts small with its card — 2×2 — then 3×2, 3×3, 4×3, 4×4,
 * each size first with a longer look, then a shorter one (SCHULTE_MEMORY). The look is a memorise
 * phase: relaxed timing does not lengthen it (EVIDENCE §4), only the clock for tapping.
 */
export type SchulteMode = 'asc' | 'desc' | 'two' | 'skip' | 'alt' | 'altOpp' | 'shuffle' | 'memory'

export interface SchulteState {
  /** Board side — the longer side on a memory board (the flawless-hunt achievement reads it). */
  n: number
  cols: number
  rows: number
  level: number
  mode: SchulteMode
  /** Found numbers keep their look: the player keeps track of how far they got. */
  unmarked: boolean
  /** cell index → number shown */
  values: number[]
  /** cell index → the second series (amber, boxed) of an alternation board */
  amber: boolean[]
  /** Cell indices in tap order. A reshuffle board recomputes it after every tap. */
  sequence: number[]
  /** Skip counting's step (1 on every other board). */
  step: number
  found: number
  mistakes: number
  /** Wrong taps this grid can absorb — the round's lives left when it was made. */
  maxMistakes: number
  flashWrong: number | null
  /** An unmarked board's number just found, lit for a moment (it does not stay marked). */
  ack: number | null
  /** After a wrong tap on a board that never names the next number: it is named for 1.5s. */
  hint: boolean
  timedOut: boolean
  seed: number
  /** A memory board: the numbers on show ('preview', no input), then face down ('play'). Others: 'play'. */
  phase: 'preview' | 'play'
  /** How long a memory board shows its numbers. */
  previewMs: number
  /** A memory board's card turned up by a wrong tap, for SCHULTE_PEEK_MS. */
  peek: number | null
}

/** The clock reaches its floor around L23; the memory boards run on to L26, where the level stops. */
export const SCHULTE_MAX_LEVEL = 26
/** How long the next number is named after a wrong tap on a counting or alternation board. */
export const SCHULTE_HINT_MS = 1500
/** How long an unmarked board lights the number just found (a tap that did register). */
export const SCHULTE_ACK_MS = 250
/** How long a memory board's card stays up after a wrong tap on it (then it turns back). */
export const SCHULTE_PEEK_MS = 900

/**
 * The memory boards, one a level from L19: a new size first with a longer look, then a shorter one.
 * The level's board is fitted to the screen (a 4×3 board stands as 3×4 on three columns; 4×4 becomes
 * 3×5 there) — never smaller cells.
 */
export const SCHULTE_MEMORY: readonly { level: number; cols: number; rows: number; previewMs: number }[] = [
  { level: 19, cols: 2, rows: 2, previewMs: 3000 },
  { level: 20, cols: 3, rows: 2, previewMs: 4000 },
  { level: 21, cols: 3, rows: 3, previewMs: 6000 },
  { level: 22, cols: 3, rows: 3, previewMs: 4500 },
  { level: 23, cols: 4, rows: 3, previewMs: 8000 },
  { level: 24, cols: 4, rows: 3, previewMs: 6000 },
  { level: 25, cols: 4, rows: 4, previewMs: 10000 },
  { level: 26, cols: 4, rows: 4, previewMs: 7500 },
]

/** A memory board's clock for tapping (after the look): 2.5 s, then 1.5 s a card. It does not tighten — the look does. */
export function schulteMemoryLimitMs(cards: number): number {
  return 2500 + 1500 * cards
}
/** Time per number grows with the task: counting down, two digits, counting in steps, two series. */
export const SCHULTE_MODE_MUL: Readonly<Record<SchulteMode, number>> = {
  asc: 1,
  desc: 1.1,
  two: 1.15,
  skip: 1.6,
  alt: 2.2,
  altOpp: 2.6,
  shuffle: 1.7,
  // Memory boards have their own clock (schulteMemoryLimitMs).
  memory: 1,
}
export const SCHULTE_UNMARKED_MUL = 1.15

/** Boards whose prompt never names the next number: the player counts (from L9). */
export const SCHULTE_HIDES_NEXT: ReadonlySet<SchulteMode> = new Set<SchulteMode>(['skip', 'alt', 'altOpp'])

/** The boards that need tracking (skip, two series) or are reshuffled — most boards from L10. */
export const SCHULTE_TRACKING: ReadonlySet<SchulteMode> = new Set<SchulteMode>(['skip', 'alt', 'altOpp', 'shuffle', 'memory'])

/** The rule card (mechanics.ts) each mode is, when it is one. */
const MODE_RULE: Partial<Record<SchulteMode, string>> = {
  desc: 'schulte.descending',
  alt: 'schulte.alternate',
  altOpp: 'schulte.alternateOpposite',
  shuffle: 'schulte.reshuffle',
  memory: 'schulte.memory',
}

/**
 * The input clock for one board: 1.5s to take it in, then a time per number that grows with the
 * board (a bigger board is a longer search per number) and with the task, tightening 7% a level to
 * a fifth of it around L23.
 */
export function schulteLimitMs(cells: number, mode: SchulteMode, unmarked: boolean, level: number): number {
  const lv = clampLevel(level)
  const mul = SCHULTE_MODE_MUL[mode] * (unmarked ? SCHULTE_UNMARKED_MUL : 1)
  return Math.round(1500 + cells * (1600 + 90 * cells) * mul * Math.max(0.2, Math.pow(0.93, lv - 1)))
}

export interface SchulteModeSpec {
  mode: SchulteMode
  /** The level's board side before the screen limits it (a reshuffle board is one smaller). */
  side: number
  unmarked: boolean
  /** Share within the draw (not normalised). */
  w: number
  /** A memory board's size and look (SCHULTE_MEMORY). */
  memory?: { cols: number; rows: number; previewMs: number }
}

const spec = (mode: SchulteMode, side: number, w = 1, unmarked = false): SchulteModeSpec => ({ mode, side, unmarked, w })

/** The first memory level. */
export const SCHULTE_MEMORY_FROM = SCHULTE_MEMORY[0].level

/** Where each band starts — the level at which the board or the task changes (every memory level is one). */
export const SCHULTE_BANDS = [1, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 16, 18, ...SCHULTE_MEMORY.map((m) => m.level)] as const

const BAND_MODES: Readonly<Record<number, readonly SchulteModeSpec[]>> = {
  1: [spec('asc', 3)],
  3: [spec('asc', 4)],
  // With the boards from the levels below, half the boards count down.
  5: [spec('desc', 4)],
  6: [spec('asc', 5, 0.6), spec('desc', 5, 0.4)],
  8: [spec('two', 5)],
  9: [spec('skip', 5)],
  10: [spec('alt', 4)],
  11: [spec('alt', 5)],
  12: [spec('altOpp', 4)],
  13: [spec('altOpp', 5)],
  // A 5-side level, so the reshuffle board is 4×4: one size smaller, as its card says.
  14: [spec('shuffle', 5)],
  // Found numbers stay as they are, on the boards met so far.
  16: (['asc', 'desc', 'two', 'skip', 'alt'] as const).map((m) => spec(m, 5, 1, true)),
  // The biggest board a screen holds (6×6 on a desktop), every task, half the simple ones unmarked;
  // from here only the clock moves.
  18: [
    spec('asc', 6, 0.5),
    spec('asc', 6, 0.5, true),
    spec('desc', 6, 0.5),
    spec('desc', 6, 0.5, true),
    spec('two', 6, 0.5),
    spec('two', 6, 0.5, true),
    spec('skip', 6, 0.75),
    spec('skip', 6, 0.75, true),
    spec('alt', 6, 1.5),
    spec('altOpp', 6, 1.5),
    spec('shuffle', 6, 1.5),
  ],
  ...Object.fromEntries(
    SCHULTE_MEMORY.map((m) => [m.level, [{ mode: 'memory', side: Math.max(m.cols, m.rows), unmarked: false, w: 1, memory: { cols: m.cols, rows: m.rows, previewMs: m.previewMs } }]]),
  ),
}

function clampLevel(level: number): number {
  return Math.max(1, Math.min(SCHULTE_MAX_LEVEL, Number.isFinite(level) ? level : 1))
}

function whole(level: number): number {
  return Math.floor(clampLevel(level) + 1e-9)
}

/** The band a level is in (its start level). */
export function schulteBand(level: number): number {
  const b = whole(level)
  let band: number = SCHULTE_BANDS[0]
  for (const start of SCHULTE_BANDS) if (start <= b) band = start
  return band
}

function scaled(specs: readonly SchulteModeSpec[], total: number): SchulteModeSpec[] {
  const sum = specs.reduce((a, s) => a + s.w, 0)
  return specs.map((s) => ({ ...s, w: (s.w / sum) * total }))
}

/**
 * A blocked rule's board becomes that level's content without it, at its own clock: counting down
 * → counting up; two series or a reshuffle → counting in steps or a two-digit run — or a rule met
 * before it that is not blocked, so the lowest unmet rule (the one the round lets through) can still
 * come up at a level whose own boards are all past it.
 */
function unblocked(s: SchulteModeSpec, blocked: readonly string[]): SchulteModeSpec[] {
  const rule = MODE_RULE[s.mode]
  if (!rule || !blocked.includes(rule)) return [s]
  // A memory board not yet introduced: the top regular boards (themselves without their blocked rules).
  if (s.mode === 'memory') return scaled(BAND_MODES[18], s.w).flatMap((x) => unblocked(x, blocked))
  if (s.mode === 'desc') return [{ ...s, mode: 'asc' }]
  const from = mechanicInfo(rule)?.from ?? Infinity
  const open = (['desc', 'alt', 'altOpp'] as const).filter((m) => {
    const r = MODE_RULE[m] as string
    return !blocked.includes(r) && (mechanicInfo(r)?.from ?? Infinity) < from
  })
  const subs: SchulteMode[] = ['skip', 'two', ...open]
  return subs.map((mode) => ({ ...s, mode, w: s.w / subs.length }))
}

/**
 * What a board at this level can be, with its share. From L5 half the draw is the level's own band
 * and half the bands of the three levels below — on the memory levels (L19+) the top regular band
 * instead, so every level keeps both kinds of board (placement and practice: the own band only);
 * blocked rules are swapped out; from L8 the last board's task is never repeated.
 */
export function schulteModes(level: number, ctx: Pick<CreateContext, 'blockRules' | 'trialKind' | 'recent'>): SchulteModeSpec[] {
  const b = whole(level)
  const own = BAND_MODES[schulteBand(b)]
  const below = b >= SCHULTE_MEMORY_FROM ? [18] : [b - 1, b - 2, b - 3].filter((x) => x >= 1)
  const mixed = b >= 5 && ctx.trialKind !== 'placement' && ctx.trialKind !== 'practice'
  let list = mixed ? [...scaled(own, 0.5), ...below.flatMap((x) => scaled(BAND_MODES[schulteBand(x)], 0.5 / below.length))] : scaled(own, 1)
  list = list.flatMap((s) => unblocked(s, ctx.blockRules))
  const last = ctx.recent.length > 0 ? ctx.recent[ctx.recent.length - 1].kind : undefined
  if (b >= 8 && last) {
    const other = list.filter((s) => s.mode !== last)
    if (other.length > 0) list = other
  }
  return list
}

function draw<T extends { w: number }>(items: readonly T[], rng: Rng): T {
  const total = items.reduce((a, x) => a + x.w, 0)
  let r = rng.next() * total
  for (const x of items) {
    r -= x.w
    if (r < 0) return x
  }
  return items[items.length - 1]
}

/** The board side on this screen: never wider or taller than cells ≥ 56dp allow; a reshuffle board one smaller. */
function boardSide(s: SchulteModeSpec, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): number {
  const fit = Math.max(3, Math.min(s.side, ctx.maxCols, ctx.maxRows))
  return s.mode === 'shuffle' ? Math.max(3, fit - 1) : fit
}

/** A memory board on this screen: as the level says, or turned, or as much of it as fits (cells never shrink). */
export function schulteMemoryBoard(m: { cols: number; rows: number }, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): { cols: number; rows: number } {
  const maxCols = Math.max(3, Math.min(7, ctx.maxCols))
  const maxRows = Math.max(3, Math.min(7, ctx.maxRows))
  if (m.cols <= maxCols && m.rows <= maxRows) return { cols: m.cols, rows: m.rows }
  if (m.rows <= maxCols && m.cols <= maxRows) return { cols: m.rows, rows: m.cols }
  const cols = Math.min(m.cols, maxCols)
  return { cols, rows: Math.min(maxRows, Math.ceil((m.cols * m.rows) / cols)) }
}

/** The number tapped `rank`-th, and whether it is the amber series. */
function label(mode: SchulteMode, rank: number, cells: number, start: number, step: number): { value: number; amber: boolean } {
  switch (mode) {
    case 'desc':
      return { value: cells - rank, amber: false }
    case 'two':
      return { value: start + rank, amber: false }
    case 'skip':
      return { value: step * (rank + 1), amber: false }
    case 'alt':
      // white 1 → amber 1 → white 2 → amber 2 …
      return { value: Math.floor(rank / 2) + 1, amber: rank % 2 === 1 }
    case 'altOpp':
      // white 1 → amber N → white 2 → amber N−1 …
      return rank % 2 === 0 ? { value: rank / 2 + 1, amber: false } : { value: Math.floor(cells / 2) - (rank - 1) / 2, amber: true }
    default:
      return { value: rank + 1, amber: false }
  }
}

/** A deterministic permutation, so `tap` stays a pure function of the state. */
function permutation(count: number, seed: number): number[] {
  const out = range(count)
  let a = seed >>> 0
  for (let i = count - 1; i > 0; i--) {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9e3779b9) >>> 0
    const j = a % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Every number moves to a new cell; the tap order follows its numbers. */
function reshuffled(s: SchulteState, seed: number): Pick<SchulteState, 'values' | 'amber' | 'sequence'> {
  const from = permutation(s.values.length, seed) // new cell j shows what cell from[j] showed
  const to = new Array<number>(from.length)
  from.forEach((old, j) => {
    to[old] = j
  })
  return { values: from.map((o) => s.values[o]), amber: from.map((o) => s.amber[o]), sequence: s.sequence.map((o) => to[o]) }
}

function rankOf(s: SchulteState): number[] {
  const out = new Array<number>(s.values.length)
  s.sequence.forEach((cell, r) => {
    out[cell] = r
  })
  return out
}

/**
 * A memory board: the numbers on show with the countdown bar (locked), then every card face down —
 * found ones turn up and stay (faded, as found numbers are), a wrong tap turns that card up for a
 * moment. Once the board is over, every number shows (the ones not reached marked missed).
 */
function memoryView(s: SchulteState): GridView {
  const total = s.values.length
  const rank = rankOf(s)
  const over = schulte.outcome(s) !== null
  const lives = s.maxMistakes - s.mistakes
  const badge = { key: 'play.memoryBadge' }
  if (s.phase === 'preview') {
    return {
      kind: 'grid',
      cols: s.cols,
      rows: s.rows,
      cells: s.values.map((v) => ({ label: String(v), tone: 'idle' })),
      locked: true,
      showBar: { ms: s.previewMs },
      badge,
      prompt: { key: 'play.memorizeNumbers', params: { max: total, lives } },
    }
  }
  const cells = s.values.map((v, i): CellView => {
    if (rank[i] < s.found) return { label: String(v), tone: 'done' }
    if (i === s.peek || i === s.flashWrong) return { label: String(v), tone: 'wrong' }
    return over ? { label: String(v), tone: 'missed' } : { tone: 'faceDown' }
  })
  const next = s.values[s.sequence[Math.min(s.found, total - 1)]]
  return {
    kind: 'grid',
    cols: s.cols,
    rows: s.rows,
    cells,
    locked: false,
    badge,
    prompt: { key: 'play.tapAscending', params: { max: total, next, lives } },
  }
}

export const schulte: BrainGameDef<SchulteState> = {
  id: 'schulte',
  create(level, rng, ctx) {
    const lv = clampLevel(level)
    const pick = draw(schulteModes(lv, ctx), rng)
    const dims = pick.memory ? schulteMemoryBoard(pick.memory, ctx) : null
    const side = dims ? Math.max(dims.cols, dims.rows) : boardSide(pick, ctx)
    const cols = dims ? dims.cols : side
    const rows = dims ? dims.rows : side
    const n = side
    const cells = cols * rows
    // A run of two-digit numbers that stays two-digit; counting in 3s only while it stays under 100.
    const start = pick.mode === 'two' ? rng.int(10, Math.min(70, 100 - cells)) : 1
    const step = pick.mode === 'skip' ? (cells * 3 < 100 && rng.chance(0.5) ? 3 : 2) : 1
    const rankAt = rng.shuffle(range(cells)) // cell → its place in the tap order
    const sequence = new Array<number>(cells)
    rankAt.forEach((r, i) => {
      sequence[r] = i
    })
    const labels = rankAt.map((r) => label(pick.mode, r, cells, start, step))
    return {
      n,
      cols,
      rows,
      level: lv,
      mode: pick.mode,
      unmarked: pick.unmarked,
      values: labels.map((l) => l.value),
      amber: labels.map((l) => l.amber),
      sequence,
      step,
      found: 0,
      mistakes: 0,
      maxMistakes: Math.max(1, ctx.livesLeft),
      flashWrong: null,
      ack: null,
      hint: false,
      timedOut: false,
      seed: rng.int(1, 0x7ffffff),
      phase: pick.memory ? 'preview' : 'play',
      previewMs: pick.memory ? pick.memory.previewMs : 0,
      peek: null,
    }
  },
  pendingMs: (s) => {
    if (schulte.outcome(s) !== null) return null
    if (s.phase === 'preview') return s.previewMs
    if (s.peek !== null) return SCHULTE_PEEK_MS
    return s.ack !== null ? SCHULTE_ACK_MS : s.hint ? SCHULTE_HINT_MS : null
  },
  advance: (s) => {
    if (s.phase === 'preview') return { ...s, phase: 'play' }
    if (s.peek !== null) return { ...s, peek: null, flashWrong: null }
    return s.ack !== null ? { ...s, ack: null } : s.hint ? { ...s, hint: false } : s
  },
  acceptsInput: (s) => schulte.outcome(s) === null && s.phase === 'play',
  tap(s, i) {
    if (schulte.outcome(s) !== null || s.phase !== 'play' || i < 0 || i >= s.values.length) return s
    const rank = s.sequence.indexOf(i)
    if (s.mode === 'memory') {
      // Face up already (found): ignored. The next number: it turns up and stays. Any other: a miss,
      // and that card shows its number for a moment.
      if (rank < s.found) return s
      if (rank === s.found) return { ...s, found: s.found + 1, flashWrong: null, peek: null }
      return { ...s, mistakes: s.mistakes + 1, flashWrong: i, peek: i }
    }
    if (rank === s.found) {
      const found = s.found + 1
      const moved = s.mode === 'shuffle' && found < s.values.length ? reshuffled(s, s.seed + found) : null
      const sequence = moved ? moved.sequence : s.sequence
      return { ...s, ...moved, found, flashWrong: null, hint: false, ack: s.unmarked ? sequence[found - 1] : null }
    }
    // A number already found: it is faded, or it is the one just found (a double tap) — ignored.
    // On an unmarked board an earlier one is a wrong tap: keeping track is what that board asks.
    if (rank < s.found && (!s.unmarked || rank === s.found - 1)) return s
    return { ...s, mistakes: s.mistakes + 1, flashWrong: i, ack: null, hint: SCHULTE_HIDES_NEXT.has(s.mode) }
  },
  timeout: (s) => ({ ...s, timedOut: true }),
  outcome(s) {
    const total = s.values.length
    if (s.found === total) return { correct: true, accuracy: 1, livesSpent: s.mistakes }
    if (s.mistakes >= s.maxMistakes || s.timedOut) return { correct: false, accuracy: s.found / total, livesSpent: s.mistakes }
    return null
  },
  timeLimitMs: (s) => (s.mode === 'memory' ? schulteMemoryLimitMs(s.values.length) : schulteLimitMs(s.n * s.n, s.mode, s.unmarked, s.level)),
  maxLevel: () => SCHULTE_MAX_LEVEL,
  view(s) {
    if (s.mode === 'memory') return memoryView(s)
    const total = s.values.length
    const rank = rankOf(s)
    const over = schulte.outcome(s) !== null
    const cells = s.values.map((value, i): CellView => {
      const done = rank[i] < s.found
      const tone = i === s.flashWrong ? 'wrong' : i === s.ack ? 'correct' : done && !s.unmarked ? 'done' : 'idle'
      // The second series: amber ink and a box — colour is never the only cue.
      return s.amber[i] ? { label: String(value), tone, ink: 'amber', boxed: true } : { label: String(value), tone }
    })
    const nextCell = s.found < total ? s.sequence[s.found] : null
    const nextAmber = nextCell !== null && s.amber[nextCell]
    // Once the board is cleared, the last number found.
    const shown = s.values[s.sequence[Math.min(s.found, total - 1)]]
    const lives = s.maxMistakes - s.mistakes
    const hinting = s.hint && !over && nextCell !== null
    // Counting and alternation boards name the next number only for a moment after a wrong tap.
    const nextParam: Record<string, number> = SCHULTE_HIDES_NEXT.has(s.mode) ? (hinting ? { next: shown } : {}) : { next: shown }
    const view: GridView = {
      kind: 'grid',
      cols: s.n,
      rows: s.n,
      cells,
      locked: false,
      prompt: { key: 'play.tapAscending', params: { max: total, ...nextParam, lives } },
    }
    const ink = nextAmber ? 'amber' : 'neutral'
    const hintChip = hinting ? { key: 'play.nextHint', params: { next: shown } } : null
    switch (s.mode) {
      case 'desc':
        view.prompt = { key: 'play.tapDescending', params: { max: total, ...nextParam, lives } }
        break
      case 'two': {
        const from = Math.min(...s.values)
        view.prompt = { key: 'play.tapRange', params: { from, to: from + total - 1, ...nextParam, lives } }
        break
      }
      case 'skip':
        view.prompt = { key: 'play.tapSkip', params: { step: s.step, ...nextParam, lives } }
        view.chip = hintChip ?? { text: `+${s.step}` }
        break
      case 'alt':
        view.prompt = { key: 'play.tapAlternate', params: { ...nextParam, lives } }
        view.chip = { ...(hintChip ?? { text: '⇄' }), ink }
        break
      case 'altOpp':
        // White counts up, amber down: the chip's arrow is the next series' direction.
        view.prompt = { key: 'play.tapAlternateOpposite', params: { ...nextParam, lives } }
        view.chip = { ...(hintChip ?? { text: nextAmber ? '↓' : '↑' }), ink }
        break
    }
    return view
  },
  signature: (s) => `sc:${s.mode}${s.unmarked ? 'u' : ''}${s.mode === 'memory' ? `${s.cols}x${s.rows}` : ''}:${s.values.map((v, i) => (s.amber[i] ? `a${v}` : v)).join(',')}`,
  solution: (s) => (schulte.outcome(s) === null && s.phase === 'play' ? [s.sequence[s.found]] : null),
  mechanics(s) {
    const tags: string[] = []
    // A reshuffle grid is one size smaller on purpose; its size change is not "bigger grid" news.
    for (let n = 4; n <= 6; n++) if (s.n >= n) tags.push(`schulte.grid${n}`)
    if (s.mode === 'desc') tags.push('schulte.descending')
    if (s.mode === 'shuffle') tags.push('schulte.reshuffle')
    if (s.mode === 'two') tags.push('schulte.twoDigit')
    if (s.mode === 'skip') tags.push('schulte.skipCount')
    if (s.mode === 'alt') tags.push('schulte.alternate')
    if (s.mode === 'altOpp') tags.push('schulte.alternateOpposite')
    if (s.unmarked) tags.push('schulte.unmarked')
    if (s.mode === 'memory') tags.push('schulte.memory')
    return tags
  },
  trialInfo: (s) => ({ kind: s.mode }),
}
