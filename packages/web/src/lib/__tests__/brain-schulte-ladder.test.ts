/**
 * Number Hunt's content ladder (GAMES_DIFFICULTY_PLAN §3.4). Read off the boards themselves: the
 * order the numbers must be tapped in (up, down, a two-digit run, in 2s or 3s, two series in turn,
 * the second counting down, a board that reshuffles), which board each level draws and how often,
 * the clock against the plan's table — and that it stays hard: from L10 most boards need tracking
 * or are reshuffled, counting boards never name the next number until a wrong tap, and unmarked
 * boards leave found numbers as they were.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONTEXT, TIERS, createRng, maxColsFor, type CreateContext, type GridView, type RecentTrial } from '@reeeeecall/shared/lib/brain-games'
import {
  SCHULTE_ACK_MS,
  SCHULTE_BANDS,
  SCHULTE_HINT_MS,
  SCHULTE_MAX_LEVEL,
  SCHULTE_TRACKING,
  schulte,
  schulteBand,
  schulteLimitMs,
  schulteModes,
  type SchulteMode,
  type SchulteState,
} from '@reeeeecall/shared/lib/brain-games/games/schulte'

const DESKTOP: CreateContext = DEFAULT_CONTEXT
const PHONE: CreateContext = { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 }
const SMALL: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 6 }
const NARROW: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 3, maxRows: 5 }
const ALL_RULES = ['schulte.descending', 'schulte.alternate', 'schulte.alternateOpposite', 'schulte.reshuffle']
const LEVELS = Array.from({ length: SCHULTE_MAX_LEVEL }, (_, i) => i + 1)

const view = (s: SchulteState) => schulte.view(s) as GridView
const make = (level: number, seed: number, ctx: CreateContext = DESKTOP) => schulte.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx)
/** The level's own board (placement draws only from its own band). */
const own = (level: number, seed: number, ctx: CreateContext = DESKTOP) => make(level, seed, { ...ctx, trialKind: 'placement' })
const sample = (level: number, n: number, ctx: CreateContext = DESKTOP) => Array.from({ length: n }, (_, i) => make(level, i + 1, ctx))

/** A round's boards at one level, each built with the last two as `ctx.recent` — as the round builds them. */
function chain(level: number, n: number, ctx: CreateContext = DESKTOP, seed = 1): SchulteState[] {
  const rng = createRng(seed)
  const out: SchulteState[] = []
  let recent: RecentTrial[] = []
  for (let i = 0; i < n; i++) {
    const s = schulte.create(level, rng, { ...ctx, recent })
    out.push(s)
    recent = [...recent, { level, kind: schulte.trialInfo!(s).kind }].slice(-2)
  }
  return out
}

const share = (boards: SchulteState[], p: (s: SchulteState) => boolean) => boards.filter(p).length / boards.length

/** Plays a board by its own solution, recording what each tap hit: [label, second series]. */
function playThrough(s0: SchulteState): { taps: [number, boolean][]; end: SchulteState } {
  let s = s0
  const taps: [number, boolean][] = []
  for (let guard = 0; guard < 200 && !schulte.outcome(s); guard++) {
    const at = schulte.solution(s)![0]
    const cell = view(s).cells[at]
    taps.push([Number(cell.label), cell.boxed === true])
    s = schulte.tap(s, at)
    while (schulte.pendingMs(s) !== null) s = schulte.advance(s)
  }
  return { taps, end: s }
}

const wrongCell = (s: SchulteState) => s.sequence[s.sequence.length - 1]

describe('Number Hunt: what each board asks', () => {
  it('every mode taps in its own order, and following solution() wins', () => {
    const expected = (s: SchulteState): [number, boolean][] => {
      const cells = s.n * s.n
      const r = Array.from({ length: cells }, (_, i) => i)
      const lo = Math.min(...s.values)
      switch (s.mode) {
        case 'desc':
          return r.map((i) => [cells - i, false])
        case 'two':
          return r.map((i) => [lo + i, false])
        case 'skip':
          return r.map((i) => [s.step * (i + 1), false])
        case 'alt':
          return r.map((i) => [Math.floor(i / 2) + 1, i % 2 === 1])
        case 'altOpp':
          return r.map((i) => (i % 2 === 0 ? [i / 2 + 1, false] : [Math.floor(cells / 2) - (i - 1) / 2, true]))
        default:
          return r.map((i) => [i + 1, false])
      }
    }
    const modes = new Set<SchulteMode>()
    for (const ctx of [DESKTOP, PHONE, SMALL, NARROW]) {
      for (const level of [...LEVELS, 2.5, 9.99, 13.4, 30, 120]) {
        for (let seed = 1; seed <= 12; seed++) {
          const s = make(level, seed, ctx)
          modes.add(s.mode)
          const { taps, end } = playThrough(s)
          expect(schulte.outcome(end), `L${level} ${s.mode}`).toMatchObject({ correct: true, livesSpent: 0 })
          expect(taps, `L${level} ${s.mode} ${ctx.maxCols}x${ctx.maxRows}`).toEqual(expected(s))
        }
      }
    }
    expect([...modes].sort()).toEqual(['alt', 'altOpp', 'asc', 'desc', 'shuffle', 'skip', 'two'])
  })

  it('a reshuffle board moves every number after each tap, one size smaller than the level board', () => {
    const s = own(14, 3)
    expect(s.mode).toBe('shuffle')
    expect(s.n).toBe(4)
    expect(own(14, 3, PHONE).n).toBe(4)
    expect(own(14, 3, SMALL).n).toBe(3)
    const after = schulte.tap(s, schulte.solution(s)![0])
    expect(after.values).not.toEqual(s.values)
    expect(after.values.slice().sort((a, b) => a - b)).toEqual(s.values.slice().sort((a, b) => a - b))
    // The found number stays found where it went.
    expect(view(after).cells[after.sequence[0]]).toMatchObject({ label: '1', tone: 'done' })
    // The deepest band's reshuffle board: 5×5 on a desktop, 4×4 on a phone.
    const deep = sample(22, 300).filter((b) => b.mode === 'shuffle')
    expect(deep.length).toBeGreaterThan(0)
    for (const b of deep) expect(b.n).toBe(5)
    for (const b of sample(22, 300, PHONE).filter((x) => x.mode === 'shuffle')) expect(b.n).toBe(4)
  })

  it('two-digit runs stay two-digit (start 10-70); counting goes in 2s (2-50) or 3s (3-75) on 5×5', () => {
    const starts = new Set<number>()
    const steps = new Set<number>()
    for (let seed = 1; seed <= 300; seed++) {
      const two = own(8, seed)
      expect(two.mode).toBe('two')
      const lo = Math.min(...two.values)
      starts.add(lo)
      expect(lo).toBeGreaterThanOrEqual(10)
      expect(lo).toBeLessThanOrEqual(70)
      expect(Math.max(...two.values)).toBeLessThanOrEqual(99)
      expect(view(two).prompt).toMatchObject({ key: 'play.tapRange', params: { from: lo, to: lo + 24, next: lo } })
      const skip = own(9, seed)
      expect(skip.mode).toBe('skip')
      steps.add(skip.step)
      expect(Math.max(...skip.values)).toBe(skip.step * 25)
      expect(view(skip).chip).toEqual({ text: `+${skip.step}` })
      expect(view(skip).prompt).toMatchObject({ key: 'play.tapSkip', params: { step: skip.step } })
    }
    expect(starts.size).toBeGreaterThan(30)
    expect([...steps].sort()).toEqual([2, 3])
    // 6×6 would pass 100 counting in 3s: it counts in 2s.
    for (const b of sample(22, 400).filter((x) => x.mode === 'skip')) expect(b.step === 2 || b.n < 6).toBe(true)
  })

  it('alternation: white and amber-in-a-box halves (13 and 12 on 5×5), the chip in the next series', () => {
    for (const [level, mode, n] of [[10, 'alt', 4], [11, 'alt', 5], [12, 'altOpp', 4], [13, 'altOpp', 5]] as const) {
      let s = own(level, 7)
      expect([s.mode, s.n]).toEqual([mode, n])
      const v = view(s)
      const amber = v.cells.filter((c) => c.boxed)
      expect(amber.length).toBe(Math.floor((n * n) / 2))
      for (const c of amber) expect(c.ink).toBe('amber')
      for (const c of v.cells.filter((x) => !x.boxed)) expect(c.ink).toBeUndefined()
      expect(v.prompt.key).toBe(mode === 'alt' ? 'play.tapAlternate' : 'play.tapAlternateOpposite')
      while (!schulte.outcome(s)) {
        const at = schulte.solution(s)![0]
        const cv = view(s)
        expect(cv.chip?.ink).toBe(cv.cells[at].boxed ? 'amber' : 'neutral')
        if (mode === 'altOpp') expect(cv.chip?.text).toBe(cv.cells[at].boxed ? '↓' : '↑')
        s = schulte.tap(s, at)
      }
    }
  })

  it('from L9, counting and alternation boards name the next number only for 1.5s after a wrong tap', () => {
    for (const level of [9, 10, 11, 12, 13]) {
      for (let seed = 1; seed <= 10; seed++) {
        let s = own(level, seed)
        expect(['skip', 'alt', 'altOpp']).toContain(s.mode)
        s = schulte.tap(s, schulte.solution(s)![0])
        expect(view(s).prompt.params?.next, `L${level}`).toBeUndefined()
        expect(schulte.pendingMs(s)).toBeNull()
        const target = schulte.solution(s)![0]
        s = schulte.tap(s, wrongCell(s))
        expect(s.mistakes).toBe(1)
        const v = view(s)
        expect(v.prompt.params?.next).toBe(s.values[target])
        expect(v.chip).toMatchObject({ key: 'play.nextHint', params: { next: s.values[target] } })
        expect(schulte.pendingMs(s)).toBe(SCHULTE_HINT_MS)
        expect(schulte.acceptsInput(s)).toBe(true)
        // It goes when its time is up — or as soon as the number is found.
        expect(view(schulte.advance(s)).prompt.params?.next).toBeUndefined()
        const found = schulte.tap(s, target)
        expect(view(found).prompt.params?.next).toBeUndefined()
        expect(schulte.pendingMs(found)).toBeNull()
      }
    }
    // Boards that always show the next number never need the hint.
    for (const level of [1, 3, 5, 8, 14]) {
      let s = own(level, 2)
      expect(view(s).prompt.params?.next).toBeDefined()
      s = schulte.tap(s, wrongCell(s))
      expect(schulte.pendingMs(s)).toBeNull()
    }
  })

  it('unmarked boards leave found numbers as they were (a tap that registers lights for a moment)', () => {
    const boards = sample(16, 200).filter((s) => s.unmarked)
    expect(boards.length).toBeGreaterThan(40)
    for (const s0 of boards.slice(0, 20)) {
      let s = s0
      while (!schulte.outcome(s)) {
        const at = schulte.solution(s)![0]
        s = schulte.tap(s, at)
        if (schulte.outcome(s)) break
        expect(view(s).cells[at].tone).toBe('correct')
        expect(schulte.pendingMs(s)).toBe(SCHULTE_ACK_MS)
        s = schulte.advance(s)
        expect(view(s).cells.every((c) => c.tone === 'idle'), s.mode).toBe(true)
      }
    }
    // Tapping an earlier number again is a wrong tap there; the one just found (a double tap) is not.
    let s = boards[0]
    s = schulte.advance(schulte.tap(s, schulte.solution(s)![0]))
    s = schulte.advance(schulte.tap(s, schulte.solution(s)![0]))
    expect(schulte.tap(s, s.sequence[1]).mistakes).toBe(0)
    expect(schulte.tap(s, s.sequence[0]).mistakes).toBe(1)
    // On a marked board a found number is faded and a tap on it is ignored.
    let m = own(3, 1)
    m = schulte.tap(schulte.tap(m, m.sequence[0]), m.sequence[1])
    expect(schulte.tap(m, m.sequence[0])).toBe(m)
    expect(view(m).cells[m.sequence[0]].tone).toBe('done')
  })

  it('reports its tags, one per thing new on the board', () => {
    const tags = (s: SchulteState) => schulte.mechanics(s)
    expect(tags(own(1, 1))).toEqual([])
    expect(tags(own(3, 1))).toEqual(['schulte.grid4'])
    expect(tags(own(5, 1))).toEqual(['schulte.grid4', 'schulte.descending'])
    expect(tags(own(8, 1))).toEqual(['schulte.grid4', 'schulte.grid5', 'schulte.twoDigit'])
    expect(tags(own(9, 1))).toContain('schulte.skipCount')
    expect(tags(own(10, 1))).toEqual(['schulte.grid4', 'schulte.alternate'])
    expect(tags(own(13, 1))).toEqual(['schulte.grid4', 'schulte.grid5', 'schulte.alternateOpposite'])
    expect(tags(own(14, 1))).toEqual(['schulte.grid4', 'schulte.reshuffle'])
    expect(tags(own(16, 1))).toContain('schulte.unmarked')
    expect(sample(18, 100).some((s) => tags(s).includes('schulte.grid6'))).toBe(true)
    for (let seed = 1; seed <= 50; seed++) expect(schulte.trialInfo!(make(12, seed))).toEqual({ kind: make(12, seed).mode })
  })
})

describe('Number Hunt: which board, how often', () => {
  it('the level table: 3×3 1→9, 4×4 from L3, counting down at L5, 5×5 from L6, then a new task most levels', () => {
    const table: [number, SchulteMode[], number][] = [
      [1, ['asc'], 3],
      [2, ['asc'], 3],
      [3, ['asc'], 4],
      [4, ['asc'], 4],
      [5, ['desc'], 4],
      [6, ['asc', 'desc'], 5],
      [8, ['two'], 5],
      [9, ['skip'], 5],
      [10, ['alt'], 4],
      [11, ['alt'], 5],
      [12, ['altOpp'], 4],
      [13, ['altOpp'], 5],
      [14, ['shuffle'], 4],
      [15, ['shuffle'], 4],
    ]
    for (const [level, modes, n] of table) {
      for (let seed = 1; seed <= 30; seed++) {
        const s = own(level, seed)
        expect(modes, `L${level}`).toContain(s.mode)
        expect(s.n, `L${level}`).toBe(n)
        expect(s.unmarked).toBe(false)
      }
    }
    for (let seed = 1; seed <= 30; seed++) expect(own(16, seed).unmarked).toBe(true)
    // L5: half the boards count down; L6-7: 40% of the level's own 5×5 boards.
    expect(share(sample(5, 3000), (s) => s.mode === 'desc')).toBeCloseTo(0.5, 1)
    expect(share(Array.from({ length: 3000 }, (_, i) => own(6, i + 1)), (s) => s.mode === 'desc')).toBeCloseTo(0.4, 1)
    // Up to L4 there is nothing below to mix in.
    for (const level of [1, 2, 3, 4]) expect(schulteModes(level, DESKTOP).map((m) => m.mode)).toEqual(['asc'])
  })

  it('from L5 half the boards are the level own, half the three levels below', () => {
    const boards = sample(11, 4000)
    expect(share(boards, (s) => s.mode === 'alt' && s.n === 5)).toBeCloseTo(0.5, 1)
    expect(share(boards, (s) => s.mode === 'alt' && s.n === 4)).toBeGreaterThan(0.13)
    expect(share(boards, (s) => s.mode === 'skip')).toBeGreaterThan(0.13)
    expect(share(boards, (s) => s.mode === 'two')).toBeGreaterThan(0.13)
    expect(share(boards, (s) => !['alt', 'skip', 'two'].includes(s.mode))).toBe(0)
  })

  it('from L8 the same task never comes twice in a row', () => {
    for (const ctx of [DESKTOP, PHONE]) {
      for (let level = 8; level <= SCHULTE_MAX_LEVEL; level++) {
        const boards = chain(level, 400, ctx, level)
        for (let i = 1; i < boards.length; i++) expect(boards[i].mode, `L${level} #${i}`).not.toBe(boards[i - 1].mode)
      }
    }
  })

  it('hard enough: from L10 at least half the boards need tracking (skip, two series) or are reshuffled', () => {
    for (const ctx of [DESKTOP, PHONE]) {
      for (let level = 10; level <= SCHULTE_MAX_LEVEL; level++) {
        const tracked = share(chain(level, 3000, ctx, level * 31), (s) => SCHULTE_TRACKING.has(s.mode))
        expect(tracked, `L${level} ${ctx.maxCols}x${ctx.maxRows}`).toBeGreaterThanOrEqual(0.5)
      }
    }
  })

  it('a phone never goes past 5×5; a desktop shows 6×6 only from L18; cells never shrink past the screen', () => {
    for (const level of [...LEVELS, 17.99, 18, 30]) {
      for (const s of sample(level, 120, PHONE)) expect(s.n, `phone L${level}`).toBeLessThanOrEqual(5)
      for (const s of sample(level, 60, SMALL)) expect(s.n).toBeLessThanOrEqual(4)
      for (const s of sample(level, 30, NARROW)) expect(s.n).toBe(3)
      const desk = sample(level, 200)
      if (level < 18) for (const s of desk) expect(s.n, `desktop L${level}`).toBeLessThanOrEqual(5)
      else expect(desk.some((s) => s.n === 6), `desktop L${level}`).toBe(true)
    }
    // A short screen holds fewer rows: the square board follows the shorter side.
    for (const s of sample(20, 100, { ...DESKTOP, maxRows: 4 })) expect(s.n).toBeLessThanOrEqual(4)
  })
})

describe('Number Hunt: the clock', () => {
  it('matches the plan table', () => {
    const at = (cells: number, mode: SchulteMode, level: number) => schulteLimitMs(cells, mode, false, level) / 1000
    const rows: [number, SchulteMode, number, number][] = [
      [9, 'asc', 1, 23.2],
      [9, 'asc', 2, 21.7],
      [16, 'asc', 3, 43.6],
      [16, 'asc', 4, 40.6],
      [16, 'asc', 5, 37.9],
      [16, 'desc', 5, 41.5],
      [25, 'asc', 6, 68.5],
      [25, 'asc', 7, 63.8],
      [25, 'two', 8, 68.1],
      [25, 'skip', 9, 87.7],
      [16, 'alt', 10, 57.2],
      [25, 'alt', 11, 104],
      [16, 'altOpp', 12, 58.4],
      [25, 'altOpp', 13, 106],
      [16, 'shuffle', 14, 33.7],
    ]
    for (const [cells, mode, level, secs] of rows) expect(at(cells, mode, level), `${mode} ${cells} L${level}`).toBeCloseTo(secs, 0)
    // Unmarked takes 15% longer per number.
    expect(schulteLimitMs(25, 'skip', true, 16) - 1500).toBeCloseTo((schulteLimitMs(25, 'skip', false, 16) - 1500) * 1.15, -1)
    // The board's own clock is the one used.
    for (const s of sample(16, 200)) expect(schulte.timeLimitMs(s)).toBe(schulteLimitMs(s.n * s.n, s.mode, s.unmarked, 16))
  })

  it('no cliff: per number, a 4×4 board gets at least (16/9)·(3.04/2.41) the time of a 3×3 at the same level and mode', () => {
    const need = (16 / 9) * (3.04 / 2.41)
    for (const mode of ['asc', 'desc', 'two', 'skip', 'alt', 'altOpp', 'shuffle'] as const) {
      for (const unmarked of [false, true]) {
        for (const level of [...LEVELS, 1.5, 22.5]) {
          // Without the 1.5s to take the board in, which is the same on every board.
          const ratio = (schulteLimitMs(16, mode, unmarked, level) - 1500) / (schulteLimitMs(9, mode, unmarked, level) - 1500)
          expect(ratio, `${mode} L${level}`).toBeGreaterThanOrEqual(need - 0.001)
        }
      }
    }
  })

  it('never rises with level for the same board, and stops at its floor (a fifth) around L23', () => {
    for (const mode of ['asc', 'desc', 'two', 'skip', 'alt', 'altOpp', 'shuffle'] as const) {
      for (const cells of [9, 16, 25, 36]) {
        for (const unmarked of [false, true]) {
          const mul = { asc: 1, desc: 1.1, two: 1.15, skip: 1.6, alt: 2.2, altOpp: 2.6, shuffle: 1.7 }[mode] * (unmarked ? 1.15 : 1)
          const floor = Math.round(1500 + cells * (1600 + 90 * cells) * mul * 0.2)
          let prev = Infinity
          for (let level = 1; level <= 40; level += 0.25) {
            const t = schulteLimitMs(cells, mode, unmarked, level)
            expect(t).toBeLessThanOrEqual(prev)
            expect(t).toBeGreaterThanOrEqual(floor)
            prev = t
          }
          expect(schulteLimitMs(cells, mode, unmarked, 22)).toBeGreaterThan(floor)
          expect(schulteLimitMs(cells, mode, unmarked, 24)).toBe(floor)
        }
      }
    }
  })

  it('every level 1-23 opens a new band or tightens the clock of every board in it by ≥ 5%', () => {
    for (let level = 2; level <= 23; level++) {
      if (schulteBand(level) !== schulteBand(level - 1)) continue
      for (const m of schulteModes(level, { ...DESKTOP, trialKind: 'placement' })) {
        const side = Math.min(m.side, 7) - (m.mode === 'shuffle' ? 1 : 0)
        const gain = schulteLimitMs(side * side, m.mode, m.unmarked, level - 1) / schulteLimitMs(side * side, m.mode, m.unmarked, level)
        expect(gain, `L${level} ${m.mode}`).toBeGreaterThanOrEqual(1.05)
      }
    }
    expect([...SCHULTE_BANDS]).toEqual([1, 3, 5, 6, 8, 9, 10, 11, 12, 13, 14, 16, 18])
  })

  it('the level stops at 24 on every screen, above the master tier', () => {
    for (const ctx of [DESKTOP, PHONE, SMALL, NARROW]) {
      expect(schulte.maxLevel!(ctx)).toBe(24)
      expect(TIERS.schulte[5]).toBeLessThan(schulte.maxLevel!(ctx))
    }
  })
})

describe('Number Hunt: rules the round has not introduced', () => {
  it('blocked rules become counting up, in steps or a two-digit run, each at its own clock', () => {
    for (const level of [...LEVELS, 30]) {
      for (let seed = 1; seed <= 40; seed++) {
        for (const trialKind of ['placement', 'counted'] as const) {
          const s = make(level, seed, { ...DESKTOP, trialKind, blockRules: ALL_RULES })
          expect(['asc', 'two', 'skip'], `L${level}`).toContain(s.mode)
          expect(schulte.mechanics(s).filter((t) => ALL_RULES.includes(t))).toEqual([])
          expect(schulte.timeLimitMs(s)).toBe(schulteLimitMs(s.n * s.n, s.mode, s.unmarked, level))
        }
      }
    }
    // Counting down blocked at L5-7: those boards count up.
    for (let seed = 1; seed <= 200; seed++) expect(make(6, seed, { ...DESKTOP, blockRules: ['schulte.descending'] }).mode).toBe('asc')
  })

  it('the one rule the round lets through still comes up at a level past it', () => {
    // A strong first round at L13: counting down is the lowest unmet rule, and no L10-13 board counts down.
    const l13 = sample(13, 600, { ...DESKTOP, blockRules: ['schulte.alternate', 'schulte.alternateOpposite', 'schulte.reshuffle'] })
    expect(share(l13, (s) => s.mode === 'desc')).toBeGreaterThan(0.1)
    expect(share(l13, (s) => s.mode === 'altOpp' || s.mode === 'alt' || s.mode === 'shuffle')).toBe(0)
    // At L15 two series is the lowest unmet rule; the level's own boards are reshuffle and opposite.
    const l15 = sample(15, 600, { ...DESKTOP, blockRules: ['schulte.alternateOpposite', 'schulte.reshuffle'] })
    expect(share(l15, (s) => s.mode === 'alt')).toBeGreaterThan(0.1)
    expect(share(l15, (s) => s.mode === 'altOpp' || s.mode === 'shuffle')).toBe(0)
  })
})
