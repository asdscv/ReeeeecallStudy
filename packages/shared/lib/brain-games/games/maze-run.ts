import { MAZE_WALL, type BrainGameDef, type CreateContext, type MazeView } from '../types'
import type { Rng } from '../rng'

/**
 * Maze Run (미로 찾기) — drag from the start along the corridors to the goal (owner 2026-11-13:
 * «미로찾기는 어때? 드래그하면서 할 수 있도록»). Input is `tap(cell)`; see MazeView in types.ts.
 *
 * Every maze is a perfect maze (exactly one way between any two cells) grown from the trial's seed
 * by a growing-tree carve: `branch` is its chance of branching off an older cell instead of the
 * newest — 0 is the recursive backtracker (long corridors, few dead ends), 1 is Prim-like (many short
 * dead ends). The start and goal are dead ends, the way between them a chosen share of the maze (or
 * its longest way), keys sit at the ends of their own dead-end branches off that way, so every key is
 * a real detour. Shortest ways are exact (in a perfect maze the only way is the shortest).
 *
 * The ladder (the owner's bar: start small, grow, a new kind starts small again with a card;
 * harder = more cells and less time; the top beats a sharp adult):
 *   L1-5   open mazes, few dead ends, a moderate way: 4×4 → 5×5 → 6×6 → 7×7 → 8×8
 *   L6-10  winding (a notice): bushier mazes, the longest way they have: 6×6 → … → 10×10
 *   L11-15 keys (a rule): visit 1 → 2 → 3 before the goal: 4×4 one key … 8×8 three keys,
 *          numbered out of the order you meet them at L15
 *   L16-20 hidden walls (a rule): shown for a preview, then hidden — a bump into a hidden wall
 *          flashes it and spends one of the maze's forgiven bumps: 4×4 for 8 s, 3 bumps … 5×7 for
 *          5 s, 2 bumps; the route's turns (what there is to remember) grow band by band
 *   L21-24 hidden walls and keys (a notice): 4×4 one key … 5×7 two keys out of order, 5 s
 * Sizes are portrait (a wide screen turns them) and capped by the screen: cells are never under
 * MAZE_MIN_CELL (44dp) — a phone's 8×8 is 7×8 — and a hidden maze's never under 56dp, the game-cell
 * bar (EVIDENCE §5), because there a slip across a wall costs a bump.
 *
 * The clock (from when the walls hide, in a hidden maze) is a brisk adult's time for the actual maze
 * (mazePar: its whole way's steps, the forks met on it, its cells and keys) times the band's pace:
 * 4.5× at L1, 1.25× at L10; each new kind is generous again. Modelled (brain-maze-run-ladder.test.ts,
 * not measured people): a slow 75-year-old clears L1-3 ≥ 95% and settles near L4; a sharp adult
 * meets the clock at L10 and is beaten at L24 about five times in six.
 */

/** The smallest a maze cell is drawn, dp (walls are lines between cells, no gaps). */
export const MAZE_MIN_CELL = 44
/** A hidden maze's smallest cell: the 56dp game-cell bar (EVIDENCE §5) — a slip there is a bump. */
export const MAZE_HIDDEN_MIN_CELL = 56

/**
 * The maze's colours, for both platforms, on a white face: walls black lines, the path a thick
 * Okabe–Ito blue line through the cell centres, the start a blue ring, keys vermillion key shapes
 * carrying their number (white), the goal a black flag (an outline while shut), a bumped wall a
 * thick black line that flashes (with a shake) — never a third hue: Okabe–Ito's reddish purple
 * collapses into the blue path for protans (12 ΔE2000), its orange, yellow and sky blue are under
 * 3:1 on white, its bluish green would pair with vermillion as red against green. Blue and
 * vermillion stay ≥ 38 ΔE2000 apart in protan, deutan and tritan simulation, each ≥ 3:1 on the face
 * (brain-maze-run-ladder.test.ts). Shape, line weight and the key numbers carry the meaning.
 */
export const MAZE_COLORS = {
  face: '#FFFFFF',
  wall: '#000000',
  path: '#0072B2',
  start: '#0072B2',
  key: '#D55E00',
  goal: '#000000',
  bump: '#000000',
} as const

export type MazeKind = 'open' | 'winding' | 'keys' | 'memory' | 'memoryKeys'

export interface MazeBand {
  kind: MazeKind
  cols: number
  rows: number
  keys: number
  hidden: boolean
  /** How long the walls show before they hide (hidden mazes; 0 otherwise). */
  previewMs: number
  /** The carve's chance of branching off an older cell: 0 long corridors … 1 many short dead ends. */
  branch: number
  /** The start–goal way's steps as a share of the cells, [at least, at most]; 'far' = the maze's longest way. */
  way: readonly [number, number] | 'far'
  /** Keys numbered in the order the way meets them ('route'), or not ('mixed': plan the order). */
  keyOrder: 'route' | 'mixed'
  /** How far off the way a key's dead end reaches, at least (steps). */
  keyDepth: number
  /** Hidden mazes: bumps forgiven — one more ends the trial (dots, never hearts). */
  bumps: number
  /**
   * Hidden mazes: the whole walk's turns (changes of direction, a U-turn out of a key's dead end
   * included), [at least, at most] — what there is to hold in mind, grown band by band.
   */
  turns?: readonly [number, number]
  /** The clock as a multiple of the maze's par (a brisk adult's time). */
  pace: number
}

const OPEN = (cols: number, rows: number, pace: number): MazeBand => ({ kind: 'open', cols, rows, keys: 0, hidden: false, previewMs: 0, branch: 0.15, way: [0.28, 0.5], keyOrder: 'route', keyDepth: 0, bumps: 0, pace })
const WINDING = (cols: number, rows: number, pace: number): MazeBand => ({ ...OPEN(cols, rows, pace), kind: 'winding', branch: 0.5, way: 'far' })
const KEYS = (cols: number, rows: number, keys: number, keyOrder: MazeBand['keyOrder'], pace: number): MazeBand => ({
  ...OPEN(cols, rows, pace),
  kind: 'keys',
  keys,
  branch: 0.5,
  way: [0.25, 0.45],
  keyOrder,
  keyDepth: cols * rows >= 49 ? 3 : 2,
})
const MEMORY = (cols: number, rows: number, previewMs: number, bumps: number, turns: readonly [number, number], pace: number): MazeBand => ({
  ...OPEN(cols, rows, pace),
  kind: 'memory',
  hidden: true,
  previewMs,
  branch: 0.35,
  way: [0.25, 0.55],
  bumps,
  turns,
})
const MEMORY_KEYS = (cols: number, rows: number, keys: number, keyOrder: MazeBand['keyOrder'], previewMs: number, bumps: number, turns: readonly [number, number], pace: number): MazeBand => ({
  ...MEMORY(cols, rows, previewMs, bumps, turns, pace),
  kind: 'memoryKeys',
  keys,
  branch: 0.5,
  way: [0.15, 0.45],
  keyOrder,
  keyDepth: 1,
})

/** Band b is MAZE_LADDER[b − 1]. Portrait sizes; a wide screen turns them, a small one caps them. */
export const MAZE_LADDER: readonly MazeBand[] = [
  OPEN(4, 4, 4.5),
  OPEN(5, 5, 4),
  OPEN(6, 6, 3.6),
  OPEN(7, 7, 3.1),
  OPEN(8, 8, 2.7),
  WINDING(6, 6, 2.4),
  WINDING(7, 7, 2.1),
  WINDING(8, 8, 1.8),
  WINDING(9, 9, 1.5),
  WINDING(10, 10, 1.25),
  KEYS(4, 4, 1, 'route', 3),
  KEYS(5, 5, 1, 'route', 2.6),
  KEYS(6, 6, 2, 'route', 2.2),
  KEYS(7, 7, 2, 'route', 1.8),
  KEYS(8, 8, 3, 'mixed', 1.5),
  MEMORY(4, 4, 8000, 3, [2, 4], 3.2),
  MEMORY(5, 5, 8000, 3, [3, 6], 2.8),
  MEMORY(5, 5, 6000, 2, [4, 6], 2.5),
  MEMORY(5, 6, 6000, 2, [5, 8], 2.2),
  MEMORY(5, 7, 5000, 2, [6, 9], 2),
  MEMORY_KEYS(4, 4, 1, 'route', 7000, 3, [5, 8], 2.6),
  MEMORY_KEYS(5, 5, 1, 'route', 6000, 2, [7, 10], 2.3),
  MEMORY_KEYS(5, 6, 2, 'route', 6000, 2, [9, 12], 2),
  MEMORY_KEYS(5, 7, 2, 'mixed', 5000, 2, [11, 14], 1.8),
]

export const MAZE_MAX_LEVEL = MAZE_LADDER.length

/**
 * The band a level plays. A band whose rule this trial must not use (ctx.blockRules: placement, or a
 * rule not yet introduced) plays the highest band below it without that rule — the hardest maze the
 * player may meet, never a new rule met cold.
 */
export function mazeBand(level: number, blockRules: readonly string[] = []): MazeBand & { band: number } {
  const lv = Number.isFinite(level) ? Math.min(MAZE_MAX_LEVEL, Math.max(1, level)) : 1
  const allowed = (r: MazeBand) => (r.keys === 0 || !blockRules.includes('mazeRun.keys')) && (!r.hidden || !blockRules.includes('mazeRun.hidden'))
  let b = Math.floor(lv)
  while (b > 1 && !allowed(MAZE_LADDER[b - 1])) b--
  return { ...MAZE_LADDER[b - 1], band: b }
}

/**
 * The most cells across and down this screen holds at `minCell` dp (from the 56dp grid's columns and
 * rows: maxColsFor floors (width + 8) / 64, so the board is at least maxCols·64 − 8 wide).
 */
export function mazeFit(ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>, minCell: number = MAZE_MIN_CELL): { cols: number; rows: number } {
  const w = Math.max(3, Math.min(7, ctx.maxCols)) * 64 - 8
  const h = Math.max(3, Math.min(7, ctx.maxRows ?? 7)) * 64 - 8
  return { cols: Math.floor(w / minCell), rows: Math.floor(h / minCell) }
}

/** The band's size on this screen: portrait on a phone, turned on a screen at least as wide as tall; capped only if neither fits. */
export function mazeSize(b: Pick<MazeBand, 'cols' | 'rows' | 'hidden'>, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>): { cols: number; rows: number } {
  const fit = mazeFit(ctx, b.hidden ? MAZE_HIDDEN_MIN_CELL : MAZE_MIN_CELL)
  const wide = ctx.maxCols >= (ctx.maxRows ?? 7)
  const shapes: [number, number][] = wide ? [[b.rows, b.cols], [b.cols, b.rows]] : [[b.cols, b.rows], [b.rows, b.cols]]
  const ok = shapes.find(([c, r]) => c <= fit.cols && r <= fit.rows)
  if (ok) return { cols: ok[0], rows: ok[1] }
  // Neither fits: the longer side down the screen's longer side, each capped.
  const [long, short] = [Math.max(b.cols, b.rows), Math.min(b.cols, b.rows)]
  return fit.cols >= fit.rows ? { cols: Math.min(long, fit.cols), rows: Math.min(short, fit.rows) } : { cols: Math.min(short, fit.cols), rows: Math.min(long, fit.rows) }
}

/** What the clock is made from: the whole way's steps, the forks met on it, the cells, the keys. */
export interface MazeMeasure {
  steps: number
  forks: number
  cells: number
  keys: number
}

/**
 * A brisk adult's time for a maze (ms): 1.5 s to start, 0.25 s a step (0.35 s walking blind), 0.5 s
 * a fork met, 25 ms a cell to take the maze in, 1.5 s a key to plan.
 */
export function mazePar(m: MazeMeasure, hidden: boolean): number {
  return 1500 + m.steps * (hidden ? 350 : 250) + m.forks * 500 + m.cells * 25 + m.keys * 1500
}

/**
 * The clock: the par × the band's pace (4.5× at L1 → 1.25× at L10; each new kind generous again) ×
 * (1.1 − 0.2·frac(L)), so each staircase step inside a band is a little tighter. Rounded to 100 ms.
 */
export function mazeLimitMs(level: number, b: Pick<MazeBand, 'hidden' | 'pace'>, m: MazeMeasure): number {
  const lv = Math.max(1, Math.min(MAZE_MAX_LEVEL, Number.isFinite(level) ? level : 1))
  return Math.round((mazePar(m, b.hidden) * b.pace * (1.1 - 0.2 * (lv - Math.floor(lv)))) / 100) * 100
}

// ── the maze ────────────────────────────────────────────────────────────────

const SIDES = [
  { bit: MAZE_WALL.top, opposite: MAZE_WALL.bottom, dc: 0, dr: -1 },
  { bit: MAZE_WALL.right, opposite: MAZE_WALL.left, dc: 1, dr: 0 },
  { bit: MAZE_WALL.bottom, opposite: MAZE_WALL.top, dc: 0, dr: 1 },
  { bit: MAZE_WALL.left, opposite: MAZE_WALL.right, dc: -1, dr: 0 },
] as const

/** The side of `a` that faces its neighbour `b`, or null when they are not neighbours. */
function sideBetween(cols: number, a: number, b: number): (typeof SIDES)[number] | null {
  const [ac, ar] = [a % cols, Math.floor(a / cols)]
  const [bc, br] = [b % cols, Math.floor(b / cols)]
  return SIDES.find((s) => ac + s.dc === bc && ar + s.dr === br) ?? null
}

function neighbours(cols: number, rows: number, cell: number): { cell: number; side: (typeof SIDES)[number] }[] {
  const c = cell % cols
  const r = Math.floor(cell / cols)
  return SIDES.filter((s) => c + s.dc >= 0 && c + s.dc < cols && r + s.dr >= 0 && r + s.dr < rows).map((side) => ({ cell: (r + side.dr) * cols + c + side.dc, side }))
}

/** Open sides of a cell (a dead end has one). */
function degree(walls: readonly number[], cell: number, cols: number, rows: number): number {
  return neighbours(cols, rows, cell).filter((n) => !(walls[cell] & n.side.bit)).length
}

/** A perfect maze by the growing tree: from the active cells, the newest (or, with chance `branch`, any) grows into an unvisited neighbour. */
function carve(cols: number, rows: number, branch: number, rng: Rng): number[] {
  const n = cols * rows
  const walls = Array.from({ length: n }, () => 15)
  const seen = new Uint8Array(n)
  const first = rng.int(0, n - 1)
  seen[first] = 1
  const active = [first]
  while (active.length) {
    const i = rng.chance(branch) ? Math.floor(rng.next() * active.length) : active.length - 1
    const cur = active[i]
    const open = neighbours(cols, rows, cur).filter((x) => !seen[x.cell])
    if (open.length === 0) {
      active.splice(i, 1)
      continue
    }
    const next = rng.pick(open)
    walls[cur] &= ~next.side.bit
    walls[next.cell] &= ~next.side.opposite
    seen[next.cell] = 1
    active.push(next.cell)
  }
  return walls
}

/** BFS through open sides: the distance to every cell, and the way back. */
function bfs(cols: number, rows: number, walls: readonly number[], from: number): { dist: number[]; prev: number[] } {
  const dist = walls.map(() => -1)
  const prev = walls.map(() => -1)
  dist[from] = 0
  const queue = [from]
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]
    for (const n of neighbours(cols, rows, cur)) {
      if (walls[cur] & n.side.bit || dist[n.cell] >= 0) continue
      dist[n.cell] = dist[cur] + 1
      prev[n.cell] = cur
      queue.push(n.cell)
    }
  }
  return { dist, prev }
}

/** The way from `a` to `b` through open sides, both ends included (the only way: the maze is perfect). */
function route(cols: number, rows: number, walls: readonly number[], a: number, b: number): number[] {
  const { prev } = bfs(cols, rows, walls, a)
  const out = [b]
  while (out[0] !== a && prev[out[0]] >= 0) out.unshift(prev[out[0]])
  return out
}

/** The whole walk start → keys in order → goal (start included). */
function walk(cols: number, rows: number, walls: readonly number[], start: number, stops: readonly number[]): number[] {
  const out = [start]
  let at = start
  for (const stop of stops) {
    out.push(...route(cols, rows, walls, at, stop).slice(1))
    at = stop
  }
  return out
}

/**
 * A walk's forks (cells where it could go two or more new ways — the start counts from one) and
 * turns (changes of direction, a U-turn out of a key's dead end included).
 */
export function measureWalk(cols: number, rows: number, walls: readonly number[], cells: readonly number[]): { forks: number; turns: number } {
  let forks = 0
  let turns = 0
  for (let i = 0; i < cells.length - 1; i++) {
    const options = degree(walls, cells[i], cols, rows) - (i > 0 ? 1 : 0)
    if (options >= 2) forks++
    if (i > 0 && cells[i + 1] - cells[i] !== cells[i] - cells[i - 1]) turns++
  }
  return { forks, turns }
}

function quadrant(cols: number, rows: number, cell: number): string {
  return `${(cell % cols) * 2 < cols - 1 ? 'L' : 'R'}${Math.floor(cell / cols) * 2 < rows - 1 ? 'T' : 'B'}`
}

interface Built {
  walls: number[]
  start: number
  goal: number
  keys: number[]
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]))
}

/**
 * Keys at the ends of dead-end branches off the start–goal way, each in its own branch and at least
 * `depth` steps off the way, so each key is a real detour and no key is passed on the way to another.
 * Numbered by where the way meets their branch ('route'), or ('mixed') in the shortest order that is
 * not that one — the numbers, not the nearest key, decide, without pointless back-and-forth.
 */
function placeKeys(cols: number, rows: number, walls: readonly number[], way: readonly number[], b: MazeBand, rng: Rng): number[] | null {
  if (b.keys === 0) return []
  const onWay = new Map(way.map((c, i) => [c, i]))
  // Multi-source BFS from the way: each off-way cell's depth, the way cell its branch hangs from, and the branch's first cell.
  const depth = walls.map(() => -1)
  const root = walls.map(() => -1)
  const branch = walls.map(() => -1)
  const queue = [...way]
  for (const c of way) depth[c] = 0
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]
    for (const n of neighbours(cols, rows, cur)) {
      if (walls[cur] & n.side.bit || depth[n.cell] >= 0) continue
      depth[n.cell] = depth[cur] + 1
      root[n.cell] = depth[cur] === 0 ? cur : root[cur]
      branch[n.cell] = depth[cur] === 0 ? n.cell : branch[cur]
      queue.push(n.cell)
    }
  }
  const ends = rng.shuffle(walls.map((_, i) => i).filter((i) => depth[i] >= b.keyDepth && degree(walls, i, cols, rows) === 1))
  const picked: number[] = []
  const used = new Set<number>()
  for (const c of ends) {
    if (used.has(branch[c])) continue
    picked.push(c)
    used.add(branch[c])
    if (picked.length === b.keys) break
  }
  if (picked.length < b.keys) return null
  const byWay = [...picked].sort((x, y) => (onWay.get(root[x]) ?? 0) - (onWay.get(root[y]) ?? 0) || depth[x] - depth[y])
  if (b.keyOrder === 'route' || b.keys === 1) return byWay
  const start = way[0]
  const goal = way[way.length - 1]
  const others = rng.shuffle(permutations(byWay).filter((order) => order.some((c, j) => c !== byWay[j])))
  const length = (order: number[]) => walk(cols, rows, walls, start, [...order, goal]).length
  return others.reduce((best, order) => (length(order) < length(best) ? order : best))
}

/** Pick a start, a goal and the keys on a carved maze for the band; null when this maze cannot give them. */
function fit(cols: number, rows: number, walls: number[], b: MazeBand, rng: Rng, avoid: string | undefined): Built | null {
  const n = cols * rows
  const ends = walls.map((_, i) => i).filter((i) => degree(walls, i, cols, rows) === 1)
  const border = (i: number) => i % cols === 0 || i % cols === cols - 1 || i < cols || i >= n - cols
  let start: number
  if (b.way === 'far') {
    // The maze's longest way (a double sweep finds a diameter of the tree), either way round.
    const a = bfs(cols, rows, walls, rng.pick(ends)).dist
    const g = a.indexOf(Math.max(...a))
    const d = bfs(cols, rows, walls, g).dist
    const s = d.indexOf(Math.max(...d))
    let goal: number
    ;[start, goal] = rng.chance(0.5) ? [s, g] : [g, s]
    if (avoid && quadrant(cols, rows, start) === avoid) [start, goal] = [goal, start]
    const way = route(cols, rows, walls, start, goal)
    const keys = placeKeys(cols, rows, walls, way, b, rng)
    return keys ? { walls, start, goal, keys } : null
  }
  // A dead end on the border, out of the quadrant the last trial started in.
  const pool = ends.filter((i) => quadrant(cols, rows, i) !== avoid)
  if (pool.length === 0) return null
  const starts = pool.filter(border)
  start = rng.pick(starts.length ? starts : pool)
  const { dist } = bfs(cols, rows, walls, start)
  const lo = Math.max(2, Math.ceil(b.way[0] * n))
  const hi = Math.max(lo, Math.floor(b.way[1] * n))
  // Any goal in range whose whole walk (keys included) has the band's turns.
  for (const g of rng.shuffle(ends.filter((i) => i !== start && dist[i] >= lo && dist[i] <= hi))) {
    const way = route(cols, rows, walls, start, g)
    const keys = placeKeys(cols, rows, walls, way, b, rng)
    if (!keys) continue
    if (b.turns) {
      const { turns } = measureWalk(cols, rows, walls, walk(cols, rows, walls, start, [...keys, g]))
      if (turns < b.turns[0] || turns > b.turns[1]) continue
    }
    return { walls, start, goal: g, keys }
  }
  return null
}

/** Carve until the band's maze comes out (a few tries at most); the last resort relaxes the way and the keys, never the maze. */
function build(cols: number, rows: number, b: MazeBand, rng: Rng, avoid: string | undefined): Built {
  for (let i = 0; i < 40; i++) {
    const got = fit(cols, rows, carve(cols, rows, b.branch, rng), b, rng, avoid)
    if (got) return got
  }
  const loose: MazeBand = { ...b, way: 'far', keyDepth: 1, turns: undefined }
  for (let i = 0; i < 40; i++) {
    const got = fit(cols, rows, carve(cols, rows, b.branch, rng), loose, rng, undefined)
    if (got) return got
  }
  // Tiny screens only: any distinct cells for the keys.
  const walls = carve(cols, rows, b.branch, rng)
  const far = fit(cols, rows, walls, { ...loose, keys: 0 }, rng, undefined) as Built
  const free = rng.shuffle(walls.map((_, i) => i).filter((i) => i !== far.start && i !== far.goal))
  return { ...far, keys: free.slice(0, Math.min(b.keys, free.length)) }
}

function borderWalls(cols: number, rows: number): number[] {
  return Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    return (r === 0 ? MAZE_WALL.top : 0) | (c === cols - 1 ? MAZE_WALL.right : 0) | (r === rows - 1 ? MAZE_WALL.bottom : 0) | (c === 0 ? MAZE_WALL.left : 0)
  })
}

// ── the game ────────────────────────────────────────────────────────────────

export interface MazeState {
  cols: number
  rows: number
  walls: number[]
  start: number
  goal: number
  keys: number[]
  /** Keys collected, in order (sticky). */
  collected: number
  path: number[]
  hidden: boolean
  previewMs: number
  phase: 'preview' | 'play'
  /** The wall last bumped (hidden mazes), until the next move. Bumping it again before moving is free (a jittery finger). */
  bump: { cell: number; side: number } | null
  /** Bumps into hidden walls so far. */
  mistakes: number
  /** Bumps forgiven; one more ends the trial (0 in a visible maze). */
  maxMistakes: number
  reached: boolean
  timedOut: boolean
  limitMs: number
  /** The whole way through (start → keys → goal), its forks and turns, as built. */
  steps: number
  forks: number
  turns: number
  kind: MazeKind
  tags: string[]
  band: number
}

const failed = (s: MazeState) => s.hidden && s.mistakes > s.maxMistakes
const done = (s: MazeState) => s.reached || s.timedOut || failed(s)

/** Take the next key if the path's end is on it; reaching the goal with every key ends the trial. */
function settle(s: MazeState): MazeState {
  const end = s.path[s.path.length - 1]
  const collected = s.collected < s.keys.length && s.keys[s.collected] === end ? s.collected + 1 : s.collected
  return { ...s, collected, reached: end === s.goal && collected === s.keys.length }
}

/** The way still to go: from the path's end through the keys not yet taken to the goal (the end excluded). */
function remaining(s: MazeState): number[] {
  return walk(s.cols, s.rows, s.walls, s.path[s.path.length - 1], [...s.keys.slice(s.collected), s.goal]).slice(1)
}

export const mazeRun: BrainGameDef<MazeState> = {
  id: 'mazeRun',
  create(level, rng, ctx) {
    const b = mazeBand(level, ctx.blockRules ?? [])
    const { cols, rows } = mazeSize(b, ctx)
    const n = cols * rows
    // Variety: the last trial's start corner is not this one's.
    const avoid = ctx.recent?.length ? ctx.recent[ctx.recent.length - 1].carry : undefined
    const built = build(cols, rows, b, rng, avoid)
    const whole = walk(cols, rows, built.walls, built.start, [...built.keys, built.goal])
    const { forks, turns } = measureWalk(cols, rows, built.walls, whole)
    const steps = whole.length - 1
    // A band played in place of a higher one (a rule not yet met) plays at its tightest clock.
    const lv = Number.isFinite(level) ? Math.min(MAZE_MAX_LEVEL, Math.max(1, level)) : 1
    const clockLevel = b.band < Math.floor(lv) ? b.band + 0.99 : lv
    const tags: string[] = []
    // Board notices from the band's own size, so every screen meets them at the same level.
    if (b.cols * b.rows >= 36) tags.push('mazeRun.grid6')
    if (b.cols * b.rows >= 64) tags.push('mazeRun.grid8')
    if (b.kind === 'winding') tags.push('mazeRun.winding')
    if (built.keys.length > 0) tags.push('mazeRun.keys')
    if (built.keys.length === 2) tags.push('mazeRun.twoKeys')
    if (built.keys.length === 3) tags.push('mazeRun.threeKeys')
    if (b.hidden) tags.push('mazeRun.hidden')
    if (b.hidden && built.keys.length > 0) tags.push('mazeRun.hiddenKeys')
    return {
      cols,
      rows,
      walls: built.walls,
      start: built.start,
      goal: built.goal,
      keys: built.keys,
      collected: 0,
      path: [built.start],
      hidden: b.hidden,
      previewMs: b.previewMs,
      phase: b.hidden ? 'preview' : 'play',
      bump: null,
      mistakes: 0,
      maxMistakes: b.hidden ? b.bumps : 0,
      reached: false,
      timedOut: false,
      limitMs: mazeLimitMs(clockLevel, b, { steps, forks, cells: n, keys: built.keys.length }),
      steps,
      forks,
      turns,
      kind: b.kind,
      tags,
      band: b.band,
    }
  },
  pendingMs: (s) => (s.phase === 'preview' && !done(s) ? s.previewMs : null),
  advance: (s) => (s.phase === 'preview' ? { ...s, phase: 'play' } : s),
  acceptsInput: (s) => s.phase === 'play' && !done(s),
  tap(s, cell) {
    if (s.phase !== 'play' || done(s) || !Number.isInteger(cell) || cell < 0 || cell >= s.walls.length) return s
    const end = s.path[s.path.length - 1]
    if (cell === end) return s
    const at = s.path.indexOf(cell)
    // Back onto the path: cut it back there (backtracking erases).
    if (at >= 0) return settle({ ...s, path: s.path.slice(0, at + 1), bump: null })
    const side = sideBetween(s.cols, end, cell)
    if (!side) return s
    if (s.walls[end] & side.bit) {
      // A wall: nothing in a visible maze; in a hidden one a bump — flashed, and one of the maze's
      // forgiven bumps spent (the same wall again before moving is free).
      if (!s.hidden || (s.bump && s.bump.cell === end && s.bump.side === side.bit)) return s
      return { ...s, bump: { cell: end, side: side.bit }, mistakes: s.mistakes + 1 }
    }
    return settle({ ...s, path: [...s.path, cell], bump: null })
  },
  timeout: (s) => (done(s) ? s : { ...s, timedOut: true }),
  outcome(s) {
    if (!done(s)) return null
    // Bumps are the maze's own budget, not the round's chances: a miss costs one chance as any miss
    // does (and none for a timeout in a relaxed timing mode).
    const bumps = s.hidden ? { mistakes: s.mistakes } : {}
    if (s.reached) return { correct: true, accuracy: 1, ...bumps }
    // How far along: the share of the whole way through that is behind the player (at most 0.8).
    const left = remaining(s).length
    return { correct: false, accuracy: Math.max(0, Math.min(0.8, 1 - left / Math.max(1, s.steps))), ...bumps }
  },
  timeLimitMs: (s) => s.limitMs,
  view(s): MazeView {
    const over = done(s)
    const showWalls = !s.hidden || s.phase === 'preview' || over
    const view: MazeView = {
      kind: 'maze',
      prompt:
        s.phase === 'preview'
          ? { key: 'play.mazeRunMemorize' }
          : s.keys.length > 0
            ? { key: 'play.mazeRunKeys', params: { count: s.keys.length } } // plural: _one/_other
            : { key: 'play.mazeRunGo' },
      cols: s.cols,
      rows: s.rows,
      walls: showWalls ? [...s.walls] : borderWalls(s.cols, s.rows),
      start: s.start,
      goal: s.goal,
      keys: s.keys.map((cell, i) => ({ cell, order: i + 1, taken: i < s.collected })),
      goalOpen: s.collected === s.keys.length,
      path: [...s.path],
      phase: over ? 'done' : s.phase,
      hidden: s.hidden,
      locked: over || s.phase !== 'play',
    }
    if (s.phase === 'preview') view.showBar = { ms: s.previewMs }
    if (s.bump) view.bump = { ...s.bump }
    if (s.hidden) view.budget = { left: Math.max(0, s.maxMistakes - s.mistakes), total: s.maxMistakes }
    if (over && !s.reached) view.answer = { path: walk(s.cols, s.rows, s.walls, s.start, [...s.keys, s.goal]), walls: [...s.walls] }
    return view
  },
  signature: (s) => `mz:${s.cols}x${s.rows}:${s.start}>${s.goal}:${s.keys.join(',')}:${s.walls.map((w) => w.toString(16)).join('')}`,
  solution(s) {
    if (s.phase !== 'play' || done(s)) return null
    return remaining(s)
  },
  mechanics: (s) => s.tags,
  maxLevel: () => MAZE_MAX_LEVEL,
  trialInfo: (s) => ({ kind: `b${s.band}`, carry: quadrant(s.cols, s.rows, s.start) }),
}
