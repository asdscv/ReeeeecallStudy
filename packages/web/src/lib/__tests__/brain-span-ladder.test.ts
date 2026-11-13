/**
 * The span games' ladders (GAMES_DIFFICULTY_PLAN §3.6, §3.7), read off the trials themselves.
 *
 * Flash Grid: the level is cells − 2 on every screen that holds them, on an explicit board ladder
 * (3×3 · 4×4 · 5×5 · 6×5/5×6 · 7×5/5×7, or a 50% board where none fits), with no easy chunks in the
 * pattern (no lit 2×2 from L4, no 3 in a row from L8), exposure 1000 + 180ms a cell up to 3s, and
 * past the most cells a screen holds the same cells in two, then three waves. Every level step
 * changes something.
 *
 * Sequence: the level is length − 2, a tile never repeats, never three in a straight sweep, the
 * path crosses itself from 5 tiles, always reversed from L4, 4×4 from L5, one tile a second, and
 * the cap is every tile once.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONTEXT,
  MECHANICS,
  TIERS,
  createRng,
  earnedByRound,
  emptyMeta,
  emptyProgress,
  maxColsFor,
  type CreateContext,
  type GridView,
  type Rng,
} from '@reeeeecall/shared/lib/brain-games'
import {
  FLASH_GRID_GAP_MS,
  flashGridBoard,
  flashGridCapacity,
  flashGridExposureMs,
  memoryGrid,
  type MemoryGridState,
} from '@reeeeecall/shared/lib/brain-games/games/memory-grid'
import { sequence, type SequenceState } from '@reeeeecall/shared/lib/brain-games/games/sequence'

const DESKTOP: CreateContext = DEFAULT_CONTEXT
const PHONE: CreateContext = { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 }
const SMALL: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 6 }
const SQUARE5: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 5, maxRows: 5 }
const NARROW: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 3, maxRows: 5 }
const SCREENS = [DESKTOP, PHONE, SMALL, SQUARE5, NARROW]
const name = (ctx: CreateContext) => `${ctx.maxCols}x${ctx.maxRows}`
const SEEDS = 60

/** An Rng that always draws the first items in order — every rejection loop fails, so the fallbacks run. */
const STUCK: Rng = {
  next: () => 0,
  int: (a: number) => a,
  chance: () => false,
  pick: <T,>(x: readonly T[]) => x[0],
  shuffle: <T,>(x: readonly T[]) => x.slice(),
  sample: <T,>(x: readonly T[], n: number) => x.slice(0, n),
}

// ── Flash Grid ─────────────────────────────────────────────────────────────

const grid = (level: number, seed: number, ctx: CreateContext = DESKTOP) => memoryGrid.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx)
const gridView = (s: MemoryGridState) => memoryGrid.view(s) as GridView
const cap = (ctx: CreateContext) => memoryGrid.maxLevel!(ctx)

/** What a level shows: cells, board, waves and exposure — the things a level step must change. */
function shape(s: MemoryGridState) {
  return { cells: s.targets.length, board: `${s.cols}x${s.rows}`, waves: s.waves.length, showMs: s.showMs }
}

/** Lit cells on the board as (col, row). */
function lit(s: MemoryGridState): Set<string> {
  return new Set(s.targets.map((t) => `${t % s.cols},${Math.floor(t / s.cols)}`))
}

function hasSquare(s: MemoryGridState): boolean {
  const on = lit(s)
  for (let r = 0; r + 1 < s.rows; r++) for (let c = 0; c + 1 < s.cols; c++) if ([[0, 0], [1, 0], [0, 1], [1, 1]].every(([dc, dr]) => on.has(`${c + dc},${r + dr}`))) return true
  return false
}

/** The longest run of lit cells across or down. */
function longestRun(s: MemoryGridState): number {
  const on = lit(s)
  let best = 0
  for (const [dc, dr] of [[1, 0], [0, 1]]) {
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        let n = 0
        while (on.has(`${c + n * dc},${r + n * dr}`)) n++
        best = Math.max(best, n)
      }
    }
  }
  return best
}

/** Steps through the memorise phases, collecting what each one shows. */
function phases(s: MemoryGridState) {
  const out: { phase: string; ms: number | null; view: GridView; solution: number[] | null; state: MemoryGridState; tapped: MemoryGridState }[] = []
  for (let guard = 0; guard < 20 && memoryGrid.pendingMs(s) !== null; guard++) {
    out.push({ phase: s.phase, ms: memoryGrid.pendingMs(s), view: gridView(s), solution: memoryGrid.solution(s), state: s, tapped: memoryGrid.tap(s, s.targets[0]) })
    s = memoryGrid.advance(s)
  }
  return { steps: out, recall: s }
}

describe('Flash Grid: the board ladder', () => {
  it('desktop and phone: the plan table, level by level', () => {
    const table = (ctx: CreateContext) => Array.from({ length: cap(ctx) }, (_, i) => shape(grid(i + 1, 1, ctx)))
    const rows = (wide: [number, number], tall: [number, number]) => [
      { cells: 3, board: '3x3', waves: 1, showMs: 1540 },
      { cells: 4, board: '4x4', waves: 1, showMs: 1720 },
      { cells: 5, board: '4x4', waves: 1, showMs: 1900 },
      { cells: 6, board: '4x4', waves: 1, showMs: 2080 },
      { cells: 7, board: '5x5', waves: 1, showMs: 2260 },
      { cells: 8, board: '5x5', waves: 1, showMs: 2440 },
      { cells: 9, board: '5x5', waves: 1, showMs: 2620 },
      { cells: 10, board: wide.join('x'), waves: 1, showMs: 2800 },
      { cells: 11, board: wide.join('x'), waves: 1, showMs: 2980 },
      { cells: 12, board: wide.join('x'), waves: 1, showMs: 3000 },
      { cells: 13, board: tall.join('x'), waves: 1, showMs: 3000 },
      { cells: 14, board: tall.join('x'), waves: 1, showMs: 3000 },
      // L13: the same 14 cells in 2 waves of 1.25s; L14 (the cap): 3 waves of ~830ms.
      { cells: 14, board: tall.join('x'), waves: 2, showMs: 1250 },
      { cells: 14, board: tall.join('x'), waves: 3, showMs: 833 },
    ]
    // Landscape on a screen at least as wide as tall (desktop), portrait on a phone.
    expect(table(DESKTOP)).toEqual(rows([6, 5], [7, 5]))
    expect(table(PHONE)).toEqual(rows([5, 6], [5, 7]))
  })

  it('the cap is the most cells a screen holds plus two wave levels: 14 on boards with ≥ 28 cells', () => {
    expect(SCREENS.map(cap)).toEqual([14, 14, 12, 12, 3])
    expect(cap({ ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 7 })).toBe(14)
    expect(SCREENS.map(flashGridCapacity)).toEqual([14, 14, 12, 12, 3])
    // A 4×6 small phone: L10 = 12 cells, L11-12 are wave levels.
    expect([10, 11, 12].map((l) => shape(grid(l, 1, SMALL)))).toEqual([
      { cells: 12, board: '4x6', waves: 1, showMs: 3000 },
      { cells: 12, board: '4x6', waves: 2, showMs: 1250 },
      { cells: 12, board: '4x6', waves: 3, showMs: 833 },
    ])
    // Past the cap nothing changes.
    for (const ctx of SCREENS) expect(shape(grid(120, 1, ctx))).toEqual(shape(grid(cap(ctx), 1, ctx)))
  })

  it('every level step changes cells, board, waves or exposure; cells never decrease', () => {
    for (const ctx of SCREENS) {
      for (let level = 2; level <= cap(ctx); level++) {
        const a = shape(grid(level - 1, 3, ctx))
        const b = shape(grid(level, 3, ctx))
        expect(b, `${name(ctx)} L${level - 1}→L${level}`).not.toEqual(a)
        expect(b.cells, `${name(ctx)} L${level}`).toBeGreaterThanOrEqual(a.cells)
      }
    }
  })

  it('L1-12: cells = level + 2 on every screen that holds them; past them only waves', () => {
    for (const ctx of SCREENS) {
      const kmax = flashGridCapacity(ctx)
      for (let level = 1; level <= 12; level++) {
        for (let seed = 1; seed <= 8; seed++) {
          const s = grid(level, seed, ctx)
          if (level + 2 <= kmax) {
            expect(s.targets.length, `${name(ctx)} L${level}`).toBe(level + 2)
            expect(s.waves).toHaveLength(1)
          } else {
            expect(s.targets.length).toBe(kmax)
          }
        }
      }
      // A screen that holds `kmax` cells really fits a board for them (and not one more).
      expect(flashGridBoard(kmax, ctx), name(ctx)).not.toBeNull()
      if (kmax < 14) expect(flashGridBoard(kmax + 1, ctx), name(ctx)).toBeNull()
    }
  })

  it('shape bans and density: ≤ 40% lit (50% on fallback boards); no lit 2×2 from L4, no 3 in a row from L8 — 4 on fallback boards', () => {
    for (const ctx of SCREENS) {
      for (let level = 1; level <= cap(ctx); level++) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const s = grid(level, seed, ctx)
          const at = `${name(ctx)} L${level} seed ${seed} ${s.cols}x${s.rows}`
          expect(s.cols, at).toBeLessThanOrEqual(ctx.maxCols)
          expect(s.rows, at).toBeLessThanOrEqual(ctx.maxRows)
          expect(new Set(s.targets).size, at).toBe(s.targets.length)
          expect(s.targets.every((t) => t >= 0 && t < s.cols * s.rows), at).toBe(true)
          const density = s.targets.length / (s.cols * s.rows)
          if (s.fallback) {
            expect(density, at).toBeLessThanOrEqual(0.5)
            expect(hasSquare(s), `${at}: lit 2×2`).toBe(false)
            expect(longestRun(s), `${at}: 4 in a row`).toBeLessThan(4)
          } else {
            expect(density, at).toBeLessThanOrEqual(0.4)
            if (s.targets.length >= 6) expect(hasSquare(s), `${at}: lit 2×2`).toBe(false)
            if (s.targets.length >= 10) expect(longestRun(s), `${at}: 3 in a row`).toBeLessThan(3)
          }
        }
      }
    }
  })

  it('a 50% board only where no regular board fits; the regular ladder everywhere else', () => {
    for (const ctx of [DESKTOP, PHONE]) for (let level = 1; level <= 14; level++) expect(grid(level, 1, ctx).fallback, `${name(ctx)} L${level}`).toBe(false)
    // 4 columns: 5×5 never fits, so 7-12 cells go on 4×6. A 5×5-only screen: 10-12 cells at 50% on 5×5.
    expect([4, 5, 10].map((l) => [grid(l, 1, SMALL).fallback, `${grid(l, 1, SMALL).cols}x${grid(l, 1, SMALL).rows}`])).toEqual([[false, '4x4'], [true, '4x6'], [true, '4x6']])
    expect([7, 8, 10].map((l) => [grid(l, 1, SQUARE5).fallback, `${grid(l, 1, SQUARE5).cols}x${grid(l, 1, SQUARE5).rows}`])).toEqual([[false, '5x5'], [true, '5x5'], [true, '5x5']])
  })

  it('the bans hold even when sampling never succeeds (the checkerboard fallback)', () => {
    for (const ctx of SCREENS) {
      for (let level = 1; level <= cap(ctx); level++) {
        const s = memoryGrid.create(level, STUCK, ctx)
        const at = `${name(ctx)} L${level}`
        expect(s.targets.length, at).toBe(Math.min(level + 2, flashGridCapacity(ctx)))
        expect(new Set(s.targets).size).toBe(s.targets.length)
        if (s.targets.length >= 6) expect(hasSquare(s), at).toBe(false)
        if (s.targets.length >= 10) expect(longestRun(s), at).toBeLessThan(3)
      }
    }
  })

  it('patterns are not a fixed few', () => {
    for (const level of [4, 10, 14]) {
      const sigs = new Set(Array.from({ length: 200 }, (_, i) => memoryGrid.signature(grid(level, i + 1))))
      expect(sigs.size, `L${level}`).toBeGreaterThan(190)
    }
  })

  it('exposure is 1000 + 180ms a cell, never over 3s nor under 1.5s; waves ≥ 1s apart with a blank ≥ 300ms', () => {
    for (let k = 3; k <= 14; k++) expect(flashGridExposureMs(k)).toBe(Math.min(3000, 1000 + 180 * k))
    for (const ctx of SCREENS) {
      for (let level = 1; level <= cap(ctx); level++) {
        const s = grid(level, 2, ctx)
        const at = `${name(ctx)} L${level}`
        if (s.waves.length === 1) {
          expect(s.showMs, at).toBe(flashGridExposureMs(s.targets.length))
          expect(s.showMs, at).toBeGreaterThanOrEqual(1500)
        } else {
          expect(s.gapMs, at).toBeGreaterThanOrEqual(300)
          expect(s.showMs + s.gapMs, `${at}: wave onsets`).toBeGreaterThanOrEqual(1000)
          expect(s.gapMs).toBe(FLASH_GRID_GAP_MS)
        }
      }
    }
    // L13 on a 14-cell screen: onsets 1.75s apart; L14: 1.33s.
    expect(grid(13, 1).showMs + grid(13, 1).gapMs).toBe(1750)
    expect(grid(14, 1).showMs + grid(14, 1).gapMs).toBe(1333)
  })

  it('waves are disjoint, near-equal, and together exactly the targets', () => {
    for (const ctx of SCREENS) {
      for (const level of [cap(ctx) - 1, cap(ctx)]) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const s = grid(level, seed, ctx)
          const all = s.waves.flat()
          expect(new Set(all).size, name(ctx)).toBe(all.length)
          expect([...all].sort((a, b) => a - b)).toEqual(s.targets)
          const sizes = s.waves.map((w) => w.length)
          expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
          expect(Math.min(...sizes)).toBeGreaterThan(0)
        }
      }
    }
  })

  it('a wave trial: each wave lit on its own with its bar, a blank between, dots through both; recall only after the last', () => {
    const s = grid(14, 5)
    const { steps, recall } = phases(s)
    expect(steps.map((p) => [p.phase, p.ms])).toEqual([
      ['show', 833],
      ['gap', 500],
      ['show', 833],
      ['gap', 500],
      ['show', 833],
    ])
    steps.forEach((p, i) => {
      const w = Math.floor(i / 2)
      const litNow = p.view.cells.flatMap((c, j) => (c.tone === 'lit' ? [j] : []))
      expect(litNow).toEqual(p.phase === 'show' ? s.waves[w] : [])
      expect(p.view.progress).toEqual({ kind: 'waves', done: w + 1, total: 3 })
      expect(p.view.showBar).toEqual(p.phase === 'show' ? { ms: 833 } : undefined)
      expect(p.view.locked).toBe(true)
      expect(p.view.prompt.key).toBe('play.memorize')
      // Nothing is asked, and a tap does nothing, while memorising.
      expect(p.solution).toBeNull()
      expect(p.tapped).toBe(p.state)
    })
    const v = gridView(recall)
    expect(recall.phase).toBe('recall')
    expect(v.locked).toBe(false)
    expect(v.progress).toBeUndefined()
    expect(v.showBar).toBeUndefined()
    expect(v.chip).toEqual({ key: 'play.cells', params: { count: 14 } })
    expect(memoryGrid.solution(recall)).toEqual(s.targets)
  })

  it('one exposure: all lit at once with the bar, no wave dots; the header says how many cells', () => {
    const s = grid(5, 1, PHONE)
    const v = gridView(s)
    expect(v.cells.filter((c) => c.tone === 'lit')).toHaveLength(7)
    expect(v.showBar).toEqual({ ms: 2260 })
    expect(v.progress).toBeUndefined()
    expect(v.chip).toEqual({ key: 'play.cells', params: { count: 7 } })
    expect([v.cols, v.rows]).toEqual([5, 5])
    expect(memoryGrid.pendingMs(s)).toBe(2260)
    expect(memoryGrid.advance(s).phase).toBe('recall')
  })

  it('a portrait board reports its own columns and rows', () => {
    const v = gridView(grid(12, 1, PHONE))
    expect([v.cols, v.rows, v.cells.length]).toEqual([5, 7, 35])
    const w = gridView(grid(12, 1, DESKTOP))
    expect([w.cols, w.rows, w.cells.length]).toEqual([7, 5, 35])
  })

  it('the signature names the board and the waves', () => {
    const s = grid(13, 1)
    expect(memoryGrid.signature(s).startsWith('mg:7x5:2:')).toBe(true)
    const regrouped = { ...s, waves: [s.waves[1], s.waves[0]] }
    expect(memoryGrid.signature(regrouped)).not.toBe(memoryGrid.signature(s))
    expect(memoryGrid.signature({ ...s, waves: [s.targets] })).not.toBe(memoryGrid.signature(s))
  })

  it('board changes and waves are tagged from the level the plan says, on desktop and phone', () => {
    const first = (ctx: CreateContext, tag: string) => {
      for (let level = 1; level <= cap(ctx); level++) if (memoryGrid.mechanics(grid(level, 1, ctx)).includes(tag)) return level
      return null
    }
    const from = Object.fromEntries(MECHANICS.filter((m) => m.game === 'memoryGrid').map((m) => [m.tag, m.from]))
    expect(from).toEqual({
      'memoryGrid.grid4': 2,
      'memoryGrid.grid5': 5,
      'memoryGrid.grid6': 8,
      'memoryGrid.grid7': 11,
      'memoryGrid.fastShow': 14,
      'memoryGrid.waves': 13,
    })
    for (const ctx of [DESKTOP, PHONE]) for (const [tag, level] of Object.entries(from)) expect(first(ctx, tag), `${name(ctx)} ${tag}`).toBe(level)
    expect(MECHANICS.filter((m) => m.game === 'memoryGrid').every((m) => !m.retired)).toBe(true)
  })

  it('a span length is the cells a level shows on this screen; Master sits below the cap on the 5×7 phone', () => {
    expect(memoryGrid.spanLength!(5, DESKTOP)).toBe(7)
    expect(memoryGrid.spanLength!(13, DESKTOP)).toBe(14)
    expect(memoryGrid.spanLength!(11, SMALL)).toBe(12)
    expect(memoryGrid.spanLength!(3, NARROW)).toBe(3)
    expect(TIERS.memoryGrid[5]).toBeLessThan(cap(PHONE))
  })
})

// ── Sequence ───────────────────────────────────────────────────────────────

const seqTrial = (level: number, seed: number, ctx: CreateContext = DESKTOP) => sequence.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx)
const pos = (s: SequenceState, tile: number) => [tile % s.n, Math.floor(tile / s.n)] as const

/** b lies on the straight line from a to c, between them: a straight sweep. */
function sweepAt(s: SequenceState, i: number): boolean {
  const [a, b, c] = [pos(s, s.seq[i - 2]), pos(s, s.seq[i - 1]), pos(s, s.seq[i])]
  const collinear = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0
  const between = Math.min(a[0], c[0]) <= b[0] && b[0] <= Math.max(a[0], c[0]) && Math.min(a[1], c[1]) <= b[1] && b[1] <= Math.max(a[1], c[1])
  return collinear && between
}

/** Pairs of path segments that cross at a point inside both (touching at an end does not count). */
function crossingsOf(s: SequenceState): number {
  const side = (o: readonly number[], a: readonly number[], b: readonly number[]) => Math.sign((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]))
  let n = 0
  for (let i = 0; i + 1 < s.seq.length; i++) {
    for (let j = i + 2; j + 1 < s.seq.length; j++) {
      const [p, q, r, t] = [pos(s, s.seq[i]), pos(s, s.seq[i + 1]), pos(s, s.seq[j]), pos(s, s.seq[j + 1])]
      if (side(p, q, r) * side(p, q, t) < 0 && side(r, t, p) * side(r, t, q) < 0) n++
    }
  }
  return n
}

function checkRules(s: SequenceState, at: string) {
  expect(new Set(s.seq).size, `${at}: a tile repeats`).toBe(s.seq.length)
  expect(s.seq.every((t) => t >= 0 && t < s.n * s.n), at).toBe(true)
  for (let i = 2; i < s.seq.length; i++) expect(sweepAt(s, i), `${at}: straight sweep at ${i} (${s.seq})`).toBe(false)
  if (s.seq.length >= 5) expect(crossingsOf(s), `${at}: no crossing (${s.seq})`).toBeGreaterThan(0)
}

describe('Sequence: the ladder', () => {
  const seqCap = (ctx: CreateContext) => sequence.maxLevel!(ctx)

  it('length = level + 2, every tile different, no straight sweep, a crossing from 5 tiles — on every screen', () => {
    for (const ctx of SCREENS) {
      for (let level = 1; level <= seqCap(ctx); level++) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const s = seqTrial(level, seed, ctx)
          expect(s.seq.length).toBe(level + 2)
          checkRules(s, `${name(ctx)} L${level} seed ${seed}`)
        }
      }
    }
  })

  it('the rules hold even when sampling never succeeds (the search fallback)', () => {
    for (const ctx of [DESKTOP, NARROW]) {
      for (let level = 1; level <= seqCap(ctx); level++) {
        const s = sequence.create(level, STUCK, ctx)
        expect(s.seq.length).toBe(level + 2)
        checkRules(s, `${name(ctx)} L${level} stuck`)
      }
    }
  })

  it('always reversed from L4 (no coin), forward before', () => {
    for (const ctx of SCREENS) {
      for (let level = 1; level <= seqCap(ctx); level++) {
        for (let seed = 1; seed <= 30; seed++) expect(seqTrial(level, seed, ctx).reverse, `${name(ctx)} L${level}`).toBe(level >= 4)
      }
    }
    for (const level of [3.4, 3.5, 4.4]) expect(seqTrial(level, 1).reverse).toBe(Math.round(level) >= 4)
  })

  it('a round not introducing the reverse rule yet plays the same length forward', () => {
    const s = sequence.create(6, createRng(1), { ...DESKTOP, blockRules: ['sequence.reverse'] })
    expect([s.reverse, s.seq.length, s.n]).toEqual([false, 8, 4])
    expect(sequence.mechanics(s)).toEqual(['sequence.grid4'])
  })

  it('3×3 up to L4, 4×4 from L5 where the screen has 4 columns; 3-column screens stay 3×3', () => {
    for (let level = 1; level <= 14; level++) expect(seqTrial(level, 1, DESKTOP).n, `L${level}`).toBe(level >= 5 ? 4 : 3)
    for (const ctx of [PHONE, SMALL, SQUARE5]) expect(seqTrial(5, 1, ctx).n).toBe(4)
    for (let level = 1; level <= 7; level++) expect(seqTrial(level, 1, NARROW).n).toBe(3)
  })

  it('the cap is every tile once: n² − 2 (14 on 4×4, 7 on 3 columns)', () => {
    expect(SCREENS.map(seqCap)).toEqual([14, 14, 14, 14, 7])
    const full = seqTrial(120, 1)
    expect([full.n, full.seq.length]).toEqual([4, 16])
    expect(seqTrial(120, 1, NARROW).seq.length).toBe(9)
    // Master (L8) is in reach on a 4×4 board, out of reach on 3 columns (noted in the plan).
    expect(TIERS.sequence[5]).toBeLessThan(seqCap(PHONE))
  })

  it('one tile a second (flash + gap ≥ 1000ms) after a 1s lead-in; nothing asked while watching', () => {
    let s = seqTrial(6, 3)
    expect(sequence.pendingMs(s)).toBe(1000)
    const flashes: number[] = []
    for (let guard = 0; guard < 100 && s.phase === 'watch'; guard++) {
      expect(sequence.solution(s)).toBeNull()
      expect(sequence.tap(s, s.seq[0])).toBe(s)
      const v = sequence.view(s) as GridView
      const on = v.cells.findIndex((c) => c.tone === 'lit')
      if (on >= 0) flashes.push(on)
      s = sequence.advance(s)
    }
    expect(flashes).toEqual(s.seq)
    expect(s.flashMs + s.gapMs).toBeGreaterThanOrEqual(1000)
    expect(s.flashMs).toBe(700)
    expect(sequence.solution(s)).toEqual([...s.seq].reverse())
  })

  it('«⟲ 거꾸로» stays in the header through a reverse trial, and only then', () => {
    let s = seqTrial(4, 2)
    for (let guard = 0; guard < 40 && s.phase === 'watch'; guard++) {
      expect((sequence.view(s) as GridView).badge).toEqual({ key: 'play.reverseBadge' })
      s = sequence.advance(s)
    }
    expect((sequence.view(s) as GridView).badge).toEqual({ key: 'play.reverseBadge' })
    expect((sequence.view(seqTrial(3, 2)) as GridView).badge).toBeUndefined()
  })

  it('rules and board changes are tagged from the level the plan says', () => {
    const from = Object.fromEntries(MECHANICS.filter((m) => m.game === 'sequence').map((m) => [m.tag, [m.kind, m.from]]))
    expect(from).toEqual({ 'sequence.reverse': ['rule', 4], 'sequence.grid4': ['board', 5] })
    expect(sequence.mechanics(seqTrial(3, 1))).toEqual([])
    expect(sequence.mechanics(seqTrial(4, 1))).toEqual(['sequence.reverse'])
    expect(sequence.mechanics(seqTrial(5, 1))).toEqual(['sequence.grid4', 'sequence.reverse'])
  })

  it('spanLength(5) = 7, so passing L5 earns span7', () => {
    expect(sequence.spanLength!(5, DESKTOP)).toBe(7)
    expect(sequence.spanLength!(40, NARROW)).toBe(9)
    const facts = { gameId: 'sequence' as const, endedBy: 'lives' as const, cleared: false, trials: 6, correct: 4, livesLost: 2, bestStreak: 3, spanLength: sequence.spanLength!(5, DESKTOP), flawlessHunt: false }
    expect(earnedByRound(facts, emptyProgress(), emptyMeta())).toContain('span7')
    expect(earnedByRound({ ...facts, spanLength: sequence.spanLength!(4, DESKTOP) }, emptyProgress(), emptyMeta())).not.toContain('span7')
  })
})
