/**
 * Maze Run (미로 찾기) against the owner's bar for the new games («새로운 게임은 처음부터 내 피드백
 * 수준으로 만들어라»): level 1 easy, a capable adult challenged within a few trials; every level a
 * different maze, harder = more cells and less time; a new kind starts small again with a card; the
 * top beats a sharp adult; real thinking every trial, no repeats; colour-blind safe; big cells and
 * generous clocks low down. Mazes are sampled band by band on four screens, and two modelled players
 * (not measured people) run placement and the staircase.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONTEXT,
  MAZE_WALL,
  TIERS,
  buildDemo,
  createRng,
  maxColsFor,
  mechanicInfo,
  nextSd,
  placementDone,
  placementHandover,
  placementLevel,
  restartLevel,
  startPlacement,
  stepLevel,
  stepMultiplier,
  updatePlacement,
  zestPlan,
  type CreateContext,
  type MazeView,
} from '@reeeeecall/shared/lib/brain-games'
import {
  MAZE_COLORS,
  MAZE_HIDDEN_MIN_CELL,
  MAZE_LADDER,
  MAZE_MAX_LEVEL,
  MAZE_MIN_CELL,
  mazeBand,
  mazeFit,
  mazeLimitMs,
  mazePar,
  mazeRun,
  measureWalk,
  type MazeState,
} from '@reeeeecall/shared/lib/brain-games/games/maze-run'

const DESKTOP = DEFAULT_CONTEXT
/** A phone (5 columns × 7 rows of 56dp game cells). */
const PHONE: CreateContext = { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 }
const SMALL: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 6 }
const TINY: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 3, maxRows: 4 }
const SCREENS = [DESKTOP, PHONE, SMALL, TINY]
const BANDS = Array.from({ length: MAZE_MAX_LEVEL }, (_, i) => i + 1)
const BOTH_RULES = ['mazeRun.keys', 'mazeRun.hidden']

const make = (level: number, seed: number, ctx: CreateContext = PHONE): MazeState => mazeRun.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx)
const play = (s: MazeState) => (s.phase === 'preview' ? mazeRun.advance(s) : s)
const label = (s: MazeState) => `${s.cols}x${s.rows}`

// ── maze helpers, from the walls alone ───────────────────────────────────────

const STEP = [
  { bit: MAZE_WALL.top, opposite: MAZE_WALL.bottom, dc: 0, dr: -1 },
  { bit: MAZE_WALL.right, opposite: MAZE_WALL.left, dc: 1, dr: 0 },
  { bit: MAZE_WALL.bottom, opposite: MAZE_WALL.top, dc: 0, dr: 1 },
  { bit: MAZE_WALL.left, opposite: MAZE_WALL.right, dc: -1, dr: 0 },
]
function around(s: Pick<MazeState, 'cols' | 'rows' | 'walls'>, cell: number): { cell: number; open: boolean; bit: number }[] {
  const c = cell % s.cols
  const r = Math.floor(cell / s.cols)
  return STEP.flatMap((k) => {
    const nc = c + k.dc
    const nr = r + k.dr
    if (nc < 0 || nc >= s.cols || nr < 0 || nr >= s.rows) return []
    return [{ cell: nr * s.cols + nc, open: !(s.walls[cell] & k.bit), bit: k.bit }]
  })
}
const degree = (s: Pick<MazeState, 'cols' | 'rows' | 'walls'>, cell: number) => around(s, cell).filter((x) => x.open).length
function distances(s: Pick<MazeState, 'cols' | 'rows' | 'walls'>, from: number): number[] {
  const dist = s.walls.map(() => -1)
  dist[from] = 0
  const q = [from]
  for (let i = 0; i < q.length; i++) for (const x of around(s, q[i])) if (x.open && dist[x.cell] < 0) { dist[x.cell] = dist[q[i]] + 1; q.push(x.cell) }
  return dist
}
function wayBetween(s: Pick<MazeState, 'cols' | 'rows' | 'walls'>, a: number, b: number): number[] {
  const prev = new Map<number, number>([[a, -1]])
  const q = [a]
  for (let i = 0; i < q.length; i++) for (const x of around(s, q[i])) if (x.open && !prev.has(x.cell)) { prev.set(x.cell, q[i]); q.push(x.cell) }
  const out = [b]
  while (out[0] !== a) out.unshift(prev.get(out[0])!)
  return out
}
/** Walls agree on both sides, the border is closed, and exactly one way joins any two cells. */
function expectPerfect(s: MazeState, at: string) {
  let open = 0
  for (let i = 0; i < s.walls.length; i++) {
    const c = i % s.cols
    const r = Math.floor(i / s.cols)
    for (const k of STEP) {
      const nc = c + k.dc
      const nr = r + k.dr
      if (nc < 0 || nc >= s.cols || nr < 0 || nr >= s.rows) {
        expect(s.walls[i] & k.bit, `${at}: border open at ${i}`).toBeTruthy()
        continue
      }
      const j = nr * s.cols + nc
      expect(Boolean(s.walls[i] & k.bit), `${at}: wall ${i}/${j} disagrees`).toBe(Boolean(s.walls[j] & k.opposite))
      if (!(s.walls[i] & k.bit) && j > i) open++
    }
  }
  expect(open, `${at}: a loop or an island`).toBe(s.walls.length - 1)
  expect(distances(s, 0).every((d) => d >= 0), `${at}: not connected`).toBe(true)
}
const deadEndShare = (s: MazeState) => s.walls.filter((_, i) => degree(s, i) === 1).length / s.walls.length
const diameter = (s: MazeState) => Math.max(...s.walls.map((_, i) => Math.max(...distances(s, i))))
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('the ladder: start small, grow, a new kind starts small again with a card', () => {
  it('L1-5 open 4×4 → 8×8 · L6-10 winding 6×6 → 10×10 · L11-15 keys from 4×4 · L16-20 hidden walls from 4×4 · L21-24 hidden walls and keys from 4×4', () => {
    expect(MAZE_MAX_LEVEL).toBe(24)
    expect(MAZE_LADDER.map((r) => `${r.kind} ${r.cols}x${r.rows}${r.keys ? ` k${r.keys}` : ''}${r.hidden ? ` ${r.previewMs / 1000}s b${r.bumps}` : ''}`)).toEqual([
      'open 4x4', 'open 5x5', 'open 6x6', 'open 7x7', 'open 8x8',
      'winding 6x6', 'winding 7x7', 'winding 8x8', 'winding 9x9', 'winding 10x10',
      'keys 4x4 k1', 'keys 5x5 k1', 'keys 6x6 k2', 'keys 7x7 k2', 'keys 8x8 k3',
      'memory 4x4 8s b3', 'memory 5x5 8s b3', 'memory 5x5 6s b2', 'memory 5x6 6s b2', 'memory 5x7 5s b2',
      'memoryKeys 4x4 k1 7s b3', 'memoryKeys 5x5 k1 6s b2', 'memoryKeys 5x6 k2 6s b2', 'memoryKeys 5x7 k2 5s b2',
    ])
    // Keys out of the order the way meets them: the last keys band and the top.
    expect(MAZE_LADDER.map((r, i) => (r.keyOrder === 'mixed' ? i + 1 : 0)).filter(Boolean)).toEqual([15, 24])
  })

  it('each new kind arrives with its card (rules) or notice (boards), on a smaller maze than the band before', () => {
    const kinds: [tag: string, kind: 'rule' | 'board', from: number][] = [
      ['mazeRun.winding', 'board', 6],
      ['mazeRun.keys', 'rule', 11],
      ['mazeRun.hidden', 'rule', 16],
      ['mazeRun.hiddenKeys', 'board', 21],
    ]
    for (const [tag, kind, from] of kinds) {
      expect(mechanicInfo(tag), tag).toMatchObject({ game: 'mazeRun', kind, from })
      const before = MAZE_LADDER[from - 2]
      const at = MAZE_LADDER[from - 1]
      expect(at.kind, tag).not.toBe(before.kind)
      expect(at.cols * at.rows, `${tag}: starts small again`).toBeLessThan(before.cols * before.rows)
      // The first trial of the new kind carries the tag (so the card or notice comes then).
      expect(mazeRun.mechanics(make(from, 1)), tag).toContain(tag)
      expect(mazeRun.mechanics(make(from - 1, 1)), tag).not.toContain(tag)
    }
    // More keys are notices where the count grows.
    expect([mechanicInfo('mazeRun.twoKeys')?.from, mechanicInfo('mazeRun.threeKeys')?.from]).toEqual([13, 15])
    expect(MAZE_LADDER[12].keys).toBe(2)
    expect(MAZE_LADDER[14].keys).toBe(3)
  })

  it('every level step changes the maze itself — more cells or keys, a new kind, or (hidden) a shorter preview, fewer bumps, more turns — and the clock never loosens inside a kind', () => {
    for (let b = 2; b <= MAZE_MAX_LEVEL; b++) {
      const prev = MAZE_LADDER[b - 2]
      const cur = MAZE_LADDER[b - 1]
      const at = `L${b - 1} → L${b}`
      const newKind = cur.kind !== prev.kind
      const more = cur.cols * cur.rows + cur.keys * 10 > prev.cols * prev.rows + prev.keys * 10
      const harderMemory = cur.hidden && (cur.previewMs < prev.previewMs || cur.bumps < prev.bumps || (cur.turns?.[0] ?? 0) > (prev.turns?.[0] ?? 0))
      expect(newKind || more || harderMemory, at).toBe(true)
      if (!newKind) {
        expect(cur.pace, `${at}: the pace`).toBeLessThan(prev.pace)
        expect(cur.previewMs, `${at}: the preview`).toBeLessThanOrEqual(prev.previewMs)
        expect(cur.bumps, `${at}: the bumps`).toBeLessThanOrEqual(prev.bumps)
      }
    }
  })

  it('tiers sit where the maze changes kind or size: 6×6 · winding · keys · hidden · hidden with keys · two keys hidden', () => {
    expect(TIERS.mazeRun).toEqual([3, 6, 11, 16, 21, 23])
    for (const t of TIERS.mazeRun) expect(t).toBeLessThan(MAZE_MAX_LEVEL)
  })
})

describe('the mazes, band by band on four screens', () => {
  it('perfect mazes; start and goal dead ends; keys distinct; solution() walks open sides, takes the keys in order and ends on the goal by the only (shortest) way; playing it wins', () => {
    for (const ctx of SCREENS) {
      for (const b of BANDS) {
        for (let seed = 1; seed <= 6; seed++) {
          const s = make(b, seed, ctx)
          const at = `L${b} ${ctx.maxCols}x${ctx.maxRows} seed ${seed} (${label(s)})`
          expectPerfect(s, at)
          expect(s.start, at).not.toBe(s.goal)
          expect([degree(s, s.start), degree(s, s.goal)], `${at}: start and goal are dead ends`).toEqual([1, 1])
          expect(new Set([...s.keys, s.start, s.goal]).size, at).toBe(s.keys.length + 2)
          expect(s.keys.length, at).toBe(mazeBand(b).keys)
          const t0 = play(s)
          const sol = mazeRun.solution(t0)!
          const cells = [s.start, ...sol]
          for (let i = 1; i < cells.length; i++) expect(around(s, cells[i - 1]).some((x) => x.cell === cells[i] && x.open), `${at}: step ${i} through a wall`).toBe(true)
          expect(sol[sol.length - 1], at).toBe(s.goal)
          const stops = [...s.keys, s.goal]
          let shortest = 0
          let from = s.start
          for (const stop of stops) { shortest += distances(s, from)[stop]; from = stop }
          expect(sol.length, `${at}: not the shortest`).toBe(shortest)
          expect(s.steps, at).toBe(shortest)
          const firstAt = s.keys.map((k) => cells.indexOf(k))
          expect(firstAt.every((x, i) => x > 0 && (i === 0 || x > firstAt[i - 1])), `${at}: keys out of order`).toBe(true)
          let t = t0
          for (const cell of sol) t = mazeRun.tap(t, cell)
          expect(mazeRun.outcome(t), at).toEqual(s.hidden ? { correct: true, accuracy: 1, mistakes: 0 } : { correct: true, accuracy: 1 })
        }
      }
    }
  })

  it('cells never under 44dp, a hidden maze’s never under 56dp: a desktop holds every band whole; a phone caps the big open mazes (8×8 → 7×8) and holds every hidden maze whole', () => {
    const cell = (ctx: CreateContext, s: MazeState) => Math.min((ctx.maxCols * 64 - 8) / s.cols, (ctx.maxRows * 64 - 8) / s.rows)
    for (const ctx of SCREENS) {
      for (const b of BANDS) {
        const s = make(b, 1, ctx)
        const at = `L${b} ${ctx.maxCols}x${ctx.maxRows} ${label(s)}`
        expect(cell(ctx, s), at).toBeGreaterThanOrEqual(s.hidden ? MAZE_HIDDEN_MIN_CELL : MAZE_MIN_CELL)
        const fit = mazeFit(ctx, s.hidden ? MAZE_HIDDEN_MIN_CELL : MAZE_MIN_CELL)
        expect(s.cols <= fit.cols && s.rows <= fit.rows, at).toBe(true)
      }
    }
    const whole = (ctx: CreateContext, b: number) => {
      const s = make(b, 1, ctx)
      const r = MAZE_LADDER[b - 1]
      return [Math.min(s.cols, s.rows), Math.max(s.cols, s.rows)].join('x') === [Math.min(r.cols, r.rows), Math.max(r.cols, r.rows)].join('x')
    }
    for (const b of BANDS) expect(whole(DESKTOP, b), `desktop L${b}`).toBe(true)
    for (const b of BANDS.filter((x) => MAZE_LADDER[x - 1].hidden)) expect(whole(PHONE, b), `phone L${b}`).toBe(true)
    expect([5, 8, 10, 15].map((b) => label(make(b, 1, PHONE)))).toEqual(['7x8', '7x8', '7x10', '7x8'])
    // L1-4 are whole on the phone too.
    for (const b of [1, 2, 3, 4]) expect(whole(PHONE, b), `phone L${b}`).toBe(true)
  })

  it('open mazes have few dead ends and a moderate way; winding mazes of the same size more dead ends, more forks and the longest way the maze has', () => {
    for (const [open, winding] of [[3, 6], [4, 7], [5, 8]]) {
      const os = Array.from({ length: 40 }, (_, i) => make(open, i + 1, DESKTOP))
      const ws = Array.from({ length: 40 }, (_, i) => make(winding, i + 1, DESKTOP))
      expect(label(os[0]), `L${open} / L${winding}`).toBe(label(ws[0]))
      const n = os[0].walls.length
      expect(mean(ws.map(deadEndShare)), `dead ends L${winding} vs L${open}`).toBeGreaterThan(mean(os.map(deadEndShare)) + 0.05)
      expect(mean(ws.map((s) => s.steps)), `way L${winding} vs L${open}`).toBeGreaterThan(mean(os.map((s) => s.steps)))
      expect(mean(ws.map((s) => s.forks)), `forks L${winding} vs L${open}`).toBeGreaterThan(mean(os.map((s) => s.forks)) + 1)
      for (const s of os) expect(s.steps / n, `L${open}`).toBeGreaterThanOrEqual(0.28 - 1e-9)
      for (const s of os) expect(s.steps / n, `L${open}`).toBeLessThanOrEqual(0.5 + 1e-9)
      for (const s of ws.slice(0, 10)) expect(s.steps, `L${winding}: the longest way`).toBe(diameter(s))
    }
  })

  it('keys: each at the end of its own dead-end branch off the start–goal way, at least the band’s depth away; numbered as the way meets them, but out of that order at L15 and L24', () => {
    for (const b of BANDS.filter((x) => MAZE_LADDER[x - 1].keys > 0)) {
      const row = MAZE_LADDER[b - 1]
      for (let seed = 1; seed <= 15; seed++) {
        const s = make(b, seed, DESKTOP)
        const at = `L${b} seed ${seed}`
        const way = wayBetween(s, s.start, s.goal)
        const onWay = new Set(way)
        const branches = s.keys.map((k) => {
          expect(onWay.has(k), `${at}: a key on the way`).toBe(false)
          expect(degree(s, k), `${at}: a key not at a dead end`).toBe(1)
          // The way cell its branch hangs from, and how deep it is.
          const toWay = way.map((w) => wayBetween(s, k, w)).reduce((a, x) => (x.length < a.length ? x : a))
          expect(toWay.length - 1, `${at}: a key too near the way`).toBeGreaterThanOrEqual(row.keyDepth)
          return { root: way.indexOf(toWay[toWay.length - 1]), first: toWay[toWay.length - 2] }
        })
        expect(new Set(branches.map((x) => x.first)).size, `${at}: two keys in one branch`).toBe(s.keys.length)
        const meets = branches.map((x) => x.root)
        const inOrder = meets.every((x, i) => i === 0 || x >= meets[i - 1])
        if (row.keyOrder === 'route') expect(inOrder, `${at}: numbered against the way`).toBe(true)
        else if (new Set(meets).size === meets.length) expect(inOrder, `${at}: mixed, yet in the way's order`).toBe(false)
      }
    }
  })

  it('hidden mazes: the whole walk’s turns stay inside each band’s range and grow band by band; the walls show in the preview, then only the border', () => {
    let last = 0
    for (const b of BANDS.filter((x) => MAZE_LADDER[x - 1].hidden)) {
      const row = MAZE_LADDER[b - 1]
      const turns = Array.from({ length: 20 }, (_, i) => make(b, i + 1, PHONE)).map((s) => {
        const at = `L${b}`
        expect(s.turns, at).toBeGreaterThanOrEqual(row.turns![0])
        expect(s.turns, at).toBeLessThanOrEqual(row.turns![1])
        expect(s.turns, at).toBe(measureWalk(s.cols, s.rows, s.walls, [s.start, ...mazeRun.solution(play(s))!]).turns)
        const v = mazeRun.view(s) as MazeView
        expect([v.phase, v.locked, v.showBar?.ms, v.walls], at).toEqual(['preview', true, row.previewMs, s.walls])
        const p = mazeRun.view(play(s)) as MazeView
        expect(p.walls.every((w, i) => (w & s.walls[i]) === w && (w & ~s.walls[i]) === 0), at).toBe(true)
        expect(p.walls.filter((w, i) => w !== s.walls[i]).length, `${at}: nothing hidden`).toBeGreaterThan(0)
        expect(p.budget, at).toEqual({ left: row.bumps, total: row.bumps })
        return s.turns
      })
      if (b === 21) last = 0 // keys again: a new kind, from 4×4
      expect(mean(turns), `L${b} turns`).toBeGreaterThan(last)
      last = mean(turns)
    }
  })

  it('the clock: L1 gives at least 4× a brisk adult’s time; the pace tightens band by band; a longer way gets a longer clock; inside a band each step up is tighter', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = make(1, seed)
      const par = mazePar({ steps: s.steps, forks: s.forks, cells: s.walls.length, keys: 0 }, false)
      expect(s.limitMs / par, `L1 seed ${seed}`).toBeGreaterThanOrEqual(4)
      expect(s.limitMs, `L1 seed ${seed}`).toBeGreaterThanOrEqual(15_000)
    }
    const m = { steps: 20, forks: 5, cells: 49, keys: 0 }
    for (const b of BANDS) {
      const row = MAZE_LADDER[b - 1]
      // L24 is the staircase's cap: it has no steps inside it.
      if (b < MAZE_MAX_LEVEL) expect(mazeLimitMs(b + 0.9, row, m), `L${b}`).toBeLessThan(mazeLimitMs(b, row, m))
      expect(mazeLimitMs(b, row, { ...m, steps: 30 }), `L${b}`).toBeGreaterThan(mazeLimitMs(b, row, m))
    }
    // Generous low, tight high: the band's clock over its own maze's par.
    const ratio = (b: number) => mean(Array.from({ length: 10 }, (_, i) => make(b, i + 1, DESKTOP)).map((s) => s.limitMs / mazePar({ steps: s.steps, forks: s.forks, cells: s.walls.length, keys: s.keys.length }, s.hidden)))
    expect(ratio(1)).toBeGreaterThan(4.5)
    expect(ratio(10)).toBeLessThan(1.5)
    expect(ratio(24)).toBeLessThan(2)
  })
})

describe('play', () => {
  /** A hidden maze, after its preview, whose start has a wall to bump. */
  function hiddenWithWall(level: number): MazeState {
    for (let seed = 1; seed < 200; seed++) {
      const s = play(make(level, seed))
      if (around(s, s.start).some((x) => !x.open)) return s
    }
    throw new Error('no hidden maze with a wall at the start')
  }

  it('a hidden maze: a bump flashes the wall and spends one forgiven bump (dots); the same wall again before moving is free; one past the budget is a miss that spends no extra chance', () => {
    const s0 = hiddenWithWall(16)
    expect(s0.maxMistakes).toBe(3)
    const wall = around(s0, s0.start).find((x) => !x.open)!
    let s = mazeRun.tap(s0, wall.cell)
    let v = mazeRun.view(s) as MazeView
    expect(v.bump).toEqual({ cell: s0.start, side: wall.bit })
    expect(v.budget).toEqual({ left: 2, total: 3 })
    expect(v.path).toEqual([s0.start])
    // A jittery finger on the same wall: nothing more.
    expect(mazeRun.tap(s, wall.cell)).toBe(s)
    // Step away and back, then bump again: it counts.
    const exit = around(s0, s0.start).find((x) => x.open)!
    s = mazeRun.tap(mazeRun.tap(s, exit.cell), s0.start)
    expect(s.bump).toBeNull()
    for (let i = 0; i < 3; i++) {
      s = mazeRun.tap(s, wall.cell)
      if (i < 2) s = mazeRun.tap(mazeRun.tap(s, exit.cell), s0.start)
    }
    const out = mazeRun.outcome(s)!
    expect(out).toEqual({ correct: false, accuracy: 0, mistakes: 4 })
    expect('livesSpent' in out).toBe(false)
    v = mazeRun.view(s) as MazeView
    expect([v.phase, v.locked, v.budget]).toEqual(['done', true, { left: 0, total: 3 }])
    expect(v.walls).toEqual(s.walls)
    expect(v.answer!.path[0]).toBe(s.start)
    expect(v.answer!.path[v.answer!.path.length - 1]).toBe(s.goal)
    expect(mazeRun.tap(s, exit.cell)).toBe(s)
  })

  it('a visible maze ignores walls and jumps; a timeout is a miss with credit for the way behind (at most 0.8)', () => {
    const s0 = make(5, 3)
    const walled = around(s0, s0.start).find((x) => !x.open)
    if (walled) expect(mazeRun.tap(s0, walled.cell)).toBe(s0)
    expect(mazeRun.tap(s0, s0.goal)).toBe(s0)
    const sol = mazeRun.solution(s0)!
    let s = s0
    for (const cell of sol.slice(0, Math.floor(sol.length / 2))) s = mazeRun.tap(s, cell)
    const out = mazeRun.outcome(mazeRun.timeout(s))!
    expect(out.correct).toBe(false)
    expect(out.accuracy).toBeGreaterThan(0.3)
    expect(out.accuracy).toBeLessThanOrEqual(0.8)
    expect(mazeRun.outcome(mazeRun.timeout(s0))).toEqual({ correct: false, accuracy: 0 })
  })

  it('a rule not yet met (placement, or waiting for its card) plays the highest band below it without that rule, at that band’s tightest clock', () => {
    expect(mazeBand(13, ['mazeRun.keys']).band).toBe(10)
    expect(mazeBand(18, ['mazeRun.hidden']).band).toBe(15)
    expect(mazeBand(22, ['mazeRun.hidden']).band).toBe(15)
    expect(mazeBand(22, BOTH_RULES).band).toBe(10)
    expect(mazeBand(9.4, BOTH_RULES).band).toBe(9)
    const s = mazeRun.create(13.2, createRng(5), { ...PHONE, blockRules: BOTH_RULES })
    expect([s.band, s.keys, s.hidden, mazeRun.mechanics(s).includes('mazeRun.keys')]).toEqual([10, [], false, false])
    expect(s.limitMs).toBe(mazeLimitMs(10.99, MAZE_LADDER[9], { steps: s.steps, forks: s.forks, cells: s.walls.length, keys: 0 }))
  })

  it('variety: twenty trials of a band are twenty different mazes, and a trial never starts in the corner the last one started in', () => {
    for (const b of BANDS) {
      const sigs = new Set(Array.from({ length: 20 }, (_, i) => mazeRun.signature(make(b, i + 1))))
      expect(sigs.size, `L${b}`).toBe(20)
    }
    for (const b of [1, 3, 11, 16, 21]) {
      for (let seed = 1; seed <= 15; seed++) {
        const first = make(b, seed)
        const info = mazeRun.trialInfo!(first)
        const next = mazeRun.create(b, createRng(seed + 1000), { ...PHONE, recent: [{ level: b, kind: info.kind, carry: info.carry }] })
        expect(mazeRun.trialInfo!(next).carry, `L${b} seed ${seed}`).not.toBe(info.carry)
      }
    }
  })

  it('the how-to-play demo: a 4×4 maze, a fork on the way, one drag step a frame, ending on the goal', () => {
    const frames = buildDemo('mazeRun')
    const first = frames[0].view as MazeView
    const last = frames[frames.length - 1].view as MazeView
    expect([first.kind, first.cols, first.rows]).toEqual(['maze', 4, 4])
    expect(last.phase).toBe('done')
    expect(last.path[last.path.length - 1]).toBe(last.goal)
    expect(frames.filter((f) => f.tap !== undefined).length).toBe(last.path.length - 1)
    const s = mazeRun.create(1, createRng(6), { ...DEFAULT_CONTEXT, maxCols: 4 })
    expect(s.forks).toBeGreaterThanOrEqual(1)
  })
})

// ── colour: CVD simulation (linear sRGB) → CIELAB → CIEDE2000, as brain-new-games.test.ts ──
type Vec3 = [number, number, number]
type Mat = readonly (readonly [number, number, number])[]
const SIMULATIONS: Record<string, Mat> = {
  none: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  // Machado, Oliveira & Fernandes 2009, severity 1.0.
  protanMachado: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutanMachado: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanMachado: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  // Viénot, Brettel & Mollon 1999 (dichromats).
  protanVienot: [[0.11238, 0.88762, 0], [0.11238, 0.88762, 0], [0.00401, -0.00401, 1]],
  deutanVienot: [[0.29275, 0.70725, 0], [0.29275, 0.70725, 0], [-0.02234, 0.02234, 1]],
}
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearRgb = (hex: string) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as Vec3
const simulate = (m: Mat, c: Vec3) => m.map((r) => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))) as Vec3
function lab([r, g, b]: Vec3): Vec3 {
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const fx = f(x / 0.95047), fy = f(y), fz = f(z / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
/** CIEDE2000 (Sharma, Wu & Dalal 2005). */
function deltaE2000([l1, a1, b1]: Vec3, [l2, a2, b2]: Vec3): number {
  const rad = Math.PI / 180
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)))
  const a1p = (1 + g) * a1, a2p = (1 + g) * a2
  const c1p = Math.hypot(a1p, b1), c2p = Math.hypot(a2p, b2)
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360)
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p)
  let dh = 0
  if (c1p * c2p !== 0) dh = h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p < -180 ? h2p - h1p + 360 : h2p - h1p
  const dL = l2 - l1, dC = c2p - c1p
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh / 2) * rad)
  const lBar = (l1 + l2) / 2, cBarP = (c1p + c2p) / 2
  let hBar = h1p + h2p
  if (c1p * c2p !== 0) hBar = Math.abs(h1p - h2p) > 180 ? (h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2) : (h1p + h2p) / 2
  const t = 1 - 0.17 * Math.cos((hBar - 30) * rad) + 0.24 * Math.cos(2 * hBar * rad) + 0.32 * Math.cos((3 * hBar + 6) * rad) - 0.2 * Math.cos((4 * hBar - 63) * rad)
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7))
  const rt = -Math.sin(2 * 30 * Math.exp(-(((hBar - 275) / 25) ** 2)) * rad) * rc
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2)
  const sc = 1 + 0.045 * cBarP, sh = 1 + 0.015 * cBarP * t
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh))
}
const luminance = (hex: string) => {
  const [r, g, b] = linearRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('colour: the owner is red-green colour-blind', () => {
  it('Okabe–Ito path blue and key vermillion, everything else black on white: each ≥ 3:1, blue and vermillion ≥ 38 ΔE2000 apart in every simulation; no green anywhere', () => {
    expect(MAZE_COLORS).toEqual({ face: '#FFFFFF', wall: '#000000', path: '#0072B2', start: '#0072B2', key: '#D55E00', goal: '#000000', bump: '#000000' })
    for (const [name, hex] of Object.entries(MAZE_COLORS)) if (name !== 'face') expect(contrast(hex, MAZE_COLORS.face), name).toBeGreaterThanOrEqual(3)
    const dist = (a: string, b: string, m: Mat) => deltaE2000(lab(simulate(m, linearRgb(a))), lab(simulate(m, linearRgb(b))))
    for (const [sim, m] of Object.entries(SIMULATIONS)) {
      expect(dist(MAZE_COLORS.path, MAZE_COLORS.key, m), `path–key ${sim}`).toBeGreaterThanOrEqual(38)
      expect(dist(MAZE_COLORS.path, MAZE_COLORS.wall, m), `path–wall ${sim}`).toBeGreaterThanOrEqual(20)
      expect(dist(MAZE_COLORS.key, MAZE_COLORS.wall, m), `key–wall ${sim}`).toBeGreaterThanOrEqual(20)
    }
    // Why the bump is not reddish purple: protans see it as the path's blue.
    expect(dist(MAZE_COLORS.path, '#CC79A7', SIMULATIONS.protanMachado)).toBeLessThan(20)
    // No green: the green channel never leads.
    for (const hex of Object.values(MAZE_COLORS)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      expect(g > r && g > b, hex).toBe(false)
    }
  })
})

/**
 * Two modelled players — a check of the ladder and clock, not measured people (recalibrate from
 * logged times, EVIDENCE §4.5). A maze takes base + step·steps (×blind in a hidden maze) + fork·forks
 * + cell·cells + key·keys ms, spread lognormally (σ); it is cleared in time with the chance that
 * stays under the clock. A hidden maze must also be walked from memory: the walk's segments
 * (turns + 1) are held up to min(cap, rate·preview s); each segment beyond that is a wrong move with
 * chance 0.65 (plus a slip on any), every wrong move a bump (Poisson), and the maze is lost past its
 * bump budget. The sharp adult is about 2.4× the slow 75-year-old per step, 2.8× per fork.
 */
const PERSONAS = {
  sharp: { base: 1500, step: 230, fork: 500, cell: 25, key: 1500, blind: 1.3, sigma: 0.25, rate: 1.4, cap: 9, slip: 0.03 },
  slow75: { base: 3000, step: 550, fork: 1400, cell: 70, key: 3500, blind: 1.4, sigma: 0.3, rate: 0.5, cap: 5, slip: 0.05 },
} as const
type Persona = keyof typeof PERSONAS
const phi = (z: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const q = 0.3989423 * Math.exp((-z * z) / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - q : q
}
const poissonAtMost = (lambda: number, k: number) => {
  let term = Math.exp(-lambda)
  let sum = term
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term }
  return sum
}
function pClear(persona: Persona, s: MazeState): number {
  const p = PERSONAS[persona]
  const t = p.base + p.step * s.steps * (s.hidden ? p.blind : 1) + p.fork * s.forks + p.cell * s.walls.length + p.key * s.keys.length
  const inTime = phi(Math.log(s.limitMs / t) / p.sigma)
  if (!s.hidden) return inTime
  const segments = s.turns + 1
  const held = Math.min(p.cap, (p.rate * s.previewMs) / 1000)
  return inTime * poissonAtMost(0.65 * Math.max(0, segments - held) + p.slip * segments, s.maxMistakes)
}
const pCache = new Map<string, number>()
/** A persona's chance at a level (to a quarter level), over 30 mazes; `blocked`: both rules not yet met (placement). */
function pLevel(persona: Persona, level: number, ctx: CreateContext = PHONE, blocked = false): number {
  const lv = Math.max(1, Math.min(MAZE_MAX_LEVEL, Math.round(level * 4) / 4))
  const key = `${persona}:${lv}:${ctx.maxCols}x${ctx.maxRows}:${blocked}`
  if (!pCache.has(key)) {
    const c = blocked ? { ...ctx, blockRules: BOTH_RULES } : ctx
    pCache.set(key, mean(Array.from({ length: 30 }, (_, i) => pClear(persona, mazeRun.create(lv, createRng(i * 104729 + Math.round(lv * 100)), c)))))
  }
  return pCache.get(key)!
}

/** A first play as useBrainRound runs it: ZEST placement (rules not yet met are blocked), from L3. */
function placement(persona: Persona, seed: number): { levels: number[]; handover: number; sd: number } {
  const plan = zestPlan('mazeRun')
  const rng = createRng(seed)
  let p = startPlacement({ lo: 1, hi: plan.hi, mu0: 3, sigma0: 9, target: 0.85, slope: 2, maxMove: 3, minTrials: plan.minTrials, maxTrials: plan.maxTrials, tailMass: plan.tailMass, hotMove: plan.hotMove, hotAfter: plan.hotAfter })
  const levels: number[] = []
  while (!placementDone(p)) {
    const x = levels.length === 0 ? 3 : placementLevel(p)
    levels.push(x)
    p = updatePlacement(p, x, rng.next() < pLevel(persona, x, PHONE, true), 0.02)
  }
  const h = placementHandover(p, plan.handoverK)
  return { levels, handover: h.level, sd: Math.max(1, Math.min(9, h.sd)) }
}

/** Counted rounds on the 85% staircase (3 chances, 20 trials), the second starting where the first left off. */
function rounds(persona: Persona, start: number, sd0: number, seed: number, n = 2): { right: number; trials: number; end: number } {
  const rng = createRng(seed)
  let level = start
  let sd = sd0
  let right = 0
  let trials = 0
  for (let r = 0; r < n; r++) {
    let lives = 3
    let lastDir = 0
    let upRun = 0
    let best = level
    for (let t = 0; t < 20 && lives > 0; t++) {
      const ok = rng.next() < pLevel(persona, level)
      const k = stepMultiplier('speed', sd)
      const dir = ok ? 1 : -1
      upRun = ok ? upRun + 1 : 0
      sd = nextSd('speed', sd, lastDir !== 0 && dir !== lastDir, upRun)
      lastDir = dir
      level = Math.min(MAZE_MAX_LEVEL, stepLevel('speed', level, ok, ok ? 1 : 0.4, k))
      best = Math.max(best, level)
      trials++
      if (ok) right++
      else lives--
    }
    level = restartLevel('speed', level, best)
  }
  return { right, trials, end: level }
}

describe('two modelled players', () => {
  it('level 1 is easy and the top is hard: a slow 75-year-old clears L1-3 ≥ 95% on every screen; a sharp adult is untroubled to L8 and beaten at L24 at least four times in five', () => {
    for (const ctx of [DESKTOP, PHONE, SMALL]) {
      for (const b of [1, 2, 3]) expect(pLevel('slow75', b, ctx), `slow75 L${b} ${ctx.maxCols} cols`).toBeGreaterThanOrEqual(0.95)
      for (const b of [1, 2, 3, 4, 5, 6, 7, 8]) expect(pLevel('sharp', b, ctx), `sharp L${b} ${ctx.maxCols} cols`).toBeGreaterThanOrEqual(0.97)
      expect(pLevel('sharp', 24, ctx), `sharp L24 ${ctx.maxCols} cols`).toBeLessThanOrEqual(0.25)
    }
    // Where each meets the clock: the slow 75-year-old in the bigger open mazes, the sharp adult at L10.
    expect(pLevel('slow75', 5)).toBeLessThan(0.85)
    expect(pLevel('sharp', 10.75)).toBeLessThan(0.85)
    expect(pLevel('sharp', 10.75, PHONE, true)).toBeLessThan(0.85)
  })

  it('inside each kind every band is at least as hard as the one before, for both players', () => {
    for (const persona of ['sharp', 'slow75'] as const) {
      for (let b = 2; b <= MAZE_MAX_LEVEL; b++) {
        if (MAZE_LADDER[b - 1].kind !== MAZE_LADDER[b - 2].kind) continue
        expect(pLevel(persona, b), `${persona} L${b - 1} → L${b}`).toBeLessThanOrEqual(pLevel(persona, b - 1) + 0.02)
      }
    }
  })

  it('first play, after practice: a sharp adult meets a maze they may lose (≤ 90%) within four placement trials in at least four runs of five; a slow 75-year-old starts at L3 and is handed over at their own level', () => {
    const sharp = Array.from({ length: 100 }, (_, i) => placement('sharp', i * 31 + 7))
    const challenged = sharp.filter((r) => r.levels.slice(0, 4).some((x) => pLevel('sharp', x, PHONE, true) <= 0.9)).length
    expect(challenged).toBeGreaterThanOrEqual(80)
    const slow = Array.from({ length: 100 }, (_, i) => placement('slow75', i * 17 + 3))
    for (const r of slow) expect(r.levels[0]).toBe(3)
    const handover = mean(slow.map((r) => r.handover))
    expect(handover).toBeLessThan(5)
    expect(pLevel('slow75', handover)).toBeGreaterThanOrEqual(0.8)
  })

  it('two rounds after placement: the slow 75-year-old stays about 80% right; the sharp adult climbs into the hidden mazes and is still right most of the time', () => {
    const slow = Array.from({ length: 60 }, (_, i) => {
      const p = placement('slow75', i * 13 + 1)
      return rounds('slow75', p.handover, p.sd, i * 7 + 2)
    })
    const slowRight = slow.reduce((a, r) => a + r.right, 0) / slow.reduce((a, r) => a + r.trials, 0)
    expect(slowRight).toBeGreaterThanOrEqual(0.75)
    expect(mean(slow.map((r) => r.end))).toBeLessThan(7)
    const sharp = Array.from({ length: 60 }, (_, i) => {
      const p = placement('sharp', i * 11 + 5)
      return rounds('sharp', p.handover, p.sd, i * 5 + 3, 4)
    })
    const sharpRight = sharp.reduce((a, r) => a + r.right, 0) / sharp.reduce((a, r) => a + r.trials, 0)
    expect(sharpRight).toBeGreaterThanOrEqual(0.75)
    expect(mean(sharp.map((r) => r.end))).toBeGreaterThan(15)
  })
})
