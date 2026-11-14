/**
 * The thinking games (owner 2026-11-13: «합찾기 숫자야구 숫자만들기 가능한가?», «미로찾기는 어때?
 * 드래그하면서 할 수 있도록»): Set Match (합 찾기), Code Break (숫자 야구), Make the Number (숫자
 * 만들기) and Maze Run (미로 찾기). These tests pin their contracts — catalogue, colours, tiers,
 * mechanics, views, the rules of play and placement — and sample trials band by band against the
 * owner's quality bar («새로운 게임은 처음부터 내 피드백 수준으로 만들어라»): every level changes
 * the content, harder means more items or less time, a new kind of content starts small again with
 * a card, the top can be lost, and colour is never red against green.
 *
 * The board generators are first versions (W3 replaces them); everything asserted here is what the
 * real generators must keep.
 */
import { describe, it, expect } from 'vitest'
import {
  BRAIN_GAMES,
  DEFAULT_CONTEXT,
  GAME_THEMES,
  MAZE_WALL,
  MECHANICS,
  SET_CARD_FACE,
  SET_COLORS,
  TIERS,
  brainGame,
  buildDemo,
  createRng,
  earnedByRound,
  emptyMeta,
  emptyProgress,
  maxColsFor,
  maxRowsFor,
  pCorrect,
  placementDone,
  placementHandover,
  placementLevel,
  planToday,
  startPlacement,
  updatePlacement,
  zestPlan,
  type BrainGameId,
  type CodeBreakView,
  type CreateContext,
  type MakeNumberView,
  type MakeToken,
  type MazeView,
  type SetColor,
  type SetMatchView,
} from '@reeeeecall/shared/lib/brain-games'
import { SET_MATCH_LADDER, SET_MATCH_MAX_LEVEL, isSet, setMatch, setMatchBand, setsOn, type SetMatchState } from '@reeeeecall/shared/lib/brain-games/games/set-match'
import { CODE_BREAK_LADDER, CODE_BREAK_MAX_LEVEL, codeBreak, codeBreakBand, scoreGuess, type CodeBreakState } from '@reeeeecall/shared/lib/brain-games/games/code-break'
import {
  MAKE_NUMBER_LADDER,
  MAKE_NUMBER_MAX_LEVEL,
  evaluate,
  formatFrac,
  makeNumber,
  makeNumberBand,
  makeNumberLimitMs,
  type MakeNumberState,
} from '@reeeeecall/shared/lib/brain-games/games/make-number'
import { MAZE_HIDDEN_MIN_CELL, MAZE_LADDER, MAZE_MAX_LEVEL, MAZE_MIN_CELL, mazeBand, mazeFit, mazeRun, type MazeState } from '@reeeeecall/shared/lib/brain-games/games/maze-run'

const NEW: readonly BrainGameId[] = ['setMatch', 'codeBreak', 'makeNumber', 'mazeRun']
/** Desktop 7×7, a phone 5×7, a small phone 4×6. */
const SCREENS: CreateContext[] = [DEFAULT_CONTEXT, { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 }, { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 6 }]
const PHONE = SCREENS[1]
const SEEDS = 8
const make = <S,>(def: { create(l: number, r: ReturnType<typeof createRng>, c: CreateContext): S }, level: number, seed: number, ctx: CreateContext = PHONE) =>
  def.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx)
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

// ── colour: CVD simulation (linear sRGB) → CIELAB → CIEDE2000, as brain-stroop-ladder.test.ts ──
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

describe('the catalogue entries', () => {
  it('four games, on the 85% staircase, spread over skills, with their own icon', () => {
    const rows = NEW.map((id) => brainGame(id))
    expect(rows.map((g) => [g.id, g.skill, g.group, g.role, g.icon])).toEqual([
      ['setMatch', 'attention', 'speed', 'reasoning', 'layers'],
      ['codeBreak', 'reasoning', 'speed', 'reasoning', 'lock'],
      ['makeNumber', 'reasoning', 'speed', 'reasoning', 'target'],
      ['mazeRun', 'attention', 'speed', 'variety', 'compass'],
    ])
    // Twelve games, three a skill (the hub label and the day's focus stay balanced).
    const bySkill: Record<string, number> = {}
    for (const g of BRAIN_GAMES) bySkill[g.skill] = (bySkill[g.skill] ?? 0) + 1
    expect(BRAIN_GAMES).toHaveLength(12)
    expect(bySkill).toEqual({ speed: 3, memory: 3, attention: 3, reasoning: 3 })
    // A Code Break trial is a whole code: doubled steps, as Match Pairs.
    expect(brainGame('codeBreak').steps).toEqual({ scale: 2, kMax: 1.5 })
    expect(new Set(BRAIN_GAMES.map((g) => g.icon)).size).toBe(BRAIN_GAMES.length)
  })

  it('every game has its own theme: white text ≥ 4.5:1 on the hub card, the accent ≥ 7:1 on the canvas', () => {
    for (const { id } of BRAIN_GAMES) {
      const t = GAME_THEMES[id]
      expect(contrast('#FFFFFF', t.cardFrom), `${id} cardFrom`).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#FFFFFF', t.cardTo), `${id} cardTo`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.accent, t.canvasFrom), `${id} accent`).toBeGreaterThanOrEqual(7)
    }
    for (const key of ['cardFrom', 'accent', 'canvasFrom'] as const) {
      const values = BRAIN_GAMES.map((g) => GAME_THEMES[g.id][key].toUpperCase())
      expect(new Set(values).size, key).toBe(values.length)
    }
  })

  it('tiers: six rising thresholds, each a band where the puzzle changes, below the top on every screen', () => {
    const tops: Record<string, number> = { setMatch: SET_MATCH_MAX_LEVEL, codeBreak: CODE_BREAK_MAX_LEVEL, makeNumber: MAKE_NUMBER_MAX_LEVEL, mazeRun: MAZE_MAX_LEVEL }
    expect(tops).toEqual({ setMatch: 24, codeBreak: 21, makeNumber: 21, mazeRun: 24 })
    for (const id of NEW) {
      const t = TIERS[id]
      for (let i = 1; i < t.length; i++) expect(t[i], id).toBeGreaterThan(t[i - 1])
      for (const ctx of SCREENS) expect(t[5], id).toBeLessThan(brainGame(id).def.maxLevel!(ctx))
    }
  })

  it("a thinking day leans to the thinking games, and over sessions each of the four turns up", () => {
    const seen = new Set<string>()
    let thinkingDays = 0
    let thinkingSlots = 0
    let newOnThinking = 0
    for (let seed = 1; seed <= 400; seed++) {
      const { focus, slots } = planToday(emptyProgress(), createRng(seed))
      for (const s of slots) seen.add(s.gameId)
      if (focus === 'thinking') {
        thinkingDays++
        thinkingSlots += slots.length
        newOnThinking += slots.filter((s) => NEW.includes(s.gameId)).length
      }
    }
    for (const id of NEW) expect(seen.has(id), id).toBe(true)
    expect(thinkingDays).toBeGreaterThan(20)
    // Four of the seven thinking games are new: on a thinking day they fill well over a third of the slots.
    expect(newOnThinking / thinkingSlots).toBeGreaterThan(0.35)
  })

  it('«모든 게임» means every game in the catalogue, the four new ones included', () => {
    const facts = { gameId: 'math' as const, endedBy: 'cap' as const, cleared: true, trials: 10, correct: 9, livesLost: 0, bestStreak: 3, spanLength: 0, flawlessHunt: false }
    const played = (ids: readonly BrainGameId[]) => ({ ...emptyProgress(), games: Object.fromEntries(ids.map((id) => [id, { level: 2, bestLevel: 2, rounds: 1, wins: 1 }])) })
    const old8 = BRAIN_GAMES.map((g) => g.id).filter((id) => !NEW.includes(id))
    expect(earnedByRound(facts, played(old8), emptyMeta())).not.toContain('allGames')
    expect(earnedByRound(facts, played(BRAIN_GAMES.map((g) => g.id)), emptyMeta())).toContain('allGames')
  })

  it('the how-to-play demo of each asks something, taps, and ends on a right answer', () => {
    for (const id of NEW) {
      const frames = buildDemo(id)
      expect(frames.length, id).toBeGreaterThan(2)
      expect(frames.some((f) => f.tap !== undefined), id).toBe(true)
      const last = frames[frames.length - 1].view
      expect(last.kind, id).not.toBe('grid')
    }
  })
})

describe('mechanics: a new kind of content is a rule card and starts small again', () => {
  /** Items a band asks the player to handle, and its clock — for «starts small» and «harder». */
  const items: Record<string, (b: number) => number> = {
    setMatch: (b) => SET_MATCH_LADDER[b - 1].cards,
    codeBreak: (b) => CODE_BREAK_LADDER[b - 1].length * CODE_BREAK_LADDER[b - 1].pool.length,
    // Tiles × their range: the 24 band's tiles go to 13.
    makeNumber: (b) => MAKE_NUMBER_LADDER[b - 1].tiles * MAKE_NUMBER_LADDER[b - 1].maxTile,
    mazeRun: (b) => MAZE_LADDER[b - 1].cols * MAZE_LADDER[b - 1].rows + MAZE_LADDER[b - 1].keys * 10,
  }
  /** How long a band gives (ms), or its guesses for Code Break (untimed). */
  const budget: Record<string, (b: number) => number> = {
    setMatch: (b) => SET_MATCH_LADDER[b - 1].parMs,
    codeBreak: (b) => CODE_BREAK_LADDER[b - 1].maxGuesses,
    makeNumber: (b) => MAKE_NUMBER_LADDER[b - 1].parMs,
    mazeRun: (b) => mazeBand(b).previewMs || Infinity,
  }

  it('every rule of the four games arrives on a smaller board than the band before it (or the same board, slower)', () => {
    const rules = MECHANICS.filter((m) => NEW.includes(m.game as BrainGameId) && m.kind === 'rule')
    expect(rules.map((m) => m.tag)).toEqual([
      'setMatch.color', 'setMatch.fill', 'setMatch.none',
      'codeBreak.repeats',
      'makeNumber.multiply', 'makeNumber.divide', 'makeNumber.brackets', 'makeNumber.fraction',
      'mazeRun.keys', 'mazeRun.hidden', 'makeNumber.anyOrder', 'makeNumber.square',
    ])
    for (const m of rules) {
      const before = items[m.game](m.from - 1)
      const at = items[m.game](m.from)
      const slower = budget[m.game](m.from) > budget[m.game](m.from - 1)
      expect(at < before || (at === before && slower), `${m.tag}: ${before} → ${at}`).toBe(true)
    }
    // The owner's own example: 4 cards, then more (Set Match's colour and fill each restart at 4;
    // shape and count stop at 6 — two attributes make only 9 cards, so a 9-card board would be all of them).
    expect([3, 4, 5, 6, 7].map((b) => SET_MATCH_LADDER[b - 1].cards)).toEqual([6, 4, 6, 9, 12])
    expect([7, 8, 9, 10, 11].map((b) => SET_MATCH_LADDER[b - 1].cards)).toEqual([12, 4, 6, 9, 12])
  })

  it('every level step is a harder puzzle: a new rule or board, more items, or less time (fewer guesses, a shorter preview)', () => {
    const tops: Record<string, number> = { setMatch: SET_MATCH_MAX_LEVEL, codeBreak: CODE_BREAK_MAX_LEVEL, makeNumber: MAKE_NUMBER_MAX_LEVEL, mazeRun: MAZE_MAX_LEVEL }
    for (const id of NEW) {
      const starts = new Set(MECHANICS.filter((m) => m.game === id).map((m) => m.from))
      for (let b = 2; b <= tops[id]; b++) {
        const newContent = starts.has(b)
        const more = items[id](b) > items[id](b - 1)
        const less = budget[id](b) < budget[id](b - 1)
        // Content that changes without a tag: Set Match's one-set and «없음» shares, Code Break's
        // pool, Make the Number's target-24 band and maxTile, Maze Run's keys inside hidden mazes.
        const changed = JSON.stringify(ladderRow(id, b)) !== JSON.stringify(ladderRow(id, b - 1))
        expect(newContent || more || less, `${id} band ${b - 1} → ${b}`).toBe(true)
        expect(changed, `${id} band ${b} is a copy of band ${b - 1}`).toBe(true)
      }
    }
  })
})

function ladderRow(id: BrainGameId, b: number): unknown {
  if (id === 'setMatch') return SET_MATCH_LADDER[b - 1]
  if (id === 'codeBreak') return CODE_BREAK_LADDER[b - 1]
  if (id === 'makeNumber') return MAKE_NUMBER_LADDER[b - 1]
  return MAZE_LADDER[b - 1]
}

describe('Set Match (합 찾기)', () => {
  it('the card colours are Okabe–Ito blue, vermillion and black: ≥ 3:1 on the white card, ≥ 38 ΔE2000 apart in protan, deutan and tritan simulation', () => {
    expect(SET_COLORS).toEqual({ blue: '#0072B2', vermillion: '#D55E00', black: '#000000' })
    expect(SET_CARD_FACE).toBe('#FFFFFF')
    const names = Object.keys(SET_COLORS) as SetColor[]
    for (const c of names) expect(contrast(SET_COLORS[c], SET_CARD_FACE), c).toBeGreaterThanOrEqual(3)
    expect(contrast(SET_COLORS.blue, SET_CARD_FACE)).toBeCloseTo(5.2, 1)
    expect(contrast(SET_COLORS.vermillion, SET_CARD_FACE)).toBeCloseTo(3.9, 1)
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        for (const [sim, m] of Object.entries(SIMULATIONS)) {
          const d = deltaE2000(lab(simulate(m, linearRgb(SET_COLORS[names[i]]))), lab(simulate(m, linearRgb(SET_COLORS[names[j]]))))
          expect(d, `${names[i]}–${names[j]} ${sim}`).toBeGreaterThanOrEqual(38)
        }
      }
    }
    // What the owner could not tell apart: red against green collapses under the same simulation.
    const red = linearRgb('#D62728'), green = linearRgb('#2CA02C')
    expect(deltaE2000(lab(simulate(SIMULATIONS.deutanMachado, red)), lab(simulate(SIMULATIONS.deutanMachado, green)))).toBeLessThan(11)
  })

  it('every band, screen and seed: a full board of distinct cards, the fixed attributes really fixed, the set count the band promises', () => {
    for (const ctx of SCREENS) {
      for (let b = 1; b <= SET_MATCH_MAX_LEVEL; b++) {
        const row = setMatchBand(b)
        for (let seed = 1; seed <= SEEDS; seed++) {
          const s = make(setMatch, b, seed, ctx)
          const v = setMatch.view(s) as SetMatchView
          const at = `L${b} ${ctx.maxCols}x${ctx.maxRows} seed ${seed}`
          expect(v.kind).toBe('setMatch')
          expect(v.cards.length, at).toBe(v.cols * v.rows)
          expect(v.cols, at).toBeLessThanOrEqual(ctx.maxCols)
          expect(v.rows, at).toBeLessThanOrEqual(ctx.maxRows)
          expect(new Set(v.cards.map((c) => JSON.stringify(c.card))).size, `${at}: a repeated card`).toBe(v.cards.length)
          expect(v.vary, at).toEqual(row.vary)
          if (!v.vary.includes('color')) expect(new Set(v.cards.map((c) => c.card.color)), at).toEqual(new Set(['black']))
          if (!v.vary.includes('fill')) expect(new Set(v.cards.map((c) => c.card.fill)), at).toEqual(new Set(['solid']))
          // Three shapes a trial (all-different is one of each).
          expect(new Set(v.cards.map((c) => c.card.shape)).size, at).toBeLessThanOrEqual(3)
          const sets = setsOn(v.cards.map((c) => c.card)).length
          if (v.extra) {
            expect(b, at).toBeGreaterThanOrEqual(16)
            expect(v.extra.index, at).toBe(v.cards.length)
            expect(sets, at).toBeLessThanOrEqual(1)
          } else {
            expect(sets, `${at}: no set and no «없음»`).toBeGreaterThanOrEqual(1)
          }
          if (row.oneSet && v.cards.length >= 9 && !(s as SetMatchState).noneOffered) expect(sets, at).toBe(1)
          expect([v.picked, v.locked, v.answer, v.broken], at).toEqual([0, false, undefined, undefined])
          expect(setMatch.timeLimitMs(s), at).toBeGreaterThan(0)
        }
      }
    }
  })

  it('the top bands deal set-free boards (about a third) and only one-set boards otherwise', () => {
    let none = 0
    const n = 120
    for (let seed = 1; seed <= n; seed++) if (setsOn((make(setMatch, 24, seed) as SetMatchState).cards).length === 0) none++
    expect(none / n).toBeGreaterThan(0.2)
    expect(none / n).toBeLessThan(0.5)
  })

  it('a tap picks, a second tap on it unpicks, the third pick answers; a wrong triple shows what broke and the set that was there', () => {
    const s0 = make(setMatch, 10, 3) as SetMatchState
    const set = setsOn(s0.cards)[0]
    const wrong = [0, 1, 2, 3, 4, 5].flatMap((i) => [0, 1, 2, 3, 4, 5].flatMap((j) => [0, 1, 2, 3, 4, 5].map((k) => [i, j, k])))
      .find(([i, j, k]) => i < j && j < k && k < s0.cards.length && !isSet(s0.cards[i], s0.cards[j], s0.cards[k]))!
    let s = setMatch.tap(s0, wrong[0])
    s = setMatch.tap(s, wrong[0])
    expect((setMatch.view(s) as SetMatchView).picked).toBe(0)
    for (const i of wrong) s = setMatch.tap(s, i)
    expect(setMatch.outcome(s)).toMatchObject({ correct: false })
    const v = setMatch.view(s) as SetMatchView
    expect(v.locked).toBe(true)
    expect(v.broken!.length).toBeGreaterThan(0)
    expect(v.answer).toHaveLength(3)
    expect(isSet(...(v.answer!.map((i) => s0.cards[i]) as [never, never, never]))).toBe(true)
    for (const i of wrong) expect(['wrong', 'correct']).toContain(v.cards[i].tone)
    // The right triple, in any order.
    let r = s0
    for (const i of [...set].reverse()) r = setMatch.tap(r, i)
    expect(setMatch.outcome(r)).toEqual({ correct: true, accuracy: 1 })
    expect(setMatch.timeout(s0)).toMatchObject({ timedOut: true })
    expect(setMatch.outcome(setMatch.timeout(s0))?.correct).toBe(false)
  })

  it('«없음» is right on a board with no set, wrong on one with a set', () => {
    const boards = range(80).map((seed) => make(setMatch, 22, seed) as SetMatchState)
    const empty = boards.find((s) => s.set === null)!
    const full = boards.find((s) => s.set !== null)!
    expect(setMatch.outcome(setMatch.tap(empty, empty.cards.length))?.correct).toBe(true)
    const miss = setMatch.tap(full, full.cards.length)
    expect(setMatch.outcome(miss)?.correct).toBe(false)
    expect((setMatch.view(miss) as SetMatchView).extra?.tone).toBe('wrong')
    expect((setMatch.view(miss) as SetMatchView).answer).toHaveLength(3)
  })

  it('a blocked rule plays that band without it, and says so', () => {
    const s = make(setMatch, 9, 1, { ...PHONE, blockRules: ['setMatch.fill'] }) as SetMatchState
    expect(s.vary).toEqual(['shape', 'count', 'color'])
    expect(setMatch.mechanics(s)).not.toContain('setMatch.fill')
    const t = make(setMatch, 17, 1, { ...PHONE, blockRules: ['setMatch.none'] }) as SetMatchState
    expect(t.noneOffered).toBe(false)
    expect(setMatch.mechanics(t)).not.toContain('setMatch.none')
  })
})

describe('Code Break (숫자 야구)', () => {
  it('strikes and balls, repeats scored once each (as Mastermind)', () => {
    expect(scoreGuess([1, 2, 3], [1, 3, 2])).toEqual({ strikes: 1, balls: 2 })
    expect(scoreGuess([1, 2, 3], [4, 5, 6])).toEqual({ strikes: 0, balls: 0 })
    expect(scoreGuess([1, 2, 3], [1, 2, 3])).toEqual({ strikes: 3, balls: 0 })
    expect(scoreGuess([5, 0, 7, 1], [0, 5, 1, 7])).toEqual({ strikes: 0, balls: 4 })
    expect(scoreGuess([1, 1, 2], [1, 2, 1])).toEqual({ strikes: 1, balls: 2 })
    expect(scoreGuess([1, 2, 3, 4], [1, 1, 1, 1])).toEqual({ strikes: 1, balls: 0 })
    expect(scoreGuess([1, 1, 2, 2], [2, 2, 1, 1])).toEqual({ strikes: 0, balls: 4 })
  })

  it('every band and seed: the code is made of the pool, distinct digits unless repeats are on; the view never shows it while playing', () => {
    for (let b = 1; b <= CODE_BREAK_MAX_LEVEL; b++) {
      const row = codeBreakBand(b)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s = make(codeBreak, b, seed) as CodeBreakState
        const v = codeBreak.view(s) as CodeBreakView
        const at = `L${b} seed ${seed}`
        expect(s.secret, at).toHaveLength(row.length)
        for (const d of s.secret) expect(row.pool, at).toContain(d)
        if (!row.repeats) expect(new Set(s.secret).size, at).toBe(row.length)
        expect([v.length, v.pool, v.repeats, v.maxGuesses], at).toEqual([row.length, [...row.pool], row.repeats, row.maxGuesses])
        expect([v.secret, v.solved, v.locked, v.guesses, v.entry], at).toEqual([undefined, undefined, false, [], []])
        const indices = [...v.keys.map((k) => k.index), v.del.index, v.submit.index, ...v.notes.map((n) => n.index)]
        expect(new Set(indices).size, `${at}: indices collide`).toBe(indices.length)
        expect(codeBreak.timeLimitMs(s), 'untimed').toBeNull()
      }
    }
  })

  it('the keypad: no digit twice (no repeats), nothing past the length, submit when full, delete; notes are never judged', () => {
    let s = make(codeBreak, 7, 2) as CodeBreakState
    const v0 = codeBreak.view(s) as CodeBreakView
    expect(v0.submit.disabled).toBe(true)
    s = codeBreak.tap(s, 0)
    expect((codeBreak.view(s) as CodeBreakView).keys[0].disabled).toBe(true)
    expect(codeBreak.tap(s, 0)).toBe(s)
    s = codeBreak.tap(codeBreak.tap(s, 1), 2)
    const full = codeBreak.view(s) as CodeBreakView
    expect(full.entry).toEqual([s.pool[0], s.pool[1], s.pool[2]])
    expect(full.keys.every((k) => k.disabled)).toBe(true)
    expect(full.submit.disabled).toBe(false)
    s = codeBreak.tap(s, full.del.index)
    expect((codeBreak.view(s) as CodeBreakView).entry).toHaveLength(2)
    const noted = codeBreak.tap(s, full.notes[4].index)
    expect((codeBreak.view(noted) as CodeBreakView).notes[4].crossed).toBe(true)
    expect((codeBreak.view(codeBreak.tap(noted, full.notes[4].index)) as CodeBreakView).notes[4].crossed).toBe(false)
    expect(noted.guesses).toEqual(s.guesses)
  })

  it('out of guesses is a miss that shows the code; a near miss softens the drop', () => {
    let s = make(codeBreak, 3, 5) as CodeBreakState
    const wrong = s.pool.filter((d) => !s.secret.includes(d)).slice(0, 1)
    const guess = [...wrong, s.secret[1]]
    for (let g = 0; g < s.maxGuesses; g++) {
      for (const d of guess) s = codeBreak.tap(s, s.pool.indexOf(d))
      s = codeBreak.tap(s, s.pool.length + 1)
    }
    const v = codeBreak.view(s) as CodeBreakView
    expect([v.solved, v.secret, v.locked]).toEqual([false, s.secret, true])
    expect(v.guesses[0]).toMatchObject({ strikes: 1, balls: 0 })
    // Accuracy = how far the answers narrowed the code (games/code-break.ts codeBreakNarrowed): the
    // same guess six times rules out no more than once — 8 of 30 codes left, 1 − ln 8 / ln 30.
    expect(codeBreak.outcome(s)).toEqual({ correct: false, accuracy: 0.39, guesses: s.maxGuesses })
  })

  it('the top band is genuinely hard: 4 of 0-9 in 6 guesses, then 5 digits — below what a perfect player can always do', () => {
    expect(CODE_BREAK_LADDER.slice(16, 18).map((r) => [r.length, r.pool.length, r.maxGuesses, r.repeats])).toEqual([[4, 10, 7, false], [4, 10, 6, false]])
    expect(CODE_BREAK_LADDER.slice(18).map((r) => [r.length, r.pool.length, r.maxGuesses])).toEqual([[5, 10, 8], [5, 10, 7], [5, 10, 6]])
    // Level 1 is small: two digits from 1-4 (twelve codes) in eight guesses.
    expect([CODE_BREAK_LADDER[0].length, CODE_BREAK_LADDER[0].pool, CODE_BREAK_LADDER[0].maxGuesses]).toEqual([2, [1, 2, 3, 4], 8])
  })

  it('repeats start small with a card, and a blocked repeats rule plays the band without them', () => {
    expect(CODE_BREAK_LADDER.slice(12, 16).map((r) => [r.length, r.pool.length, r.repeats])).toEqual([[3, 5, true], [3, 6, true], [4, 6, true], [4, 8, true]])
    for (let seed = 1; seed <= 20; seed++) {
      const s = make(codeBreak, 13, seed, { ...PHONE, blockRules: ['codeBreak.repeats'] }) as CodeBreakState
      expect(s.repeats).toBe(false)
      expect(new Set(s.secret).size).toBe(3)
      expect(codeBreak.mechanics(s)).not.toContain('codeBreak.repeats')
    }
  })
})

describe('Make the Number (숫자 만들기)', () => {
  const n = (value: number, tile: number): MakeToken => ({ kind: 'num', value, tile })
  const o = (op: '+' | '−' | '×' | '÷' | '(' | ')'): MakeToken => ({ kind: 'op', op })

  it('judges in exact rational arithmetic: × ÷ before + −, brackets first, no float error', () => {
    const v = (t: MakeToken[]) => {
      const r = evaluate(t)
      return r && formatFrac(r)
    }
    // 8 ÷ (3 − 8 ÷ 3) = 24 — a float evaluation gives 23.999999999999996.
    expect(v([n(8, 0), o('÷'), o('('), n(3, 1), o('−'), n(8, 2), o('÷'), n(3, 3), o(')')])).toBe('24')
    expect(8 / (3 - 8 / 3)).not.toBe(24)
    expect(v([n(1, 0), o('÷'), n(3, 1), o('+'), n(1, 2), o('÷'), n(3, 3), o('+'), n(1, 4), o('÷'), n(3, 5)])).toBe('1')
    expect(v([n(2, 0), o('+'), n(3, 1), o('×'), n(4, 2)])).toBe('14')
    expect(v([o('('), n(2, 0), o('+'), n(3, 1), o(')'), o('×'), n(4, 2)])).toBe('20')
    expect(v([n(3, 0), o('÷'), n(4, 1)])).toBe('3/4')
    expect(v([n(3, 0), o('−'), n(7, 1)])).toBe('−4')
    expect(v([n(8, 0), o('÷'), o('('), n(2, 1), o('−'), n(2, 2), o(')')])).toBeNull()
    expect(v([n(8, 0), o('+')])).toBeNull()
    expect(v([o('('), n(8, 0), o('+'), n(1, 1)])).toBeNull()
  })

  it('every band and seed: the tiles the band says, a witness that makes the target exactly, the operators its rules allow', () => {
    for (let b = 1; b <= MAKE_NUMBER_MAX_LEVEL; b++) {
      const row = makeNumberBand(b)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s = make(makeNumber, b, seed) as MakeNumberState
        const v = makeNumber.view(s) as MakeNumberView
        const at = `L${b} seed ${seed}`
        expect(s.tiles, at).toHaveLength(row.tiles)
        const w = evaluate(s.witness)
        expect(w && w.d === 1 && w.n, at).toBe(s.target)
        expect(Number.isInteger(s.target) && s.target >= 1, at).toBe(true)
        // The witness uses every tile exactly once.
        expect(s.witness.flatMap((t) => (t.kind === 'num' ? [t.tile] : [])).sort(), at).toEqual(s.tiles.map((_, i) => i))
        if (row.target24) expect(s.target, at).toBe(24)
        expect(v.ops.map((x) => x.op).includes('×'), at).toBe(row.times)
        expect(v.ops.map((x) => x.op).includes('÷'), at).toBe(row.divide)
        expect(v.ops.map((x) => x.op).includes('²'), at).toBe(row.square)
        expect(v.ops.map((x) => x.op).includes('('), at).toBe(row.brackets)
        if (row.need === '×') expect(s.witness.some((t) => t.kind === 'op' && t.op === '×'), at).toBe(true)
        if (row.need === '÷') expect(s.witness.some((t) => t.kind === 'op' && t.op === '÷'), at).toBe(true)
        if (row.need === '()') expect(s.witness.some((t) => t.kind === 'op' && t.op === '('), at).toBe(true)
        const indices = [...v.tiles.map((t) => t.index), ...v.ops.map((x) => x.index), v.undo.index, v.clear.index, v.submit.index]
        expect(new Set(indices).size, `${at}: indices collide`).toBe(indices.length)
        expect([v.reveal, v.locked, v.expression], at).toEqual([undefined, false, s.order === 'fixed' ? [{ kind: 'num', value: s.tiles[0], tile: 0 }] : []])
        expect(makeNumber.timeLimitMs(s), at).toBe(makeNumberLimitMs(b, row.parMs))
      }
    }
  })

  it('buttons follow the expression; a wrong submit costs a try and shows what it made; out of tries shows one way', () => {
    let s = make(makeNumber, 1, 4) as MakeNumberState
    const v0 = makeNumber.view(s) as MakeNumberView
    // Fixed order places each number automatically: the player chooses only signs.
    expect(v0.tiles.every((x) => x.disabled)).toBe(true)
    expect(v0.ops.every((x) => !x.disabled)).toBe(true)
    expect(v0.submit.disabled).toBe(true)
    const wrongOp = s.target === s.tiles.reduce((a, b) => a + b, 0) ? '−' : '+'
    const plusIndex = v0.ops.find((x) => x.op === wrongOp)!.index
    for (let i = 1; i < s.tiles.length; i++) s = makeNumber.tap(s, plusIndex)
    const ready = makeNumber.view(s) as MakeNumberView
    expect(ready.submit.disabled).toBe(false)
    expect(ready.preview).toBeDefined()
    // Choose the other sign on the two-number starter, so this is a real wrong answer.
    expect(Number(ready.preview)).not.toBe(s.target)
    const once = makeNumber.tap(s, ready.submit.index)
    const v2 = makeNumber.view(once) as MakeNumberView
    expect(v2.tries).toEqual({ left: 2, total: 3 })
    expect(v2.lastValue).toBe(ready.preview)
    expect(v2.expression).toEqual(ready.expression)
    let out = once
    while (!makeNumber.outcome(out)) out = makeNumber.tap(out, ready.submit.index)
    expect(makeNumber.outcome(out)).toEqual({ correct: false, accuracy: 0, mistakes: 3 })
    const line = (makeNumber.view(out) as MakeNumberView).reveal!.lines[0]
    expect(line.endsWith(` = ${s.target}`)).toBe(true)
  })

  it('a new operator starts small again (2-3 tiles) with a card; a blocked one is swapped out of the band', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13].map((b) => MAKE_NUMBER_LADDER[b - 1].tiles)).toEqual([2, 4, 2, 3, 2, 4, 2, 3, 4, 3, 4, 3])
    for (let seed = 1; seed <= 20; seed++) {
      const s = make(makeNumber, 14.5, seed, { ...PHONE, blockRules: ['makeNumber.brackets'] }) as MakeNumberState
      expect(s.ops).not.toContain('(')
      expect(s.witness.some((t) => t.kind === 'op' && t.op === '(')).toBe(false)
      expect(makeNumber.mechanics(s)).not.toContain('makeNumber.brackets')
    }
  })

  it('the top asks for a fraction on the way, four tiles, a tight clock and two tries', () => {
    const top = MAKE_NUMBER_LADDER[MAKE_NUMBER_MAX_LEVEL - 1]
    expect([top.tiles, top.fraction, top.parMs, top.tries, top.preview]).toEqual([4, true, 50_000, 2, false])
    let fractions = 0
    for (let seed = 1; seed <= 20; seed++) if (makeNumber.mechanics(make(makeNumber, 21, seed)).includes('makeNumber.fraction')) fractions++
    expect(fractions).toBeGreaterThanOrEqual(18)
  })
})

describe('Maze Run (미로 찾기)', () => {
  const side = [MAZE_WALL.top, MAZE_WALL.right, MAZE_WALL.bottom, MAZE_WALL.left]
  const step = [[0, -1], [1, 0], [0, 1], [-1, 0]]
  const opposite = [MAZE_WALL.bottom, MAZE_WALL.left, MAZE_WALL.top, MAZE_WALL.right]

  /** Walls agree on both sides, the border is closed, and it is a perfect maze (one way between any two cells). */
  function checkMaze(walls: readonly number[], cols: number, rows: number, at: string) {
    let open = 0
    for (let i = 0; i < walls.length; i++) {
      const c = i % cols, r = Math.floor(i / cols)
      for (let k = 0; k < 4; k++) {
        const nc = c + step[k][0], nr = r + step[k][1]
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) {
          expect(walls[i] & side[k], `${at}: border open at ${i}`).toBeTruthy()
          continue
        }
        const j = nr * cols + nc
        expect(Boolean(walls[i] & side[k]), `${at}: wall ${i}/${j} disagrees`).toBe(Boolean(walls[j] & opposite[k]))
        if (!(walls[i] & side[k]) && j > i) open++
      }
    }
    expect(open, `${at}: not a perfect maze`).toBe(cols * rows - 1)
  }

  it('cells never under 44dp (56dp in a hidden maze): a big maze is capped on a small screen, never drawn smaller', () => {
    for (const width of [320, 358, 390, 430]) {
      const ctx = { ...DEFAULT_CONTEXT, maxCols: maxColsFor(width - 32), maxRows: maxRowsFor(600) }
      const fit = mazeFit(ctx)
      expect(fit.cols * MAZE_MIN_CELL, `${width}`).toBeLessThanOrEqual(width - 32 + 8)
      for (let b = 1; b <= MAZE_MAX_LEVEL; b++) {
        const v = mazeRun.view(make(mazeRun, b, 1, ctx)) as MazeView
        const room = v.hidden ? mazeFit(ctx, MAZE_HIDDEN_MIN_CELL) : fit
        expect(v.cols, `${width} L${b}`).toBeLessThanOrEqual(room.cols)
        expect(v.rows, `${width} L${b}`).toBeLessThanOrEqual(room.rows)
      }
    }
    // A desktop holds every band's maze at full size (games/maze-run.ts: open mazes grow to 8×8 and
    // winding ones to 10×10, which a phone caps at 7 columns; hidden mazes stay within 5×7).
    for (let b = 1; b <= MAZE_MAX_LEVEL; b++) {
      const v = mazeRun.view(make(mazeRun, b, 1, SCREENS[0])) as MazeView
      expect([Math.min(v.cols, v.rows), Math.max(v.cols, v.rows)], `L${b}`).toEqual([Math.min(MAZE_LADDER[b - 1].cols, MAZE_LADDER[b - 1].rows), Math.max(MAZE_LADDER[b - 1].cols, MAZE_LADDER[b - 1].rows)])
    }
    // The cell the platform can draw (the smallest board those columns and rows mean, no gaps): at
    // least 44dp, and the 56dp game-cell bar (EVIDENCE §5) wherever a slip costs (hidden walls).
    const cell = (ctx: CreateContext, v: MazeView) => Math.min((ctx.maxCols * 64 - 8) / v.cols, (ctx.maxRows * 64 - 8) / v.rows)
    for (const ctx of SCREENS) {
      for (let b = 1; b <= MAZE_MAX_LEVEL; b++) {
        const v = mazeRun.view(make(mazeRun, b, 1, ctx)) as MazeView
        expect(cell(ctx, v), `${ctx.maxCols}x${ctx.maxRows} L${b}`).toBeGreaterThanOrEqual(v.hidden ? MAZE_HIDDEN_MIN_CELL : MAZE_MIN_CELL)
      }
    }
  })

  it('every band, screen and seed: a perfect maze, start and goal apart, keys on distinct cells, the right phase', () => {
    for (const ctx of SCREENS) {
      for (let b = 1; b <= MAZE_MAX_LEVEL; b++) {
        const row = mazeBand(b)
        for (let seed = 1; seed <= SEEDS; seed++) {
          const s = make(mazeRun, b, seed, ctx) as MazeState
          const v = mazeRun.view(s) as MazeView
          const at = `L${b} ${ctx.maxCols}x${ctx.maxRows} seed ${seed}`
          checkMaze(s.walls, s.cols, s.rows, at)
          expect(v.start, at).not.toBe(v.goal)
          const cells = v.keys.map((k) => k.cell)
          expect(new Set([...cells, v.start, v.goal]).size, at).toBe(cells.length + 2)
          expect(v.keys.map((k) => k.order), at).toEqual(range(cells.length))
          expect(cells.length, at).toBe(row.keys)
          expect(v.path, at).toEqual([v.start])
          expect(v.hidden, at).toBe(row.hidden)
          if (row.hidden) {
            expect([v.phase, v.locked, v.showBar?.ms], at).toEqual(['preview', true, row.previewMs])
            expect(v.walls, `${at}: the walls show in the preview`).toEqual(s.walls)
            const play = mazeRun.view(mazeRun.advance(s)) as MazeView
            expect(play.phase, at).toBe('play')
            // Hidden: only the border is drawn.
            expect(play.walls.every((w, i) => (w & s.walls[i]) === w), at).toBe(true)
            expect(play.walls.filter((w, i) => w !== s.walls[i]).length, `${at}: nothing hidden`).toBeGreaterThan(0)
            expect(play.budget, at).toEqual({ left: row.bumps, total: row.bumps })
          } else {
            expect([v.phase, v.locked, v.budget], at).toEqual(['play', false, undefined])
          }
          expect(mazeRun.timeLimitMs(s), at).toBeGreaterThan(0)
        }
      }
    }
  })

  /** A maze with a key (a visible one) and its cells, for the move rules. */
  function visibleWithKey(): MazeState {
    for (let seed = 1; seed < 100; seed++) {
      const s = make(mazeRun, 11, seed) as MazeState
      if (s.keys.length === 1) return s
    }
    throw new Error('no maze with a key')
  }
  const neighboursOf = (s: MazeState, cell: number) => {
    const c = cell % s.cols, r = Math.floor(cell / s.cols)
    return [0, 1, 2, 3].flatMap((k) => {
      const nc = c + step[k][0], nr = r + step[k][1]
      if (nc < 0 || nc >= s.cols || nr < 0 || nr >= s.rows) return []
      return [{ cell: nr * s.cols + nc, open: !(s.walls[cell] & side[k]) }]
    })
  }

  it('moves: along open sides only, never through a wall or a jump; back onto the path erases it; keys in order before the goal', () => {
    const s0 = visibleWithKey()
    const around = neighboursOf(s0, s0.start)
    const walled = around.find((x) => !x.open)
    if (walled) expect(mazeRun.tap(s0, walled.cell)).toBe(s0)
    const far = range(s0.walls.length).map((i) => i - 1).find((i) => !around.some((x) => x.cell === i) && i !== s0.start)!
    expect(mazeRun.tap(s0, far)).toBe(s0)
    const first = around.find((x) => x.open)!
    const moved = mazeRun.tap(s0, first.cell)
    expect(moved.path).toEqual([s0.start, first.cell])
    expect(mazeRun.tap(moved, s0.start).path).toEqual([s0.start])
    // Straight to the goal, skipping the key: the goal stays shut.
    let s = s0
    const direct: number[] = []
    {
      // BFS from start to goal through open sides.
      const prev = new Map<number, number>([[s0.start, -1]])
      const q = [s0.start]
      while (q.length) {
        const cur = q.shift()!
        for (const x of neighboursOf(s0, cur)) if (x.open && !prev.has(x.cell)) { prev.set(x.cell, cur); q.push(x.cell) }
      }
      for (let at = s0.goal; at !== s0.start; at = prev.get(at)!) direct.unshift(at)
    }
    for (const cell of direct) s = mazeRun.tap(s, cell)
    if (!direct.includes(s0.keys[0])) {
      expect(mazeRun.outcome(s)).toBeNull()
      expect((mazeRun.view(s) as MazeView).goalOpen).toBe(false)
    }
    // Following the solution takes the key, then the goal.
    let won = s0
    for (const cell of mazeRun.solution(s0)!) won = mazeRun.tap(won, cell)
    expect(mazeRun.outcome(won)).toEqual({ correct: true, accuracy: 1 })
    expect((mazeRun.view(won) as MazeView).keys[0].taken).toBe(true)
  })

  it('a hidden maze: a bump is a mistake from the maze\'s own budget (dots, not lives) and shows that wall; one past the budget is a miss that shows the way', () => {
    let s0: MazeState | null = null
    // L18: 5×5, walls hidden after 6 s, two bumps forgiven.
    for (let seed = 1; seed < 100 && !s0; seed++) {
      const s = mazeRun.advance(make(mazeRun, 18, seed, { ...PHONE, livesLeft: 1 }) as MazeState)
      if (neighboursOf(s, s.start).some((x) => !x.open)) s0 = s
    }
    let s = s0!
    const wall = neighboursOf(s, s.start).find((x) => !x.open)!
    const exit = neighboursOf(s, s.start).find((x) => x.open)!
    s = mazeRun.tap(s, wall.cell)
    const v = mazeRun.view(s) as MazeView
    expect(v.bump?.cell).toBe(s.start)
    expect(v.budget).toEqual({ left: 1, total: 2 })
    expect(v.path).toEqual([s.start])
    expect(mazeRun.outcome(s)).toBeNull()
    // The same wall again before moving is free; after a step away and back it counts.
    expect(mazeRun.tap(s, wall.cell)).toBe(s)
    for (let i = 0; i < 2; i++) s = mazeRun.tap(mazeRun.tap(mazeRun.tap(s, exit.cell), s.start), wall.cell)
    const out = mazeRun.outcome(s)!
    expect(out).toMatchObject({ correct: false, mistakes: 3 })
    expect(out.livesSpent).toBeUndefined()
    expect(out.accuracy).toBeLessThan(0.8 + 1e-9)
    const done = mazeRun.view(s) as MazeView
    expect(done.phase).toBe('done')
    expect(done.answer!.path[0]).toBe(s.start)
    expect(done.answer!.path[done.answer!.path.length - 1]).toBe(s.goal)
    expect(done.walls).toEqual(s.walls)
  })

  it('a blocked rule plays the band without it: no keys, no hidden walls', () => {
    const k = make(mazeRun, 13, 1, { ...PHONE, blockRules: ['mazeRun.keys'] }) as MazeState
    expect(k.keys).toEqual([])
    expect(mazeRun.mechanics(k)).not.toContain('mazeRun.keys')
    const h = make(mazeRun, 17, 1, { ...PHONE, blockRules: ['mazeRun.hidden'] }) as MazeState
    expect([h.hidden, h.phase]).toEqual([false, 'play'])
    expect(mazeRun.mechanics(h)).not.toContain('mazeRun.hidden')
  })
})

describe('variety: no two trials alike in a round', () => {
  it('twenty seeds of every band give at least twelve different puzzles (fewer only where the band has fewer: Code Break L1 has 12 codes, L2 20)', () => {
    const games = { setMatch, codeBreak, makeNumber, mazeRun } as const
    const tops = { setMatch: SET_MATCH_MAX_LEVEL, codeBreak: CODE_BREAK_MAX_LEVEL, makeNumber: MAKE_NUMBER_MAX_LEVEL, mazeRun: MAZE_MAX_LEVEL }
    for (const id of NEW) {
      const def = games[id as keyof typeof games] as { create(l: number, r: ReturnType<typeof createRng>, c: CreateContext): unknown; signature(s: unknown): string }
      for (let b = 1; b <= tops[id as keyof typeof tops]; b++) {
        const sigs = new Set(range(20).map((seed) => def.signature(make(def, b, seed))))
        const row = id === 'codeBreak' ? CODE_BREAK_LADDER[b - 1] : null
        const space = row ? (row.repeats ? row.pool.length ** row.length : range(row.length).reduce((a, i) => a * (row.pool.length - i + 1), 1)) : Infinity
        // Twenty draws from `space` codes give space·(1 − (1 − 1/space)^20) different ones on average.
        const expected = space === Infinity ? 20 : space * (1 - (1 - 1 / space) ** 20)
        expect(sigs.size, `${id} L${b}`).toBeGreaterThanOrEqual(Math.min(12, Math.floor(expected * 0.7)))
      }
    }
  })
})

describe('placement: a capable adult meets real challenge within about four trials; a slow player is not pushed up', () => {
  /** A simulated first play: ZEST placement as useBrainRound runs it, the player answering with pCorrect at level θ. */
  function place(id: BrainGameId, theta: number, seed: number): { levels: number[]; handover: number } {
    const plan = zestPlan(id)
    const rng = createRng(seed)
    let p = startPlacement({ lo: 1, hi: plan.hi, mu0: 3, sigma0: 9, target: 0.85, slope: 2, maxMove: 3, minTrials: plan.minTrials, maxTrials: plan.maxTrials, tailMass: plan.tailMass, hotMove: plan.hotMove, hotAfter: plan.hotAfter })
    const levels: number[] = []
    while (!placementDone(p)) {
      // Nothing known: the first trial is never above practice level + 2.
      const x = levels.length === 0 ? Math.min(3, placementLevel(p)) : placementLevel(p)
      levels.push(x)
      p = updatePlacement(p, x, rng.next() < pCorrect(x, theta, 0.02, p), 0.02)
    }
    return { levels, handover: placementHandover(p, plan.handoverK).level }
  }

  it('each has its own short plan (a trial is a whole puzzle): Code Break three or four codes, the others five to ten', () => {
    expect(NEW.map((id) => [id, zestPlan(id).hi, zestPlan(id).minTrials, zestPlan(id).maxTrials])).toEqual([
      ['setMatch', 24, 6, 10],
      ['codeBreak', 21, 3, 4],
      ['makeNumber', 21, 5, 8],
      ['mazeRun', 24, 5, 8],
    ])
  })

  it('a sharp adult (θ 14) plays a trial within three levels of their own by the fourth, in at least four runs of five', () => {
    for (const id of NEW) {
      const runs = range(100).map((seed) => place(id, 14, seed * 31))
      const reached = runs.filter((r) => r.levels.slice(0, 4).some((x) => x >= 11)).length
      expect(reached, id).toBeGreaterThanOrEqual(80)
    }
  })

  it('a slow first-timer (θ 3) starts on easy content and is handed over near their level', () => {
    for (const id of NEW) {
      const runs = range(100).map((seed) => place(id, 3, seed * 17))
      for (const r of runs) expect(r.levels[0], id).toBeLessThanOrEqual(3)
      const mean = runs.reduce((a, r) => a + r.handover, 0) / runs.length
      expect(mean, id).toBeLessThan(5)
    }
  })
})
