/**
 * Match Pairs' content ladder (GAMES_DIFFICULTY_PLAN §3.8). Read off the boards themselves: the
 * level table (cards, set size, picture family, preview, mistake budget), that every level builds on
 * three-, four- and five-column screens, that the preview is only a hint, the informed-miss rule on
 * pairs and triples, the tap that cuts a mismatch short — and that it stays hard: a player who keeps
 * half of what they see fails at least 30% of boards from L6. Past L18 the boards grow (owner
 * 2026-11-13 «카드 갯수 더 늘리기»): 30 cards to L21 on five columns, 36 and 42 on a 6×6 / 7×6 screen.
 */
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_CONTEXT, MECHANICS, TIERS, createRng, maxColsFor, type CreateContext, type GridView, type RecentTrial, type Rng } from '@reeeeecall/shared/lib/brain-games'
import {
  PAIRS_FAMILIES,
  PAIRS_FAMILY_CLASS,
  PAIRS_LADDER,
  PAIRS_MISMATCH_MS,
  PAIRS_PREVIEW_MS,
  pairs,
  pairsBoard,
  pairsLimitMs,
  pairsMaxLevel,
  type PairsFamilyName,
  type PairsState,
} from '@reeeeecall/shared/lib/brain-games/games/pairs'

// Thousands of sampled trials per test: a second or three here, several times that on a CI runner,
// where the 5s default would time out.
vi.setConfig({ testTimeout: 30_000 })

const DESKTOP: CreateContext = DEFAULT_CONTEXT
/** A laptop window: seven columns but only five rows of 56px cells. */
const LAPTOP: CreateContext = { ...DEFAULT_CONTEXT, maxRows: 5 }
const PHONE: CreateContext = { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 }
const SHORT_PHONE: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 5, maxRows: 4 }
const FOUR: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 7 }
const SMALL: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 6 }
const NARROW: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 3, maxRows: 5 }
const SCREENS = { DESKTOP, LAPTOP, PHONE, SHORT_PHONE, FOUR, SMALL, NARROW }

const view = (s: PairsState) => pairs.view(s) as GridView
const make = (level: number, seed: number, ctx: CreateContext = DESKTOP) => pairs.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx)
const settle = (s: PairsState) => {
  while (pairs.pendingMs(s) !== null && !pairs.acceptsInput(s)) s = pairs.advance(s)
  return s
}
const familyOf = (face: string) => (Object.keys(PAIRS_FAMILIES) as PairsFamilyName[]).find((n) => (PAIRS_FAMILIES[n] as readonly string[]).includes(face))
/** Positions of one face, and of a face different from it. */
const where = (s: PairsState, face: string) => s.cards.flatMap((c, j) => (c === face ? [j] : []))
const other = (s: PairsState, face: string) => s.cards.find((c) => c !== face) as string

function playBySolution(s: PairsState): PairsState {
  for (let guard = 0; guard < 500 && !pairs.outcome(s); guard++) {
    if (pairs.pendingMs(s) !== null && !pairs.acceptsInput(s)) {
      s = pairs.advance(s)
      continue
    }
    s = pairs.tap(s, pairs.solution(s)![0])
  }
  return s
}

describe('Match Pairs: the level table', () => {
  it('is the plan\'s table, and every whole level changes the cards, set size, family, preview or budget', () => {
    const shape = PAIRS_LADDER.map((r, i) => `L${i + 1} ${r.size === 3 ? 'T' : 'P'}${r.sets} ${r.cols}x${r.rows} ${r.family} ${r.preview ? 'peek' : '-'} b${r.budget}`)
    expect(shape).toEqual([
      'L1 P3 3x2 mixed peek b2',
      'L2 P4 4x2 mixed peek b2',
      'L3 P4 4x2 mixed - b2',
      'L4 P6 4x3 mixed - b3',
      'L5 P6 4x3 distinct - b3',
      'L6 P8 4x4 mixed - b3',
      'L7 P8 4x4 distinct - b3',
      'L8 P8 4x4 lookalike - b3',
      'L9 P10 4x5 distinct - b4',
      'L10 P10 4x5 lookalike - b4',
      'L11 P12 4x6 distinct - b4',
      'L12 P12 4x6 lookalike - b4',
      'L13 P12 4x6 lookalike - b3',
      'L14 T6 3x6 distinct - b4',
      'L15 T8 4x6 distinct - b4',
      'L16 T8 4x6 lookalike - b4',
      'L17 T10 5x6 distinct - b4',
      'L18 T10 5x6 lookalike - b4',
      // The higher ceiling: 15 pairs, triples with one mistake fewer, 18 pairs, 12 triples, 21, 14.
      'L19 P15 5x6 distinct - b5',
      'L20 P15 5x6 lookalike - b5',
      'L21 T10 5x6 lookalike - b3',
      'L22 P18 6x6 distinct - b5',
      'L23 P18 6x6 lookalike - b5',
      'L24 T12 6x6 lookalike - b4',
      'L25 P21 7x6 lookalike - b5',
      'L26 T14 7x6 lookalike - b4',
    ])
    for (const r of PAIRS_LADDER) expect(r.cols * r.rows).toBe(r.sets * r.size)
    // Each level differs from the one below in something the player meets. L13 is L12 with one
    // mistake fewer allowed — the plan's own row, so the budget counts as a difference (L21 too).
    for (let lv = 2; lv <= 26; lv++) {
      const a = pairsBoard(lv - 1, DESKTOP)
      const b = pairsBoard(lv, DESKTOP)
      const key = (x: typeof a) => `${x.sets}:${x.size}:${x.family}:${x.preview}:${x.budget}`
      expect(key(b), `L${lv}`).not.toBe(key(a))
    }
  })

  it('looks the table up with floor(level): 2.99 is the L2 board, 3 is the first without a preview', () => {
    const at = (level: number) => {
      const s = make(level, 3)
      return { sets: s.cards.length / s.size, preview: s.previewMs, budget: s.budget, family: s.family, size: s.size }
    }
    expect(at(2.99)).toEqual(at(2))
    expect(at(2)).toMatchObject({ sets: 4, preview: PAIRS_PREVIEW_MS })
    expect(at(3)).toMatchObject({ sets: 4, preview: 0 })
    expect(at(13.99)).toMatchObject({ size: 2, sets: 12, budget: 3 })
    expect(at(14)).toMatchObject({ size: 3, sets: 6 })
    // The level keeps its value (the staircase reads it back); only the board is the floor's.
    expect(make(7.3, 1).level).toBe(7.3)
  })

  it('every level up to the cap builds on 3-, 4- and 5-column screens, and solution() clears it', () => {
    for (const [name, ctx] of Object.entries(SCREENS)) {
      const cap = pairsMaxLevel(ctx)
      // Five columns: L21 (30 cards); a screen that holds 6×6 or 7×6 as it is (or turned): L24, L26.
      expect(cap, name).toBe({ DESKTOP: 26, LAPTOP: 21, PHONE: 21, SHORT_PHONE: 21, FOUR: 16, SMALL: 16, NARROW: 16 }[name])
      for (let lv = 1; lv <= cap; lv++) {
        const rung = PAIRS_LADDER[lv - 1]
        for (let seed = 1; seed <= 8; seed++) {
          const s = make(lv, seed, ctx)
          const at = `${name} L${lv} seed ${seed}`
          const v = view(s)
          expect(v.cells.length, at).toBe(v.cols * v.rows)
          expect(v.cols, at).toBeLessThanOrEqual(ctx.maxCols)
          // Every face exactly `size` times.
          const counts = new Map<string, number>()
          for (const c of s.cards) counts.set(c, (counts.get(c) ?? 0) + 1)
          expect([...counts.values()].every((n) => n === s.size), at).toBe(true)
          expect(s.size, at).toBe(rung.size)
          // Four columns or more: exactly the table's cards. Three columns: the nearest board three wide, never fewer.
          if (ctx.maxCols >= 4) expect(s.cards.length, at).toBe(rung.sets * rung.size)
          else expect(s.cards.length, at).toBeGreaterThanOrEqual(rung.sets * rung.size)
          const won = playBySolution(s)
          expect(pairs.outcome(won), at).toMatchObject({ correct: true, informedMisses: 0 })
        }
      }
      // Past the cap the board is the cap's.
      expect(make(cap + 25, 2, ctx).cards.length, name).toBe(make(cap, 2, ctx).cards.length)
    }
  })

  it('takes the table\'s shape, turned on its side where that is what fits; three columns go three wide', () => {
    const dims = (level: number, ctx: CreateContext) => {
      const v = view(make(level, 1, ctx))
      return `${v.cols}x${v.rows}`
    }
    expect([2, 4, 6, 9, 11, 14, 15, 17, 19, 22, 25].map((l) => dims(l, DESKTOP))).toEqual(['4x2', '4x3', '4x4', '4x5', '4x6', '3x6', '4x6', '5x6', '5x6', '6x6', '7x6'])
    // A 6×7 screen holds 6×6 and takes 7×6 turned (6 wide, 7 tall); a 6×6 one stops at L24.
    expect(dims(25, { ...DEFAULT_CONTEXT, maxCols: 6, maxRows: 7 })).toBe('6x7')
    expect(pairsMaxLevel({ ...DEFAULT_CONTEXT, maxCols: 6, maxRows: 7 })).toBe(26)
    expect(pairsMaxLevel({ ...DEFAULT_CONTEXT, maxCols: 6, maxRows: 6 })).toBe(24)
    // A laptop window with five rows of cells: the tall boards lie down.
    expect([9, 11, 14, 15, 17].map((l) => dims(l, LAPTOP))).toEqual(['4x5', '6x4', '6x3', '6x4', '6x5'])
    // Five columns, four rows: nothing turned fits five wide, so the board keeps its shape.
    expect(dims(11, SHORT_PHONE)).toBe('4x6')
    expect(dims(9, SHORT_PHONE)).toBe('5x4')
    // Three columns: 4 pairs as 2×4, then 3×4, 3×6 (9 pairs for 8), 3×8 (12 pairs for 10).
    expect([2, 4, 6, 9, 11, 14, 15].map((l) => dims(l, NARROW))).toEqual(['2x4', '3x4', '3x6', '3x8', '3x8', '3x6', '3x8'])
  })

  it('keeps every tier below the cap on four- and five-column screens', () => {
    expect(TIERS.pairs[5]).toBeLessThan(pairsMaxLevel(FOUR))
    expect(TIERS.pairs[5]).toBeLessThan(pairsMaxLevel(PHONE))
    expect(pairs.maxLevel!(FOUR)).toBe(16)
    expect(pairs.maxLevel!(PHONE)).toBe(21)
    expect(pairs.maxLevel!(DESKTOP)).toBe(26)
  })

  it('the clock is 6000 + 6000 per pair, or 6000 + 9000 per set of three', () => {
    for (let lv = 1; lv <= 26; lv++) {
      const s = make(lv, 5)
      const sets = s.cards.length / s.size
      expect(pairs.timeLimitMs(s), `L${lv}`).toBe(6000 + (s.size === 3 ? 9000 : 6000) * sets)
    }
    expect(pairsLimitMs(2, 3)).toBe(24_000)
    expect(pairsLimitMs(3, 10)).toBe(96_000)
  })
})

describe('Match Pairs: preview, blocked rules and tags', () => {
  it('the preview is a hint: two seconds at L1-2 with a countdown bar, and it never marks a card as seen', () => {
    for (const lv of [1, 2, 2.5]) {
      for (let seed = 1; seed <= 20; seed++) {
        const s = make(lv, seed)
        expect(s.phase).toBe('preview')
        expect(pairs.pendingMs(s)).toBe(PAIRS_PREVIEW_MS)
        expect(s.seen.some(Boolean)).toBe(false)
        const v = view(s)
        expect(v.locked).toBe(true)
        expect(v.showBar).toEqual({ ms: PAIRS_PREVIEW_MS })
        expect(v.cells.every((c) => c.tone === 'faceUp' && c.label)).toBe(true)
        const after = pairs.advance(s)
        expect(after.phase).toBe('play')
        expect(after.seen.some(Boolean)).toBe(false)
        expect(view(after).showBar).toBeUndefined()
        expect(view(after).cells.every((c) => c.tone === 'faceDown')).toBe(true)
      }
    }
    for (let lv = 3; lv <= 26; lv++) expect(make(lv, 1).previewMs, `L${lv}`).toBe(0)
  })

  it('a blocked no-preview rule keeps the preview; blocked triples become pairs with as many cards and the same clock', () => {
    const noPeek = make(6, 1, { ...DESKTOP, blockRules: ['pairs.noPreview'] })
    expect(noPeek.previewMs).toBe(PAIRS_PREVIEW_MS)
    expect(pairs.mechanics(noPeek)).not.toContain('pairs.noPreview')
    expect(settle(noPeek).seen.some(Boolean)).toBe(false)
    for (const lv of [14, 15, 16, 17, 18, 21, 24, 26]) {
      const triples = make(lv, 2)
      const blocked = make(lv, 2, { ...DESKTOP, blockRules: ['pairs.triples'] })
      expect(blocked.size, `L${lv}`).toBe(2)
      expect(blocked.cards.length, `L${lv}`).toBe(triples.cards.length)
      expect(pairs.timeLimitMs(blocked), `L${lv}`).toBe(pairs.timeLimitMs(triples))
      expect(blocked.family).toBe(triples.family)
      expect(pairs.mechanics(blocked)).not.toContain('pairs.triples')
      expect(view(blocked).progress).toBeUndefined()
      expect(pairs.outcome(playBySolution(blocked))?.correct).toBe(true)
    }
  })

  it('reports the board changes and rules it shows, each from its level', () => {
    const tags = (lv: number) => pairs.mechanics(make(lv, 1))
    expect(tags(1)).toEqual([])
    expect(tags(2)).toEqual(['pairs.board4'])
    expect(tags(3)).toEqual(['pairs.board4', 'pairs.noPreview'])
    expect(tags(5)).toContain('pairs.oneFamily')
    expect(tags(6)).not.toContain('pairs.oneFamily')
    expect(tags(8)).toEqual(expect.arrayContaining(['pairs.board8', 'pairs.oneFamily', 'pairs.lookalike']))
    expect(tags(7)).not.toContain('pairs.lookalike')
    expect(tags(9)).toContain('pairs.board10')
    expect(tags(11)).toContain('pairs.board12')
    expect(tags(13.9)).not.toContain('pairs.triples')
    expect(tags(14)).toContain('pairs.triples')
    // The bigger boards, each from its level on a screen that holds it (30 cards from L17's triples).
    expect(tags(16)).not.toContain('pairs.board15')
    expect(tags(17)).toContain('pairs.board15')
    expect(tags(21)).not.toContain('pairs.board18')
    expect(tags(22)).toContain('pairs.board18')
    expect(tags(24)).not.toContain('pairs.board21')
    expect(tags(25)).toContain('pairs.board21')
    const from = Object.fromEntries(MECHANICS.filter((m) => m.game === 'pairs').map((m) => [m.tag, m.from]))
    expect([from['pairs.board15'], from['pairs.board18'], from['pairs.board21']]).toEqual([17, 22, 25])
  })
})

describe('Match Pairs: pictures', () => {
  it('distinct and look-alike boards draw one family of their class; mixed boards mix the distinct ones', () => {
    for (let lv = 1; lv <= 26; lv++) {
      const rung = PAIRS_LADDER[lv - 1]
      const ctx = lv <= pairsMaxLevel(PHONE) ? PHONE : DESKTOP
      let multi = 0
      for (let seed = 1; seed <= 40; seed++) {
        const s = make(lv, seed, ctx)
        const fams = new Set(s.cards.map(familyOf))
        expect(fams.has(undefined), `L${lv}: a face from no family`).toBe(false)
        const classes = new Set([...fams].map((f) => PAIRS_FAMILY_CLASS[f as PairsFamilyName]))
        if (rung.family === 'mixed') {
          expect([...classes], `L${lv}`).toEqual(['distinct'])
          if (fams.size > 1) multi++
        } else {
          expect(fams.size, `L${lv}`).toBe(1)
          expect([...classes], `L${lv}`).toEqual([rung.family])
          expect(s.familyName).toBe([...fams][0])
        }
        // The look-alike badge on look-alike boards only.
        expect(view(s).badge, `L${lv}`).toEqual(rung.family === 'lookalike' ? { key: 'play.lookalikeBadge' } : undefined)
      }
      if (rung.family === 'mixed' && rung.sets >= 4) expect(multi, `L${lv}: mixed boards mostly mix`).toBeGreaterThanOrEqual(36)
    }
  })

  it('never the same family on two boards running, while the class has another', () => {
    for (const lv of [5, 7, 8, 9, 12, 14, 18]) {
      const rng = createRng(lv)
      let recent: RecentTrial[] = []
      let last = ''
      for (let i = 0; i < 60; i++) {
        const s = pairs.create(lv, rng, { ...DESKTOP, recent })
        expect(s.familyName, `L${lv} board ${i}`).not.toBe(last)
        last = s.familyName
        const info = pairs.trialInfo!(s)
        recent = [...recent, { level: lv, ...info }].slice(-2)
      }
    }
  })

  it('single code points from Unicode 11 or earlier, no faces, and enough of each for the biggest board', () => {
    // Code points ≤ Unicode 11: Misc Symbols, Misc Symbols & Pictographs, Transport up to 🛹 (Unicode 11),
    // and the Supplemental block's ranges that were complete by Unicode 11.
    const allowed: [number, number][] = [
      [0x2600, 0x26ff],
      [0x1f300, 0x1f5ff],
      [0x1f680, 0x1f6d4],
      [0x1f6e0, 0x1f6ec],
      [0x1f6f0, 0x1f6f9],
      [0x1f910, 0x1f93e],
      [0x1f940, 0x1f970],
      [0x1f973, 0x1f976],
      [0x1f97a, 0x1f97a],
      [0x1f97c, 0x1f9a2],
      [0x1f9b0, 0x1f9b9],
      [0x1f9c0, 0x1f9c2],
      [0x1f9d0, 0x1f9ff],
    ]
    // Faces: smileys and people's faces (animal faces are pictures of animals).
    const faces: [number, number][] = [
      [0x1f600, 0x1f64f],
      [0x1f910, 0x1f92f],
      [0x1f970, 0x1f97a],
      [0x1f9d0, 0x1f9d0],
      [0x263a, 0x263a],
      [0x2639, 0x2639],
      [0x1f479, 0x1f47d],
      [0x1f480, 0x1f480],
      [0x1f4a9, 0x1f4a9],
    ]
    const inside = (cp: number, ranges: [number, number][]) => ranges.some(([a, b]) => cp >= a && cp <= b)
    const all = Object.values(PAIRS_FAMILIES).flat() as string[]
    expect(new Set(all).size, 'a face in two families').toBe(all.length)
    for (const face of all) {
      const cps = [...face].map((c) => c.codePointAt(0)!)
      expect(cps, face).toHaveLength(1)
      expect(inside(cps[0], allowed), `${face} U+${cps[0].toString(16)} newer than Unicode 11`).toBe(true)
      expect(inside(cps[0], faces), `${face} is a face`).toBe(false)
    }
    expect(all).not.toContain('🫐')
    expect(all).not.toContain('🛻')
    // The biggest boards: 21 pairs (L25, and blocked triples at L26), 12 pairs on three columns.
    for (const list of Object.values(PAIRS_FAMILIES)) expect(list.length).toBeGreaterThanOrEqual(21)
  })
})

describe('Match Pairs: the informed-miss rule', () => {
  const board = (lv: number, seed = 4) => settle(make(lv, seed))

  it('pairs: two cards never seen are free; a seen card, or a passed-over partner, costs one', () => {
    let s = board(6)
    const a = 0
    const faceA = s.cards[a]
    const b = where(s, other(s, faceA))[0]
    s = pairs.tap(pairs.tap(s, a), b)
    expect(s).toMatchObject({ phase: 'mismatch', misses: 0, freeMiss: true })
    expect(view(s).chip).toEqual({ key: 'play.newCardFree' })
    expect(view(s).cells[a].tone).toBe('wrong')
    s = pairs.advance(s)
    expect(view(s).chip).toBeUndefined()
    // Card a is known now: turning it with a card it does not match costs one.
    const c = s.cards.findIndex((f, j) => !s.seen[j] && f !== faceA && f !== s.cards[b])
    expect(s.seen[c]).toBe(false)
    s = pairs.advance(pairs.tap(pairs.tap(s, c), a))
    expect(s.misses).toBe(1)
    // a's partner, never seen, opened first; a passed over for a fresh card: costs one (a was known).
    const partner = where(s, faceA).find((j) => j !== a)!
    const fresh = s.cards.findIndex((f, j) => !s.seen[j] && j !== partner && f !== faceA)
    s = pairs.tap(pairs.tap(s, partner), fresh)
    expect(s).toMatchObject({ misses: 2, freeMiss: false })
    expect(view(s).chip).toBeUndefined()
    expect(pairs.outcome(pairs.timeout(s))?.informedMisses).toBe(2)
  })

  it('triples: a wrong second card turns back; a third card never seen is free, a seen one or a passed-over third costs one', () => {
    // Free: two of a set, then a third card never seen.
    let s = board(14)
    const set = where(s, s.cards[0])
    const x = where(s, other(s, s.cards[0]))[0]
    s = pairs.tap(pairs.tap(s, set[0]), set[1])
    expect(s.phase).toBe('play')
    expect(view(s).progress).toEqual({ kind: 'set', open: 2, size: 3 })
    s = pairs.tap(s, x)
    expect(s).toMatchObject({ phase: 'mismatch', misses: 0, freeMiss: true })
    expect(view(s).progress).toEqual({ kind: 'set', open: 3, size: 3 })
    s = pairs.advance(s)
    expect(s.open).toEqual([])
    expect(view(s).progress).toEqual({ kind: 'set', open: 0, size: 3 })
    // Costs one: the third card was seen (x, just now).
    s = pairs.advance(pairs.tap(pairs.tap(pairs.tap(s, set[0]), set[1]), x))
    expect(s.misses).toBe(1)
    // Costs one: the set's third card had been seen and was passed over for a fresh one.
    let t = board(14, 9)
    const set2 = where(t, t.cards[0])
    const y = where(t, other(t, t.cards[0]))[0]
    t = pairs.advance(pairs.tap(pairs.tap(t, set2[2]), y)) // set2[2] seen (free: both new)
    expect(t.misses).toBe(0)
    const fresh = t.cards.findIndex((f, j) => !t.seen[j] && f !== t.cards[set2[0]])
    t = pairs.tap(pairs.tap(pairs.tap(t, set2[0]), set2[1]), fresh)
    expect(t).toMatchObject({ phase: 'mismatch', misses: 1 })
    // A wrong second card turns back too, and is free while nothing of the set was seen.
    let u = board(14, 11)
    const z = where(u, other(u, u.cards[0]))[0]
    u = pairs.tap(pairs.tap(u, 0), z)
    expect(u).toMatchObject({ phase: 'mismatch', misses: 0 })
    expect(pairs.advance(u).open).toEqual([])
  })

  it('the budget: that many mistakes still clear; one more fails once the mismatch has shown, with every card face up and calm', () => {
    let s = board(6, 2)
    const known = 0
    const faceK = s.cards[known]
    // Make card `known` seen, then miss against it budget + 1 times with fresh cards.
    const n0 = where(s, other(s, faceK))[0]
    s = pairs.advance(pairs.tap(pairs.tap(s, n0), known))
    expect(s.misses).toBe(0)
    for (let i = 1; i <= s.budget + 1; i++) {
      const fresh = s.cards.findIndex((f, j) => !s.seen[j] && f !== faceK)
      s = pairs.tap(pairs.tap(s, fresh), known)
      expect(s.misses).toBe(i)
      expect(view(s).budget).toEqual({ left: Math.max(0, s.budget - i), total: s.budget })
      expect(view(s).prompt.params?.lives).toBe(Math.max(0, s.budget - i))
      if (i <= s.budget) {
        expect(pairs.acceptsInput(s)).toBe(true)
        s = pairs.advance(s)
        expect(s.phase).toBe('play')
      }
    }
    // Over budget: the mismatch shows, takes no taps, then the board ends.
    expect(pairs.acceptsInput(s)).toBe(false)
    expect(view(s).locked).toBe(true)
    expect(pairs.tap(s, 5)).toBe(s)
    expect(pairs.solution(s)).toBeNull()
    expect(pairs.pendingMs(s)).toBe(PAIRS_MISMATCH_MS)
    s = pairs.advance(s)
    expect(pairs.outcome(s)).toMatchObject({ correct: false, informedMisses: s.budget + 1 })
    expect(view(s).cells.every((c) => c.tone === 'faceUp' || c.tone === 'matched')).toBe(true)
  })
})

describe('Match Pairs: tapping during a mismatch', () => {
  it('turns the pair back and opens the tapped card at once — the mismatch never counts twice', () => {
    let s = settle(make(8, 6))
    const a = 0
    const b = where(s, other(s, s.cards[a]))[0]
    s = pairs.advance(pairs.tap(pairs.tap(s, a), b)) // both seen now (free)
    const c = s.cards.findIndex((f, j) => !s.seen[j] && f !== s.cards[a])
    s = pairs.tap(pairs.tap(s, c), a) // informed: a was seen
    expect(s).toMatchObject({ phase: 'mismatch', misses: 1 })
    expect(view(s).locked).toBe(false)
    const d = s.cards.findIndex((f, j) => !s.seen[j] && f !== s.cards[a] && f !== s.cards[c])
    const cut = pairs.tap(s, d)
    expect(cut).toMatchObject({ phase: 'play', open: [d], misses: 1, freeMiss: false })
    // The mismatch's timer arriving afterwards changes nothing.
    expect(pairs.advance(cut)).toBe(cut)
    expect(pairs.pendingMs(cut)).toBeNull()
    // A matched card during a mismatch is ignored; one of the mismatched cards opens on its own.
    expect(pairs.tap(s, c).open).toEqual([c])
    expect(pairs.tap(s, c).misses).toBe(1)
  })

  it('a matched card tapped during a mismatch does nothing, and solution() plays through a mismatch', () => {
    let s = settle(make(4, 8))
    const pair = where(s, s.cards[0])
    s = pairs.tap(pairs.tap(s, pair[0]), pair[1])
    const x = where(s, other(s, s.cards[0]))[0]
    const y = s.cards.findIndex((f, j) => !s.matched[j] && f !== s.cards[x] && j !== x)
    s = pairs.tap(pairs.tap(s, x), y)
    expect(s.phase).toBe('mismatch')
    expect(pairs.tap(s, pair[0])).toBe(s)
    // The solution's first tap cuts the mismatch short; following it clears the board.
    const won = playBySolution(s)
    expect(pairs.outcome(won)).toMatchObject({ correct: true })
    expect(pairs.solution(won)).toBeNull()
  })
})

describe('Match Pairs: hard enough', () => {
  /**
   * A scripted player who keeps each card they turn with probability `p` (and forgets it otherwise)
   * and plays sensibly with what they keep: a remembered set first, else a card they do not
   * remember, then its remembered partner or another unremembered card. Plays from the board's
   * informed-miss rule (`seen`), so a forgotten card is a mistake when turned again. No clock.
   */
  function playWithMemory(s0: PairsState, p: number, rng: Rng): boolean {
    let s = settle(s0)
    const mem = new Map<number, string>()
    for (let guard = 0; guard < 5000 && !pairs.outcome(s); guard++) {
      if (s.phase === 'mismatch') {
        s = pairs.advance(s)
        continue
      }
      const unmatched = s.cards.flatMap((_, j) => (s.matched[j] ? [] : [j]))
      const byFace = new Map<string, number[]>()
      for (const [j, f] of mem) if (!s.matched[j]) byFace.set(f, [...(byFace.get(f) ?? []), j])
      const full = [...byFace.values()].find((js) => js.length >= s.size)
      const opened: number[] = []
      if (full) {
        for (const j of full.slice(0, s.size)) {
          s = pairs.tap(s, j)
          opened.push(j)
        }
      } else {
        const unknown = unmatched.filter((j) => !mem.has(j))
        const first = rng.pick(unknown.length ? unknown : unmatched)
        s = pairs.tap(s, first)
        opened.push(first)
        const face = s.cards[first]
        while (s.phase === 'play' && s.open.length > 0) {
          const known = [...mem].filter(([j, f]) => f === face && !s.matched[j] && !s.open.includes(j)).map(([j]) => j)
          const fresh = unmatched.filter((j) => !s.open.includes(j) && !mem.has(j))
          const any = unmatched.filter((j) => !s.open.includes(j))
          const next = known.length ? known[0] : rng.pick(fresh.length ? fresh : any)
          s = pairs.tap(s, next)
          opened.push(next)
        }
      }
      for (const j of opened) {
        if (s.matched[j] || rng.next() >= p) mem.delete(j)
        else mem.set(j, s.cards[j])
      }
    }
    return pairs.outcome(s)?.correct === true
  }

  const failShare = (lv: number, p: number, ctx: CreateContext, n: number) => {
    const rng = createRng(lv * 131 + Math.round(p * 1000))
    let fails = 0
    for (let i = 0; i < n; i++) if (!playWithMemory(pairs.create(lv, rng, ctx), p, rng)) fails++
    return fails / n
  }

  it('a player who keeps half of what they see fails at least 30% of boards from L6, on every screen', () => {
    for (const ctx of [DESKTOP, PHONE, NARROW]) {
      for (let lv = 6; lv <= pairsMaxLevel(ctx); lv++) {
        expect(failShare(lv, 0.5, ctx, 500), `L${lv} ${ctx.maxCols}x${ctx.maxRows}`).toBeGreaterThanOrEqual(0.3)
      }
    }
  })

  it('and stays fair: a player who keeps almost everything clears nearly every board, to the top', () => {
    for (let lv = 1; lv <= pairsMaxLevel(PHONE); lv++) expect(failShare(lv, 0.95, PHONE, 200), `L${lv}`).toBeLessThanOrEqual(0.05)
    for (let lv = pairsMaxLevel(PHONE) + 1; lv <= pairsMaxLevel(DESKTOP); lv++) expect(failShare(lv, 0.95, DESKTOP, 200), `L${lv}`).toBeLessThanOrEqual(0.05)
    // The early boards are gentle even at half: L1-3 fail under 20%.
    for (let lv = 1; lv <= 3; lv++) expect(failShare(lv, 0.5, PHONE, 500), `L${lv}`).toBeLessThan(0.2)
  })
})
