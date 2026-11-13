/**
 * Brain games: every round is generated at the player's level, the level has no ceiling (Quick Eye
 * aside, whose ladder ends at one frame), and the adaptive rules follow the research the feature
 * cites. These tests walk every game across levels and screen widths and check each round is
 * well-formed and solvable, then pin the staircase targets, the Corsi stop rule, Quick Eye's
 * exposure rules and variant ladder, the session plan and the course schedule.
 */
import { describe, it, expect } from 'vitest'
import {
  BRAIN_GAMES,
  DEFAULT_CONTEXT,
  GROUP_RULES,
  QUICK_EYE_LADDER_MS,
  advanceBarMs,
  brainGame,
  courseStatus,
  createRng,
  emptyProgress,
  exposureMsFor,
  maxColsFor,
  maxRowsFor,
  parseProgress,
  planToday,
  planTodaysSession,
  quickEyeAdvance,
  quickEyeThreshold,
  recordRound,
  recordSession,
  restartLevel,
  serializeProgress,
  stepLevel,
  targetAccuracy,
  buildDemo,
  emptyHistory,
  gameHistory,
  parseHistory,
  recordHistory,
  serializeHistory,
  roundStars,
  streakTier,
  todaysPlanSeed,
  HISTORY_PER_GAME,
  weekProgress,
  weekStart,
  type ChoiceView,
  type CreateContext,
  type QuickEyeView,
  QE_FIELD_TINT,
  QE_INK,
  QE_STAR,
  QE_STAR_CORE_R,
  QE_STAR_SPIKE,
  QE_TRIANGLE,
  QE_TRIANGLE_BORDER,
  QE_MASK_MICHELSON,
  QUICK_EYE_MAX_VARIANT,
  centerShapeScale,
  contrastRatio,
  polygonArea,
  quickEyeBarLevel,
  quickEyeBase,
  quickEyeBox,
  quickEyeGeometry,
  quickEyeHold,
  quickEyeInkFraction,
  quickEyeKnob,
  quickEyeMaskCells,
  quickEyeMaskMean,
  quickEyeMaskTones,
  quickEyePlace,
  quickEyeSpeedGauge,
  relLum,
  shapePair,
} from '@reeeeecall/shared/lib/brain-games'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

function settle(def: Any, s: Any): Any {
  for (let i = 0; i < 500 && def.pendingMs(s) !== null && !def.acceptsInput(s); i++) s = def.advance(s)
  return s
}

/** Plays a trial with nothing but the game's own `solution()` — what the how-to-play demo does. */
function playBySolution(def: Any, s: Any): Any {
  for (let guard = 0; guard < 2000 && !def.outcome(s); guard++) {
    const view = def.view(s)
    if (view.kind === 'quickEye' && view.phase === 'stimulus') {
      s = def.exposed(s, view.exposureMs, 1000 / 60)
      continue
    }
    if (def.pendingMs(s) !== null && !def.acceptsInput(s)) {
      s = def.advance(s)
      continue
    }
    const taps = def.solution(s)
    if (!taps || taps.length === 0) throw new Error('no solution while input is expected')
    s = def.tap(s, taps[0])
  }
  return s
}

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 40, 60, 120]
/** The staircase moves in fractions: every create() takes any level ≥ 1 and looks its table up itself. */
const FRACTIONAL = [1.5, 2.99, 7.3, 13.5, 25.75]
/** Desktop 7×7, a phone 5×7, a small phone 4×6, a narrow 3×5 (centre-only, last life). */
const CONTEXTS: CreateContext[] = [
  DEFAULT_CONTEXT,
  { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7, ringSlots: [8, 16, 16] },
  { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 6, ringSlots: [8, 16, 16] },
  { ...DEFAULT_CONTEXT, maxCols: 3, maxRows: 5, centerOnly: true, livesLeft: 1 },
]

describe('every game, every level, every screen', () => {
  it('the screens are what they say', () => {
    expect(CONTEXTS.map((c) => `${c.maxCols}x${c.maxRows}`)).toEqual(['7x7', '5x7', '4x6', '3x5'])
    expect([100, 300, 360, 400, 456, 600].map(maxRowsFor)).toEqual([3, 4, 5, 6, 7, 7])
  })

  for (const { id, def } of BRAIN_GAMES) {
    it(`${id}: well-formed, and following solution() always wins`, () => {
      const levels = id === 'quickEye' ? [0, ...LEVELS.filter((l) => l <= 12)] : [...LEVELS, ...FRACTIONAL]
      for (const ctx of CONTEXTS) {
        for (const level of levels) {
          for (let seed = 1; seed <= 16; seed++) {
            const c = { ...ctx, variant: 1 + (seed % 16) }
            const s0 = def.create(level, createRng(seed * 7919 + Math.round(level * 100)), c)
            const view = def.view(s0)
            const at = `${id} L${level} ${c.maxCols}x${c.maxRows} seed ${seed}`
            if (view.kind === 'grid') {
              expect(view.cells.length, at).toBe(view.cols * view.rows)
              expect(view.cols, `${at}: wider than the screen`).toBeLessThanOrEqual(Math.max(3, Math.min(7, c.maxCols)))
              if (view.extra) expect(view.extra.index, `${at}: the extra button sits after the cells`).toBe(view.cells.length)
            } else if (view.kind === 'choice') {
              const keys = view.options.map((o) => o.text ?? o.textKey ?? String(o.value))
              expect(new Set(keys).size, `${at} duplicate options ${keys}`).toBe(keys.length)
              expect(view.options.length).toBeGreaterThanOrEqual(2)
              const values = view.options.map((o) => o.value)
              if (values.every((v) => v !== undefined)) {
                for (let i = 1; i < values.length; i++) expect(values[i]!, `${at}: numeric options ascending`).toBeGreaterThan(values[i - 1]!)
              }
              if (view.stimulus.terms) expect(view.stimulus.terms.filter((t) => t === null), `${at}: one gap`).toHaveLength(1)
              expect(view.stimulus.reveal, `${at}: the reveal waits for the answer`).toBeUndefined()
            }
            const won = playBySolution(def, s0)
            expect(def.outcome(won)?.correct, `${at} not won`).toBe(true)
            expect(def.solution(won), 'nothing is asked once the trial is over').toBeNull()
          }
        }
      }
    })
  }
})

describe('Quick Eye', () => {
  const def = brainGame('quickEye').def as Any
  const frame = 1000 / 60

  it('exposure ladder runs 500ms down to one 60Hz frame, floored per platform', () => {
    expect(QUICK_EYE_LADDER_MS[0]).toBe(500)
    expect(QUICK_EYE_LADDER_MS[QUICK_EYE_LADDER_MS.length - 1]).toBe(17)
    expect(exposureMsFor(-3)).toBe(500)
    expect(exposureMsFor(99)).toBe(17)
    const s = def.create(12, createRng(1), { ...DEFAULT_CONTEXT, minExposureMs: 33 })
    expect(s.exposureMs).toBe(33)
  })

  it('voids a trial whose short exposure was off by even one frame, tolerates one frame on long ones', () => {
    const short = def.advance(def.create(10, createRng(2), DEFAULT_CONTEXT)) // 50ms = 3 frames
    expect(def.outcome(def.exposed(short, short.exposureMs + frame, frame))?.void).toBe(true)
    expect(def.exposed(short, short.exposureMs, frame).phase).toBe('mask')
    const long = def.advance(def.create(0, createRng(3), DEFAULT_CONTEXT)) // 500ms = 30 frames
    expect(def.exposed(long, long.exposureMs + frame, frame).phase).toBe('mask')
    expect(def.outcome(def.exposed(long, long.exposureMs + 3 * frame, frame))?.void).toBe(true)
  })

  it('needs both answers from variant 2, the centre alone on variant 1 and in centre-only mode', () => {
    const v2 = def.advance(def.create(0, createRng(4), { ...DEFAULT_CONTEXT, variant: 2 }))
    let s = settle(def, def.exposed(v2, v2.exposureMs, frame))
    s = def.tap(s, s.correctCenter)
    expect(s.phase).toBe('answerLocation')
    s = def.tap(s, (s.targetDir + 1) % 8)
    expect(def.outcome(s)).toMatchObject({ correct: false, accuracy: 0.5 })
    const only = def.create(0, createRng(5), { ...DEFAULT_CONTEXT, variant: 9, centerOnly: true })
    expect(only.target).toBeNull()
    expect(only.distractors).toHaveLength(0)
  })

  it('never puts a distractor on the target, and caps distractors by the field', () => {
    for (let seed = 1; seed < 200; seed++) {
      const phone = def.create(5, createRng(seed), { ...DEFAULT_CONTEXT, variant: 9, ringSlots: [8, 16, 16] })
      expect(phone.distractors.length).toBe(39)
      expect(phone.distractors.some((d: Any) => d.ring === phone.target.ring && d.slot === phone.target.slot)).toBe(false)
      const view = def.view(phone) as QuickEyeView
      expect(view.ringSlots).toEqual([8, 16, 16])
    }
  })

  it('estimates a threshold only from enough reversals, and opens the next variant on the criterion', () => {
    expect(quickEyeThreshold([100, 100, 100], [true, false, true])).toBeNull()
    const ms = Array.from({ length: 24 }, (_, i) => (i % 5 === 4 ? 133 : 83))
    const ok = Array.from({ length: 24 }, (_, i) => i % 5 !== 4)
    const t = quickEyeThreshold(ms, ok)
    expect(t).not.toBeNull()
    expect(quickEyeAdvance(2, ms, ok).advance).toBe(t! <= advanceBarMs(2))
    expect(quickEyeAdvance(16, ms, ok).advance).toBe(false)
    // The bars, relaxed for the mid-grey field and its matched mask [product decision].
    expect(advanceBarMs(1)).toBe(100)
    expect(advanceBarMs(2)).toBe(167)
    expect(advanceBarMs(3)).toBe(200)
    expect(advanceBarMs(4)).toBe(200)
    expect(advanceBarMs(7)).toBe(250)
    expect(advanceBarMs(12)).toBe(300)
    expect([1, 2, 4, 5, 9, 10, 16].map(quickEyeBarLevel)).toEqual([7, 5, 5, 4, 4, 3, 3])
  })

  it('opens the next variant on enough evidence without reversals: 16 trials all under the bar, 14+ right', () => {
    const at33 = Array.from({ length: 16 }, () => 33)
    // One miss in sixteen at the platform's shortest flash: no reversals to speak of, still a pass.
    const oneMiss = at33.map((_, i) => i !== 7)
    expect(quickEyeThreshold(at33, oneMiss)).toBeNull()
    expect(quickEyeAdvance(3, at33, oneMiss)).toEqual({ advance: true, thresholdMs: 33 })
    // Three misses (together, so the staircase path has too few reversals): not yet.
    const threeMisses = at33.map((_, i) => i > 2)
    expect(quickEyeAdvance(3, at33, threeMisses).advance).toBe(false)
    // One of the sixteen shown above the bar: not enough evidence.
    const oneSlow = at33.map((ms, i) => (i === 0 ? 267 : ms))
    expect(quickEyeAdvance(3, oneSlow, oneMiss).advance).toBe(false)
    // Fewer than sixteen: not yet; and the top variant has nowhere to go.
    expect(quickEyeAdvance(3, at33.slice(1), oneMiss.slice(1)).advance).toBe(false)
    expect(quickEyeAdvance(QUICK_EYE_MAX_VARIANT, at33, oneMiss).advance).toBe(false)
    // At the bar itself counts (a measured 167 for V2's 167), and the threshold is their geometric mean.
    const atBar = Array.from({ length: 16 }, (_, i) => (i % 2 ? 167 : 100))
    expect(quickEyeAdvance(2, atBar, oneMiss)).toEqual({ advance: true, thresholdMs: Math.round(Math.sqrt(167 * 100)) })
    expect(quickEyeAdvance(2, atBar.map((x) => (x === 167 ? 168 : x)), oneMiss).advance).toBe(true)
    expect(quickEyeAdvance(2, atBar.map((x) => (x === 167 ? 169 : x)), oneMiss).advance).toBe(false)
  })

  it('"hold top speed" counts the right answers in the run of trials under the bar at the window\'s end', () => {
    expect(quickEyeHold([], '', 3)).toEqual({ filled: 0, run: 0 })
    // A slow trial breaks the run; older trials do not count.
    expect(quickEyeHold([33, 267, 33, 33, 50], '11101', 3)).toEqual({ filled: 2, run: 3 })
    expect(quickEyeHold(Array.from({ length: 24 }, () => 33), '1'.repeat(24), 5)).toEqual({ filled: 16, run: 16 })
    expect(quickEyeHold([33, 33], [true, false], 5)).toEqual({ filled: 1, run: 2 })
  })

  it('advancing eases the exposure back three steps and clears the window', () => {
    let p = emptyProgress()
    p = { ...p, quickEye: { ...p.quickEye, variant: 2 } }
    for (let i = 0; i < 40; i++) {
      const ok = i % 5 !== 4
      // Misses happen at the harder (shorter) exposures, as on a real staircase.
      p = recordRound(p, 'quickEye', { level: 7, correct: ok, points: 10, shownMs: ok ? 83 : 67 }, '2026-11-12')
      if (p.quickEye.variant === 3) break
    }
    expect(p.quickEye.variant).toBe(3)
    expect(p.games.quickEye?.level).toBe(4)
    expect(p.quickEye.recentMs).toEqual([])
  })

  it('new records start at variant 2; the field version is set', () => {
    expect(emptyProgress().quickEye.variant).toBe(2)
    expect(emptyProgress().quickEyeField).toBe(2)
    expect(parseProgress(null).quickEye.variant).toBe(2)
  })

  it("a record from the old dark field is moved once: its window dropped, variant 1 to 2, its best score cleared — idempotent", () => {
    const old = JSON.stringify({
      v: 1,
      games: { quickEye: { level: 9, bestLevel: 10, rounds: 80, wins: 60 } },
      quickEye: { variant: 1, recentMs: [33, 50, 33], recentOk: '101', thresholdMs: 40 },
      bestRuns: { quickEye: 900, stroop: 300 },
      sessions: {},
    })
    const p = parseProgress(old)
    expect(p.quickEye).toEqual({ variant: 2, recentMs: [], recentOk: '', thresholdMs: null })
    expect(p.quickEyeField).toBe(2)
    expect(p.bestRuns.quickEye).toBeUndefined()
    // The level stays (the round recalibrates it once); a later stage stays where it was.
    expect(p.games.quickEye?.level).toBe(9)
    const v7 = parseProgress(old.replace('"variant":1', '"variant":7'))
    expect(v7.quickEye.variant).toBe(7)
    expect(v7.quickEye.recentMs).toEqual([])
    // Read again (and again): the same record — the move happens once.
    expect(parseProgress(serializeProgress(p))).toEqual(p)
    expect(parseProgress(serializeProgress(parseProgress(serializeProgress(p))))).toEqual(p)
    // Centre-only keeps variant 1.
    const centre = parseProgress(old.replace('"sessions":{}', '"sessions":{},"settings":{"centerOnly":true}'))
    expect(centre.quickEye.variant).toBe(1)
    // A record already on the new field at variant 1 (placement's slow-start path) is left alone.
    const placed = JSON.stringify({ ...JSON.parse(old), quickEyeField: 2, quickEye: { variant: 1, recentMs: [100, 83], recentOk: '11', thresholdMs: null } })
    const kept = parseProgress(placed)
    expect(kept.quickEye).toEqual({ variant: 1, recentMs: [100, 83], recentOk: '11', thresholdMs: null })
    expect(kept.bestRuns.quickEye).toBe(900)
  })

  it('points by stage and speed level never drop at a stage-up (V+1, level −3); V1 at level 11 is 120', () => {
    expect(quickEyeBase(1, 11)).toBe(120)
    for (let v = 1; v < QUICK_EYE_MAX_VARIANT; v++) {
      for (let l = 0; l <= 11; l += 0.25) {
        expect(quickEyeBase(v + 1, Math.max(0, l - 3)), `V${v} L${l}`).toBeGreaterThan(quickEyeBase(v, l))
      }
    }
  })

  it('the speed gauge says exactly how many right answers until the shown speed level rises (k = 1 and 2)', () => {
    const max = 11
    for (const k of [1, 2]) {
      for (let l100 = 0; l100 <= 1100; l100++) {
        const level = l100 / 100
        const g = quickEyeSpeedGauge(level, k, max)
        expect(g.shown).toBe(Math.min(11, Math.round(level)))
        expect(g.atTop).toBe(Math.round(level) >= max)
        if (g.atTop) continue
        let lv = level
        let n = 0
        while (Math.round(lv) <= Math.round(level) && n < 50) {
          lv = Math.min(max, stepLevel('quickEye', lv, true, 1, k))
          n++
        }
        expect(g.toNext, `L${level} k${k}`).toBe(n)
        expect(g.pips).toBeGreaterThanOrEqual(0)
        expect(g.pips).toBeLessThanOrEqual(3)
      }
    }
    // A quarter of a speed level per pip: just over a rung's lower edge none, the middle two.
    expect(quickEyeSpeedGauge(2.5, 1, 11).pips).toBe(0)
    expect(quickEyeSpeedGauge(3, 1, 11)).toMatchObject({ pips: 2, toNext: 2 })
    expect(quickEyeSpeedGauge(3, 2, 11)).toMatchObject({ pips: 2, toNext: 1 })
    expect(quickEyeSpeedGauge(11, 1, 11).atTop).toBe(true)
  })

  it('the stage groups, and what each new stage brings', () => {
    expect([1, 2, 4, 5, 9, 10, 14, 15, 16].map((v) => quickEyePlace(v))).toEqual(['dock', 'shore', 'shore', 'pines', 'pines', 'tea', 'tea', 'lake', 'lake'])
    expect(quickEyePlace(7, true)).toBe('dock')
    expect(quickEyePlace(12, true)).toBe('tea')
    expect([2, 3, 4, 5, 6, 9, 10, 14, 15, 16].map((v) => quickEyeKnob(v))).toEqual(['wider', 'ring2', 'ring3', 'crowd', 'moreCrowd', 'moreCrowd', 'similar', 'similar', 'sameDiff', 'similar'])
    expect(quickEyeKnob(5, true)).toBeNull()
    expect(quickEyeKnob(10, true)).toBe('similar')
  })
})

describe('Quick Eye drawing (measuring frame)', () => {
  it('star and triangle have the same area (±2%); the centre pair at every similarity too (±1%)', () => {
    const star = polygonArea(QE_STAR)
    expect(star).toBeCloseTo(1.1227, 3)
    expect(Math.abs(polygonArea(QE_TRIANGLE) - star) / star).toBeLessThan(0.02)
    // The mobile star — a core circle and five spikes — covers the same: the spikes are the star
    // outside the inner pentagon, and the circle's bulge past each pentagon side stays inside a spike.
    const pentagon = 5 * 0.5 * QE_STAR_SPIKE.apothem * 2 * QE_STAR_SPIKE.halfBase
    const spikes = 5 * QE_STAR_SPIKE.halfBase * QE_STAR_SPIKE.height
    expect(Math.abs(pentagon + spikes - star) / star).toBeLessThan(0.005)
    expect(QE_STAR_SPIKE.apothem + QE_STAR_SPIKE.height).toBeCloseTo(1, 3)
    expect(QE_STAR_CORE_R * Math.cos(Math.PI / 5)).toBeCloseTo(QE_STAR_SPIKE.apothem, 3)
    // The mobile border triangle is the same triangle.
    expect(QE_TRIANGLE_BORDER.halfBase * QE_TRIANGLE_BORDER.height).toBeCloseTo(polygonArea(QE_TRIANGLE), 2)
    for (let sim = 1; sim <= 9; sim++) {
      const [circle, square] = shapePair(sim)
      const p = Number(square.split(':')[1]) / 100
      const a = centerShapeScale(square)
      const squareArea = a * a * (1 - (4 - Math.PI) * p * p)
      const circleArea = (Math.PI / 4) * centerShapeScale(circle) ** 2
      expect(Math.abs(squareArea - circleArea) / circleArea, `similarity ${sim}`).toBeLessThan(0.01)
    }
  })

  it('every field tint is mid-grey (relative luminance 0.185 ± 0.01) and the ink stands 3:1 on it', () => {
    for (const [place, tint] of Object.entries(QE_FIELD_TINT)) {
      expect(Math.abs(relLum(tint) - 0.185), place).toBeLessThanOrEqual(0.01)
      expect(contrastRatio(QE_INK, tint), place).toBeGreaterThanOrEqual(3)
    }
  })

  it("the mask: Michelson ≤ 0.5, its area-weighted mean within 3% of the stimulus frame's, no regular pattern", () => {
    const size = 340
    const cell = 14
    const cols = Math.ceil(size / cell)
    const corner = 24
    // Cells clipped to the field's rounded square, each weighted by the share left inside.
    const inside = (x: number, y: number) => {
      const qx = Math.max(Math.abs(x - size / 2) - (size / 2 - corner), 0)
      const qy = Math.max(Math.abs(y - size / 2) - (size / 2 - corner), 0)
      return Math.hypot(qx, qy) <= corner
    }
    const weight = (cx: number, cy: number) => {
      let n = 0
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside(cx * cell + (i + 0.5) * (cell / 4), cy * cell + (j + 0.5) * (cell / 4))) n++
      return n / 16
    }
    for (const a of [0.02, 0.05, 0.1, 0.15]) {
      for (const tint of Object.values(QE_FIELD_TINT)) {
        const tones = quickEyeMaskTones(a, tint)
        expect(tones).toHaveLength(6)
        const lums = tones.map(relLum)
        const michelson = (Math.max(...lums) - Math.min(...lums)) / (Math.max(...lums) + Math.min(...lums))
        expect(michelson).toBeLessThanOrEqual(0.5)
        expect(michelson).toBeCloseTo(QE_MASK_MICHELSON, 1)
        const target = relLum(tint) * (1 - a) + relLum(QE_INK) * a
        expect(Math.abs(relLum(quickEyeMaskMean(a, tint)) - target) / target).toBeLessThan(0.03)
        for (let seed = 1; seed <= 100; seed += 33) {
          let sum = 0
          let w = 0
          for (const c of quickEyeMaskCells(seed, cols, tones)) {
            const k = weight(c.x, c.y)
            sum += relLum(c.tone) * k
            w += k
          }
          expect(Math.abs(sum / w - target) / target, `a ${a} ${tint} seed ${seed}`).toBeLessThan(0.03)
        }
      }
    }
    // Random order: neighbouring cells along rows and columns are not correlated (stripes and
    // checks would be), and the order changes with the seed.
    const tones = quickEyeMaskTones(0.08, QE_FIELD_TINT.shore)
    const lag1 = (xs: number[][], dx: number, dy: number) => {
      const all = xs.flat()
      const mean = all.reduce((p, q) => p + q, 0) / all.length
      let num = 0
      let den = 0
      for (let y = 0; y < xs.length; y++) {
        for (let x = 0; x < xs[y].length; x++) {
          den += (xs[y][x] - mean) ** 2
          if (y + dy < xs.length && x + dx < xs[y].length) num += (xs[y][x] - mean) * (xs[y + dy][x + dx] - mean)
        }
      }
      return num / den
    }
    const patterns = new Set<string>()
    for (let seed = 1; seed <= 100; seed++) {
      const cells = quickEyeMaskCells(seed, 24, tones)
      const grid = Array.from({ length: 24 }, (_, y) => cells.filter((c) => c.y === y).sort((p, q) => p.x - q.x).map((c) => relLum(c.tone)))
      expect(Math.abs(lag1(grid, 1, 0)), `seed ${seed} rows`).toBeLessThan(0.2)
      expect(Math.abs(lag1(grid, 0, 1)), `seed ${seed} columns`).toBeLessThan(0.2)
      patterns.add(cells.map((c) => c.tone).join(''))
    }
    expect(patterns.size).toBe(100)
  })

  it('the ink share counts the centre, the star, the triangles and the box border', () => {
    const geo = { ...quickEyeGeometry(340, 112, 112, [8, 16, 16]), ...quickEyeBox(340, false) }
    const field = 340 * 340 - (4 - Math.PI) * 24 * 24
    const bare = quickEyeInkFraction({ center: ['circle'], target: null, distractors: [] }, geo, field)
    const crowd = quickEyeInkFraction({ center: ['circle'], target: { ring: 0, slot: 0 }, distractors: Array.from({ length: 39 }, () => ({ ring: 1, slot: 0 })) }, geo, field)
    expect(bare).toBeGreaterThan(0.02)
    expect(bare).toBeLessThan(crowd)
    expect(crowd).toBeLessThan(0.3)
  })
})

describe('staircase', () => {
  it('targets 85% for speed games and 80% for Quick Eye; speed never moves the level', () => {
    expect(targetAccuracy('speed')).toBeCloseTo(0.85, 2)
    expect(targetAccuracy('quickEye')).toBeCloseTo(0.8, 2)
  })

  function simulate(group: 'speed' | 'quickEye', threshold: number, seed: number) {
    const rng = createRng(seed)
    const r = GROUP_RULES[group]
    let level = r.min
    let wins = 0
    const N = 6000
    for (let i = 0; i < N; i++) {
      const p = 1 / (1 + Math.exp((level - threshold) / 1.2))
      const correct = rng.chance(p)
      wins += correct ? 1 : 0
      level = stepLevel(group, level, correct, correct ? 1 : 0, i % 20)
    }
    return wins / N
  }

  it('settles near its target accuracy', () => {
    expect(Math.abs(simulate('speed', 15, 1) - 0.85)).toBeLessThan(0.04)
    expect(Math.abs(simulate('quickEye', 8, 2) - 0.8)).toBeLessThan(0.05)
  })

  it('uncertainty scales both steps by k (the ratio — the target — unchanged); never below the floor', () => {
    expect(stepLevel('speed', 5, true, 1, 2)).toBeCloseTo(5.3)
    expect(stepLevel('speed', 5, true, 1)).toBeCloseTo(5.15)
    expect(stepLevel('speed', 5, false, 0, 2)).toBeCloseTo(3.3)
    expect(stepLevel('speed', 1.2, false, 0)).toBe(1)
    expect(stepLevel('quickEye', 11.9, true, 1)).toBe(12)
    let level = 1
    for (let i = 0; i < 2000; i++) level = stepLevel('speed', level, true, 1)
    expect(level).toBeGreaterThan(250)
  })

  it('span games follow Corsi: up one length per success, a miss does not move the level', () => {
    expect(stepLevel('span', 4, true, 1, 0)).toBe(5)
    expect(stepLevel('span', 4, false, 0, 0)).toBe(4)
    expect(restartLevel('span', 9, 9)).toBe(7)
    expect(restartLevel('speed', 6.4, 6.4)).toBeCloseTo(5.9)
    expect(restartLevel('quickEye', 0.5, 0.5)).toBe(0)
  })
})

describe('Today\'s Training plan', () => {
  it('every session is a different mix: game count, games, order and minutes vary within the chosen length', () => {
    const SLOW = ['schulte', 'pairs', 'quickEye']
    for (const length of [5, 20] as const) {
      const shapes = new Set<string>()
      const splits = new Set<string>()
      let quickEyeFirst = 0
      let quickEyeIn = 0
      for (let seed = 1; seed <= 80; seed++) {
        let p = emptyProgress()
        p = { ...p, sessions: { ...p.sessions, total: seed }, settings: { ...p.settings, sessionMinutes: length } }
        const { focus, slots } = planToday(p, createRng(seed * 7919))
        const ids = slots.map((s) => s.gameId)
        // Exactly the chosen length, no game twice, each slot big enough for its game.
        expect(slots.reduce((a, s) => a + s.minutes, 0)).toBe(length)
        expect(new Set(ids).size).toBe(ids.length)
        for (const s of slots) expect(s.minutes).toBeGreaterThanOrEqual(SLOW.includes(s.gameId) ? (length === 5 ? 1.5 : 3) : length === 5 ? 1 : 2.5)
        expect(ids.length).toBeGreaterThanOrEqual(length === 5 ? 2 : 3)
        expect(ids.length).toBeLessThanOrEqual(length === 5 ? 4 : 6)
        // Quick Eye at least every other session (it is the task closest to the studied training).
        if (seed % 2 === 0) expect(ids).toContain('quickEye')
        if (ids.includes('quickEye')) quickEyeIn++
        if (ids[0] === 'quickEye') quickEyeFirst++
        if (focus === 'memory') expect(ids.some((id) => BRAIN_GAMES.find((g) => g.id === id)!.skill === 'memory')).toBe(true)
        shapes.add(ids.join(','))
        splits.add(slots.map((s) => s.minutes).join('/'))
      }
      expect(shapes.size).toBeGreaterThan(30)
      expect(splits.size).toBeGreaterThan(5)
      // Not pinned to the start, and not in every session either.
      expect(quickEyeFirst).toBeLessThan(quickEyeIn)
      expect(quickEyeIn).toBeLessThan(80)
    }
    expect(emptyProgress().settings.sessionMinutes).toBe(5)
  })

  it('a game left out lately comes back: over a few sessions all nine turn up', () => {
    let p = emptyProgress()
    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      const slots = planTodaysSession(p, createRng(100 + i))
      slots.forEach((s) => seen.add(s.gameId))
      p = recordSession(p, 5, `2026-11-${String(2 + i * 2).padStart(2, '0')}`, null, slots.map((s) => s.gameId))
    }
    expect(seen.size).toBe(9)
  })

  it('counts sessions by week, Monday to Sunday', () => {
    expect(weekStart('2026-11-12')).toBe('2026-11-09')
    expect(weekStart('2026-11-09')).toBe('2026-11-09')
    expect(weekStart('2026-11-15')).toBe('2026-11-09')
    let p = emptyProgress()
    for (const day of ['2026-11-06', '2026-11-09', '2026-11-11']) p = recordSession(p, 22, day, null)
    expect(weekProgress(p, '2026-11-12')).toEqual({ done: 2, goal: 3 })
  })

  it('runs a 10-session core course, then refreshers at 11 and 35 months', () => {
    let p = emptyProgress()
    // Mon/Wed/Fri from Monday 2026-01-05: the 10th session is Monday 2026-02-02.
    const days = ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14', '2026-01-16', '2026-01-19', '2026-01-21', '2026-01-23', '2026-02-02']
    for (const day of days) p = recordSession(p, 22, day, null)
    expect(p.sessions.coreDoneOn).toBe('2026-02-02')
    expect(courseStatus(p, '2026-06-01')).toMatchObject({ phase: 'maintenance', nextBoosterOn: '2027-01-02' })
    expect(courseStatus(p, '2027-01-04')).toMatchObject({ phase: 'booster', booster: { index: 1, done: 0, total: 4 } })
    for (const day of ['2027-01-04', '2027-01-06', '2027-01-08', '2027-01-11']) p = recordSession(p, 22, day, 1)
    expect(courseStatus(p, '2027-01-20')).toMatchObject({ phase: 'maintenance', nextBoosterOn: '2029-01-02' })
    expect(courseStatus(p, '2029-01-03')).toMatchObject({ phase: 'booster', booster: { index: 2 } })
  })

  it('a session past three in a week is welcome but moves the course no further (EVIDENCE §3)', () => {
    let p = emptyProgress()
    for (let i = 0; i < 10; i++) p = recordSession(p, 22, '2026-01-15', null)
    expect(p.sessions.total).toBe(10)
    expect(p.sessions.course).toBe(3)
    expect(p.sessions.coreDoneOn).toBeNull()
    expect(courseStatus(p, '2026-01-15')).toMatchObject({ phase: 'core', coreDone: 3 })
  })
})

describe('choice answers', () => {
  it('math: the marked option is the real answer, all options non-negative', () => {
    const { def } = brainGame('math')
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 60; seed++) {
        const s = def.create(Math.max(1, level), createRng(seed + level * 1000), DEFAULT_CONTEXT) as Any
        const view = def.view(s) as ChoiceView
        // Tokens when the game sends them (numbers drawn by locale), plain text otherwise.
        const written = view.stimulus.tokens ? view.stimulus.tokens.join(' ') : view.stimulus.text!
        const expr = written.replace(/\s*=\s*\?$/, '')
        const values = view.options.map((o) => o.value ?? Number(o.text))
        values.forEach((v) => expect(v).toBeGreaterThanOrEqual(0))
        if (!expr.includes('?')) {
          const answer = Function(`return ${expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')}`)()
          expect(values[s.correctIndex]).toBe(answer)
        }
      }
    }
  })

  it('stroop: the answer is the ink (or the word, when asked)', () => {
    const { def } = brainGame('stroop')
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 60; seed++) {
        const s = def.create(Math.max(1, level), createRng(seed + level * 31), DEFAULT_CONTEXT) as Any
        const view = def.view(s) as ChoiceView
        const answer = view.options[s.correctIndex].textKey
        const rule = view.stimulus.cue ?? (s.prompt.key === 'play.pickWord' ? 'word' : 'ink')
        const want = rule === 'ink' ? `colors.${view.stimulus.color}` : view.stimulus.textKey
        expect(answer).toBe(want)
      }
    }
  })
})

describe('per-game life rules', () => {
  it('Number Hunt spends a life per wrong tap, and stops at the lives left', () => {
    const def = brainGame('schulte').def as Any
    let s = def.create(3, createRng(9), { ...DEFAULT_CONTEXT, livesLeft: 2 })
    const right = def.solution(s)[0]
    const wrong = right === 0 ? 1 : 0
    s = def.tap(s, wrong)
    expect(def.outcome(s)).toBeNull()
    s = def.tap(s, wrong)
    expect(def.outcome(s)).toMatchObject({ correct: false, livesSpent: 2 })
  })

  it('Match Pairs does not count turning over unseen cards as mistakes', () => {
    const def = brainGame('pairs').def as Any
    let s = def.create(24, createRng(11), DEFAULT_CONTEXT) // the preview has tapered away by here
    s = settle(def, s)
    const a = 0
    const b = s.cards.findIndex((c: string, i: number) => i !== a && c !== s.cards[a])
    s = def.tap(def.tap(s, a), b)
    expect(s.misses).toBe(0)
  })
})

describe('migration and rotation', () => {
  it('converts v1 span levels to the new length scale', () => {
    const v1 = JSON.stringify({ v: 1, games: { memoryGrid: { level: 6, bestLevel: 9, rounds: 4, wins: 3 }, sequence: { level: 6, bestLevel: 6, rounds: 2, wins: 1 }, math: { level: 6, bestLevel: 6, rounds: 2, wins: 1 } }, totalRounds: 8, totalPoints: 0, lastDay: null, dayStreak: 0, todayRounds: 0 })
    const p = parseProgress(v1)
    expect(p.games.memoryGrid).toMatchObject({ level: 4, bestLevel: 5 }) // 3 + ⌊5·0.6⌋ = 6 cells → length 6 − 2
    expect(p.games.sequence).toMatchObject({ level: 3 }) // 3 + ⌊5·0.45⌋ = 5 tiles → 3
    // A v2 record is read as written.
    const v2 = parseProgress(serializeProgress({ ...emptyProgress(), games: { memoryGrid: { level: 6, bestLevel: 6, rounds: 1, wins: 1 } } }))
    expect(v2.games.memoryGrid?.level).toBe(6)
  })

  it('rotates by the games recent sessions used, not by trial counts', () => {
    let p = emptyProgress()
    p = recordSession(p, 22, '2026-11-10', null, ['quickEye', 'oddOneOut', 'memoryGrid', 'pairs'])
    const justUsed = ['oddOneOut', 'memoryGrid', 'pairs']
    for (let seed = 1; seed < 30; seed++) {
      const others = planTodaysSession(p, createRng(seed)).map((s) => s.gameId).filter((id) => id !== 'quickEye')
      // Games the last session used give way to the ones it did not.
      expect(others.filter((id) => justUsed.includes(id)).length).toBeLessThanOrEqual(others.filter((id) => !justUsed.includes(id)).length)
    }
  })
})

describe('progress', () => {
  it('records rounds, keeps the best level, and counts day streaks', () => {
    let p = emptyProgress()
    p = recordRound(p, 'math', { level: 3.3, correct: true, points: 30 }, '2026-11-10')
    p = recordRound(p, 'math', { level: 2.5, correct: false, points: 0 }, '2026-11-10')
    expect(p.games.math).toEqual({ level: 2.5, bestLevel: 3.3, rounds: 2, wins: 1 })
    expect(p.todayRounds).toBe(2)
    p = recordRound(p, 'stroop', { level: 1.3, correct: true, points: 10 }, '2026-11-11')
    expect(p.dayStreak).toBe(2)
  })

  it('round-trips, tolerates garbage, and stays small enough for SecureStore', () => {
    let p = emptyProgress()
    for (const g of BRAIN_GAMES) p = recordRound(p, g.id, { level: g.id === 'quickEye' ? 9 : 123.45, correct: true, points: 99999, shownMs: 133 }, '2026-11-12')
    for (let i = 0; i < 30; i++) p = recordRound(p, 'quickEye', { level: 6.25, correct: i % 3 !== 0, points: 10, shownMs: i % 3 ? 267 : 333 }, '2026-11-12')
    for (let i = 0; i < 20; i++) p = recordSession(p, 23, `2026-11-${String(10 + (i % 18)).padStart(2, '0')}`, null)
    p = { ...p, bestRuns: Object.fromEntries(BRAIN_GAMES.map((g) => [g.id, 123456])), practiced: BRAIN_GAMES.map((g) => g.id) }
    const raw = serializeProgress(p)
    expect(parseProgress(raw)).toEqual(p)
    expect(raw.length).toBeLessThan(1800)
    expect(parseProgress('not json')).toEqual(emptyProgress())
    expect(parseProgress('{"v":2}')).toEqual(emptyProgress())
    expect(parseProgress('{"v":1,"games":{},"quickEye":{"variant":99,"recentMs":[1,2],"recentOk":"1"}}').quickEye).toMatchObject({ variant: 16, recentMs: [], recentOk: '' })
    // A corrupted level is clamped, never handed to a game as 1e308 (which hung Quick Math).
    const huge = parseProgress('{"v":1,"games":{"math":{"level":1e308},"quickEye":{"level":99}},"sessions":{}}')
    expect(huge.games.math?.level).toBeGreaterThanOrEqual(1)
    expect(huge.games.math?.level).toBeLessThanOrEqual(500)
    expect(huge.games.quickEye?.level).toBe(12)
    expect(brainGame('math').def.create(1e308, createRng(1), DEFAULT_CONTEXT)).toBeTruthy()
  })
})

describe('the how-to-play demo plays every game from the engine alone', () => {
  it('every game has a demo that asks something, taps, and ends on a right answer', () => {
    for (const { id, def } of BRAIN_GAMES) {
      const frames = buildDemo(id)
      expect(frames.length, id).toBeGreaterThan(2)
      expect(frames.some((f) => f.tap !== undefined), `${id} demo taps`).toBe(true)
      const last = frames[frames.length - 1].view
      if (last.kind === 'choice') expect(last.picked).toBe(last.correctIndex)
      if (last.kind === 'quickEye') {
        expect(last.pickedCenter).toBe(last.correctCenter)
        expect(last.pickedDirection).toBe(last.correctDirection)
      }
      if (last.kind === 'grid') expect(last.cells.some((c) => c.tone === 'wrong'), `${id} demo makes no mistake`).toBe(false)
      expect(frames.every((f) => f.holdMs > 0 && f.holdMs <= 1600)).toBe(true)
      // Quick Eye's demo shows the flash (variant 2: centre and star) — or the centre alone for a
      // player on the centre-only setting.
      if (id === 'quickEye') {
        expect(frames.some((f) => f.flash)).toBe(true)
        const centre = buildDemo('quickEye', { centerOnly: true })
        expect(centre.every((f) => f.view.kind !== 'quickEye' || f.view.target === null)).toBe(true)
      }
      void def
    }
  })

  it("Color Word's demo shows the conflict it teaches: the word names one colour, the ink is another", () => {
    // The platforms build it on a 4-wide, 4-tall board (DemoPlayer); the default context too.
    for (const ctx of [{}, { maxCols: 4, maxRows: 4 }]) {
      const asked = buildDemo('stroop', ctx).find((f) => f.tap !== undefined)?.view as ChoiceView
      expect(asked.stimulus.textKey).not.toBe(`colors.${asked.stimulus.color}`)
    }
  })

  it("Quick Eye's demo plays the player's stage: V2 by default, the given variant, V1 only on centre-only", () => {
    const shown = (ctx: Partial<CreateContext>) => (buildDemo('quickEye', ctx).find((f) => f.flash)?.view as QuickEyeView).variant
    expect(shown({})).toBe(2)
    expect(shown({ variant: 7 })).toBe(7)
    expect(shown({ variant: 1 })).toBe(2)
    expect(shown({ variant: 7, centerOnly: true })).toBe(1)
  })

  it('nearMiss and the reveal are display only: solution() and the outcome stay the same on every variant', () => {
    const def = brainGame('quickEye').def as Any
    for (const centerOnly of [false, true]) {
      for (let variant = 1; variant <= QUICK_EYE_MAX_VARIANT; variant++) {
        for (let seed = 1; seed <= 6; seed++) {
          const s0 = def.create(3, createRng(seed * 131 + variant), { ...DEFAULT_CONTEXT, variant, centerOnly, ringSlots: [8, 16, 16] })
          const won = playBySolution(def, s0)
          const view = def.view(won) as QuickEyeView
          expect(def.outcome(won)?.correct).toBe(true)
          expect(view.nearMiss ?? false).toBe(false)
          expect(view.variant).toBe(variant)
          expect(view.place).toBe(quickEyePlace(variant, centerOnly))
          if (s0.targetDir === null) continue
          // To the answers: the centre right, then a direction one, two and seven steps round.
          let s = def.advance(s0)
          s = def.exposed(s, s.exposureMs, 1000 / 60)
          s = settle(def, s)
          expect(def.solution(s)).toEqual([s.correctCenter, s.targetDir])
          s = def.tap(s, s.correctCenter)
          for (const [step, near] of [[1, true], [2, false], [7, true]] as const) {
            const done = def.tap(s, (s.targetDir + step) % 8)
            expect((def.view(done) as QuickEyeView).nearMiss, `V${variant} step ${step}`).toBe(near)
            expect(def.outcome(done)).toMatchObject({ correct: false, accuracy: 0.5 })
            expect(def.solution(done)).toBeNull()
          }
        }
      }
    }
  })
})

describe('round history, stars and streaks', () => {
  it('keeps the last rounds per game, round-trips, and stays small for SecureStore', () => {
    let h = emptyHistory()
    for (const { id } of BRAIN_GAMES) {
      for (let i = 0; i < 20; i++) h = recordHistory(h, id, { day: '2026-11-12', level: 12.34 + i, accuracy: 0.876 })
    }
    for (const { id } of BRAIN_GAMES) expect(gameHistory(h, id)).toHaveLength(HISTORY_PER_GAME)
    const raw = serializeHistory(h)
    expect(raw.length).toBeLessThan(1800)
    const back = parseHistory(raw)
    expect(gameHistory(back, 'memoryGrid').at(-1)).toEqual({ day: '2026-11-12', level: 31.3, accuracy: 0.88 })
    expect(parseHistory('{"v":2,"rounds":{"memoryGrid":[[1,2],"x",[1,2,3]],"nope":[[1,1,1]]}}').rounds).toEqual({ memoryGrid: [[1, 2, 3]] })
    expect(parseHistory('garbage')).toEqual(emptyHistory())
    // A day far out of range would throw in the date conversion on every trend: it is dropped.
    expect(parseHistory('{"v":2,"rounds":{"math":[[9e15,10,50],[1000,10,50]]}}').rounds).toEqual({ math: [[1000, 10, 50]] })
  })

  it('stars by accuracy (none for very short rounds), streak tiers at 3, 6 and 10', () => {
    expect(roundStars(4, 4)).toBe(0)
    expect(roundStars(10, 9)).toBe(3)
    expect(roundStars(10, 8)).toBe(2)
    expect(roundStars(10, 5)).toBe(1)
    expect([2, 3, 6, 10].map(streakTier)).toEqual([0, 1, 2, 3])
  })

  it("today's line-up is the same all day, and changes once a session is done", () => {
    const p = emptyProgress()
    const a = planTodaysSession(p, createRng(todaysPlanSeed(p, '2026-11-12'))).map((s) => s.gameId)
    const b = planTodaysSession(p, createRng(todaysPlanSeed(p, '2026-11-12'))).map((s) => s.gameId)
    expect(a).toEqual(b)
    const after = recordSession(p, 22, '2026-11-12', null, a)
    expect(todaysPlanSeed(after, '2026-11-12')).not.toBe(todaysPlanSeed(p, '2026-11-12'))
  })
})
