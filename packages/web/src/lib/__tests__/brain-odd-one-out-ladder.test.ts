/**
 * Odd One Out's ladder: a content tier × a board size (owner 2026-11-13 — «다른 거 찾기 난이도 올릴
 * 때 전체 카드 갯수 올리도록», «처음에는 4개카드에서 찾기 … 그 다음에 9개 16개 25개 36개», «하나만
 * 회전되어 있는거 찾기 빼자»). Read off the boards themselves: inside every tier the board grows
 * 2×2 → 6×6 one size a level and the next tier starts again at 4 cards; no board is a turned-glyph
 * puzzle; mirror boards are about the mirror alone; new content opens on its smallest board even
 * after a jump; and it stays hard — a modelled young adult runs out of time in the last tier while
 * a slow 75-year-old almost never does in the first.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONTEXT, MECHANICS, TIERS, createRng, maxColsFor, type CreateContext, type GridView, type RecentTrial } from '@reeeeecall/shared/lib/brain-games'
import {
  GLYPH_PAIRS,
  LOOKALIKE_PAIRS,
  MIRROR_GLYPHS,
  ODD_MAX_LEVEL,
  ODD_TIER_COUNT,
  POP_PAIRS,
  TWIN_PAIRS,
  oddAbsentShare,
  oddKindWeights,
  oddOneOut,
  oddOneOutLimitMs,
  oddOneOutSide,
  oddOneOutTier,
  oddTierStart,
  type OddKind,
  type OddOneOutState,
} from '@reeeeecall/shared/lib/brain-games/games/odd-one-out'

const DESKTOP: CreateContext = DEFAULT_CONTEXT
const PHONE: CreateContext = { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 }
const SMALL: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 6 }
const NARROW: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 3, maxRows: 5 }
const SCREENS = [DESKTOP, PHONE, SMALL, NARROW]
const RULES = MECHANICS.filter((m) => m.game === 'oddOneOut' && m.kind === 'rule' && !m.retired).map((m) => m.tag)
const LEVELS = Array.from({ length: ODD_MAX_LEVEL }, (_, i) => i + 1)
const EMOJI = /\p{Extended_Pictographic}/u

const view = (s: OddOneOutState) => oddOneOut.view(s) as GridView
const make = (level: number, seed: number, ctx: CreateContext = DESKTOP) => oddOneOut.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx)
const sample = (level: number, n: number, ctx: CreateContext = DESKTOP) => Array.from({ length: n }, (_, i) => make(level, i + 1, ctx))
const recentOf = (s: OddOneOutState, level = s.level): RecentTrial => ({ level, ...oddOneOut.trialInfo!(s) })

/** A round's boards at one level, each built with the last two as `ctx.recent` — as the round builds them. */
function chain(level: number, n: number, ctx: CreateContext = DESKTOP, seed = 1): OddOneOutState[] {
  const rng = createRng(seed)
  const out: OddOneOutState[] = []
  let recent: RecentTrial[] = []
  for (let i = 0; i < n; i++) {
    const s = oddOneOut.create(level, rng, { ...ctx, recent })
    out.push(s)
    recent = [...recent, recentOf(s, level)].slice(-2)
  }
  return out
}

const share = (boards: OddOneOutState[], p: (s: OddOneOutState) => boolean) => boards.filter(p).length / boards.length
const pairKey = (a: string, b: string) => [a, b].sort().join('|')
const keys = (pairs: readonly (readonly [string, string])[]) => new Set(pairs.map(([a, b]) => pairKey(a, b)))
const sideOn = (level: number, ctx: CreateContext, none = oddOneOutTier(level) === ODD_TIER_COUNT) =>
  Math.max(2, Math.min(oddOneOutSide(level), ctx.maxCols, ctx.maxRows >= 7 ? 7 : ctx.maxRows - (none ? 1 : 0)))

describe('Odd One Out: a content tier × a board size', () => {
  it('five levels a tier; inside each the board grows 2×2 → 6×6 (the last tier on to 7×7), and each tier starts again at 4 cards', () => {
    const tierOf = (lv: number) => Math.min(6, Math.floor((lv - 1) / 5) + 1)
    for (const level of LEVELS) {
      const tier = tierOf(level)
      const step = level - (1 + 5 * (tier - 1))
      const side = 2 + Math.min(step, tier === 6 ? 5 : 4)
      expect(oddOneOutTier(level), `L${level}`).toBe(tier)
      for (const s of sample(level, 10, DESKTOP)) expect([s.tier, s.cols, s.rows], `L${level}`).toEqual([tier, side, side])
      // A phone stops at 5×5 and climbs by the next tier instead.
      for (const s of sample(level, 10, PHONE)) expect([s.cols, s.rows], `phone L${level}`).toEqual([Math.min(5, side), Math.min(5, side)])
    }
    expect([1, 6, 11, 16, 21, 26].map((lv) => make(lv, 1).cols)).toEqual([2, 2, 2, 2, 2, 2])
    expect([5, 10, 15, 20, 25, 30, 31].map((lv) => make(lv, 1).cols)).toEqual([6, 6, 6, 6, 6, 6, 7])
    // A fraction of a level is that level's board; the next tier's 2×2 comes at the whole level.
    expect([make(5.99, 1).cols, make(5.99, 1).kind, make(6, 1).cols, make(6, 1).kind]).toEqual([6, 'pop', 2, 'lookalike'])
    // The engine's master tier is the last tier's 7×7 step; every other threshold is a tier's first board.
    expect(TIERS.oddOneOut).toEqual([oddTierStart(2), oddTierStart(3), oddTierStart(4), oddTierStart(5), oddTierStart(6), oddTierStart(6) + 5])
  })

  it('a screen that cannot fit the next size keeps its biggest board, and a short one keeps a row for «없음»', () => {
    for (const ctx of SCREENS) {
      for (const level of LEVELS) for (const s of sample(level, 6, ctx)) expect(s.cols, `${ctx.maxCols}×${ctx.maxRows} L${level}`).toBe(sideOn(level, ctx, s.none))
    }
    const short = { ...DEFAULT_CONTEXT, maxCols: 7, maxRows: 5 }
    expect(make(10, 1, short).cols).toBe(5)
    expect(make(30, 1, short).cols).toBe(4)
    expect(make(30, 1, { ...short, blockRules: ['oddOneOut.absent'] }).cols).toBe(5)
  })

  it('every level opens a new board or tier, or tightens some kind’s clock by ≥ 5% — on every screen, up to its ceiling', () => {
    for (const ctx of SCREENS) {
      const cap = oddOneOut.maxLevel!(ctx)
      for (let level = 2; level <= cap; level++) {
        const now = make(level, 1, ctx)
        const before = make(level - 1, 1, ctx)
        if (now.tier !== before.tier || now.cols !== before.cols) continue
        const cells = now.cols ** 2
        const inked = now.tier >= 5
        const kinds = [...(Object.keys(oddKindWeights(level)) as OddKind[]), ...(now.tier >= 5 ? (['noise'] as const) : now.tier === 4 ? (['glyph'] as const) : [])]
        const gain = Math.max(...kinds.map((k) => oddOneOutLimitMs(k, level - 1, cells, { inked }) / oddOneOutLimitMs(k, level, cells, { inked })))
        // The last step may be short of 5%: it is where the slowest board reaches the floor.
        if (level === cap) expect(oddOneOutLimitMs('mirror', level, cells, { inked: true }), `${ctx.maxCols}×${ctx.maxRows} L${level}`).toBe(900 + 45 * cells)
        else expect(gain, `${ctx.maxCols}×${ctx.maxRows} L${level}`).toBeGreaterThanOrEqual(1.05)
      }
    }
  })

  it('the ceiling is where a mirror in colour noise meets the clock’s floor on that screen, above the master tier everywhere', () => {
    expect(oddOneOut.maxLevel!(DESKTOP)).toBe(ODD_MAX_LEVEL)
    expect(oddOneOut.maxLevel!(PHONE)).toBe(39)
    expect(oddOneOut.maxLevel!({ ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 7 })).toBe(38)
    expect(oddOneOut.maxLevel!(NARROW)).toBe(38)
    for (const ctx of [...SCREENS, { ...DEFAULT_CONTEXT, maxCols: 6, maxRows: 7 }]) {
      const cap = oddOneOut.maxLevel!(ctx)
      expect(cap).toBeGreaterThan(TIERS.oddOneOut[5])
      // At the ceiling every kind is at its floor: the level above would be the same puzzle.
      const cells = make(cap, 1, ctx).cols ** 2
      expect(oddOneOutLimitMs('mirror', cap, cells, { inked: true })).toBe(900 + 45 * cells)
      expect(oddOneOutLimitMs('mirror', cap - 1, cells, { inked: true })).toBeGreaterThan(900 + 45 * cells)
    }
  })

  it('the kinds come in where the tiers put them', () => {
    const kindsAt = (level: number) => [...new Set(sample(level, 300).map((s) => s.kind))].sort()
    for (const level of [1, 3, 5, 5.99]) expect(kindsAt(level), `L${level}`).toEqual(['pop'])
    for (const level of [6, 8, 10]) expect(kindsAt(level), `L${level}`).toEqual(['lookalike'])
    for (const level of [11, 13, 15]) expect(kindsAt(level), `L${level}`).toEqual(['glyph'])
    for (const level of [16, 18, 20]) expect(kindsAt(level), `L${level}`).toEqual(['mirror'])
    for (const level of [21, 25, 26, 31, 39]) expect(kindsAt(level), `L${level}`).toEqual(['mirror', 'twin'])
  })

  it('each tag first appears at its level, never a hair below; retired tags never appear', () => {
    const tags = (level: number) => new Set(sample(level, 300).flatMap((s) => [...oddOneOut.mechanics(s)]))
    for (const [tag, from] of [
      ['oddOneOut.lookalike', 6], ['oddOneOut.glyphs', 11], ['oddOneOut.mirror', 16], ['oddOneOut.colorNoise', 21],
      ['oddOneOut.glyphTwin', 21], ['oddOneOut.absent', 26],
      ['oddOneOut.grid4', 3], ['oddOneOut.grid5', 4], ['oddOneOut.grid6', 5], ['oddOneOut.grid7', 31],
    ] as const) {
      expect(tags(from).has(tag), `${tag} at ${from}`).toBe(true)
      expect(tags(from - 0.01).has(tag), `${tag} below ${from}`).toBe(false)
      expect(MECHANICS.find((m) => m.tag === tag)?.from, tag).toBe(from)
    }
    for (const level of LEVELS) {
      expect(tags(level).has('oddOneOut.nearTwin')).toBe(false)
      expect(tags(level).has('oddOneOut.rotation')).toBe(false)
    }
    expect(MECHANICS.find((m) => m.tag === 'oddOneOut.rotation')?.retired).toBe(true)
  })

  it('the kind is the trial info and part of the signature; the carry is the tier and the rules open', () => {
    for (const level of [3, 12, 18, 23, 30]) {
      for (const s of sample(level, 60)) {
        expect(oddOneOut.trialInfo!(s)).toEqual({ kind: s.kind, carry: `${s.tier}${s.open}` })
        expect(oddOneOut.signature(s).startsWith(`oo:${s.kind}:`)).toBe(true)
        expect(s.open).toBe(`${s.tier >= 4 ? 'm' : ''}${s.tier === 6 ? 'n' : ''}`)
      }
    }
  })
})

describe('Odd One Out: what each kind looks like', () => {
  it('pop-out only in tier 1, look-alikes only in tier 2, no emoji from tier 3, no colour-only and no turned pair anywhere', () => {
    const pop = keys(POP_PAIRS)
    const lookalike = keys(LOOKALIKE_PAIRS)
    const glyph = keys(GLYPH_PAIRS)
    const twin = keys(TWIN_PAIRS)
    // Same shape, another colour: never a pair here.
    const colourOnly = keys([['🔴', '🟠'], ['📕', '📙'], ['🔵', '🟣'], ['🟦', '🟩'], ['🍏', '🍎'], ['💙', '💚'], ['🟡', '🟢'], ['🔶', '🔷'], ['🌕', '🌖']])
    // The same glyph turned — «하나만 회전되어 있는거» in disguise.
    const turned = keys([['6', '9'], ['b', 'q'], ['d', 'p'], ['n', 'u'], ['M', 'W']])
    for (const level of [...LEVELS, 1.5, 10.99, 60, 120]) {
      for (const s of sample(level, 120)) {
        const k = pairKey(s.common, s.odd)
        const at = `L${level} ${s.kind} ${s.common}/${s.odd}`
        expect(colourOnly.has(k) || turned.has(k), at).toBe(false)
        expect(pop.has(k), at).toBe(level < 6)
        if (level >= 11) expect(EMOJI.test(s.common + s.odd), at).toBe(false)
        if (s.absent) continue
        expect(s.odd === s.common, at).toBe(s.kind === 'mirror')
        if (s.kind === 'mirror') expect(MIRROR_GLYPHS).toContain(s.common)
        else expect({ pop, lookalike, glyph, noise: glyph, twin }[s.kind].has(k), at).toBe(true)
        if (s.kind === 'lookalike') expect(level >= 6 && level < 11, at).toBe(true)
      }
    }
    expect([...glyph].some((k) => turned.has(k))).toBe(false)
  })

  it('no board is a turned-glyph board: only mirror boards turn their cells, and there the turn never singles out the odd one', () => {
    let mirrors = 0
    for (const ctx of SCREENS) {
      for (const level of LEVELS) {
        for (const s of sample(level, 40, ctx)) {
          const cells = view(s).cells
          const at = `${ctx.maxCols} cols L${level} ${s.kind}`
          if (s.kind !== 'mirror') {
            expect(s.rotations.every((r) => r === 0), at).toBe(true)
            expect(cells.every((c) => !c.rotate && !c.mirror), at).toBe(true)
            continue
          }
          mirrors++
          expect(cells.every((c) => c.label === s.common), at).toBe(true)
          expect(s.rotations.every((r) => r % 45 === 0 && r >= 0 && r < 360), at).toBe(true)
          // The others stand at two angles or more: no «upright» for the odd one to break.
          const others = s.rotations.filter((_, i) => i !== s.oddIndex)
          expect(new Set(others).size, at).toBeGreaterThanOrEqual(2)
          // The odd one (and only it) is mirrored.
          expect(cells.flatMap((c, i) => (c.mirror ? [i] : [])), at).toEqual(s.absent ? [] : [s.oddIndex])
        }
      }
    }
    expect(mirrors).toBeGreaterThan(1000)
  })

  it('colour noise on every board from tier 5: the others in ≥ 2 inks, the odd one in one of theirs — it differs only in shape', () => {
    const oddInks: Record<string, number> = {}
    let n = 0
    for (const level of LEVELS) {
      for (const s of sample(level, 120)) {
        expect(s.inks.length > 0, `L${level}`).toBe(s.tier >= 5)
        if (!s.inks.length) continue
        const cells = view(s).cells
        const others = cells.filter((_, i) => i !== s.oddIndex)
        expect(new Set(others.map((c) => c.ink)).size).toBeGreaterThanOrEqual(2)
        if (s.absent) continue
        const odd = cells[s.oddIndex]
        expect(others.map((c) => c.ink)).toContain(odd.ink)
        expect(odd.label !== s.common || odd.mirror === true).toBe(true)
        oddInks[odd.ink!] = (oddInks[odd.ink!] ?? 0) + 1
        n++
      }
    }
    // Its ink tells nothing: about a third each.
    for (const ink of ['neutral', 'amber', 'cyan']) expect((oddInks[ink] ?? 0) / n, ink).toBeGreaterThan(0.25)
  })

  it('a miss shows the odd one beside a typical one, upright, without ink (a mirror image stays mirrored)', () => {
    for (const level of [3, 13, 18, 24, 33]) {
      for (const s of sample(level, 150).filter((x) => !x.absent)) {
        const wrong = (s.oddIndex + 1) % (s.cols * s.rows)
        const v = view(oddOneOut.tap(s, wrong))
        expect(v.cells[s.oddIndex].tone).toBe('missed')
        expect(v.cells[wrong].tone).toBe('wrong')
        expect(v.missChip).toEqual({ odd: { label: s.odd, tone: 'idle', ...(s.mirror ? { mirror: true } : {}) }, common: { label: s.common, tone: 'idle' } })
        expect(view(oddOneOut.tap(s, s.oddIndex)).missChip).toBeUndefined()
        expect(view(oddOneOut.timeout(s)).missChip).toBeDefined()
      }
    }
  })
})

describe('Odd One Out: «없음»', () => {
  it('from L26 every board has the button (so it gives nothing away); before, none does', () => {
    for (const ctx of [DESKTOP, PHONE]) {
      for (const level of LEVELS) {
        for (const s of sample(level, 40, ctx)) {
          const v = view(s)
          if (level < 26) {
            expect(v.extra).toBeUndefined()
            expect(s.absent).toBe(false)
            expect(oddOneOut.tap(s, v.cells.length), 'no button, no tap').toBe(s)
          } else {
            expect(v.extra).toEqual({ key: 'play.noneOdd', index: v.cells.length })
            expect(v.prompt.key).toBe('play.findOddOrNone')
          }
        }
      }
    }
  })

  it('an empty board: solution() is the button, any cell is wrong, the button is right', () => {
    let empty = 0
    let full = 0
    for (const level of [26, 27, 29, 31, 35, 39]) {
      for (const s of sample(level, 200, PHONE)) {
        const cells = s.cols * s.rows
        if (s.absent) {
          empty++
          expect(oddOneOut.solution(s)).toEqual([cells])
          expect(view(s).cells.every((c) => c.label === s.common && !c.mirror)).toBe(true)
          for (let i = 0; i < cells; i++) expect(oddOneOut.outcome(oddOneOut.tap(s, i))?.correct).toBe(false)
          const tapped = view(oddOneOut.tap(s, 0))
          expect(tapped.extra?.tone).toBe('missed')
          expect(tapped.cells[0].tone).toBe('wrong')
          expect(tapped.missChip).toBeUndefined()
          const right = oddOneOut.tap(s, cells)
          expect(oddOneOut.outcome(right)?.correct).toBe(true)
          expect(view(right).extra?.tone).toBe('correct')
          expect(view(oddOneOut.timeout(s)).extra?.tone).toBe('missed')
        } else {
          full++
          const none = oddOneOut.tap(s, cells)
          expect(oddOneOut.outcome(none)?.correct).toBe(false)
          expect(view(none).extra?.tone).toBe('wrong')
          expect(view(none).cells[s.oddIndex].tone).toBe('missed')
          expect(view(oddOneOut.tap(s, s.oddIndex)).extra?.tone).toBeUndefined()
        }
      }
    }
    expect(empty).toBeGreaterThan(200)
    expect(full).toBeGreaterThan(200)
  })
})

describe('Odd One Out: the clock', () => {
  it('clock ≥ 900 + 45·cells; L1 ≥ 4.5 s (≥ 4 s to L2); boards with «없음» get 1 + 0.4·(empty share), empty or not; spot values', () => {
    for (const ctx of SCREENS) {
      for (const level of [...LEVELS, 1.5, 7.3, 13.5, 25.75, 60, 120]) {
        for (const s of sample(level, 30, ctx)) {
          const cells = s.cols * s.rows
          const limit = oddOneOut.timeLimitMs(s)!
          const kindClock = oddOneOutLimitMs(s.kind, level, cells, { inked: s.inks.length > 0 })
          expect(kindClock).toBeGreaterThanOrEqual(900 + 45 * cells)
          // The timer bar never tells an empty board apart: the same factor on every board that
          // carries the button, so the average is the plan's (1.4× on the empty share).
          const factor = s.none ? 1 + 0.4 * oddAbsentShare(level) : 1
          expect(Math.abs(limit - factor * kindClock), `L${level} ${s.kind} absent=${s.absent}`).toBeLessThanOrEqual(1.001)
          if (level === 1) expect(limit).toBeGreaterThanOrEqual(4500)
          if (level < 2) expect(limit).toBeGreaterThanOrEqual(4000)
        }
      }
    }
    // Same kind, same board, same level: an empty board's clock equals a full one's.
    for (const level of [26, 29, 31, 35]) {
      const all = chain(level, 400).filter((s) => s.kind === 'mirror')
      const empty = all.filter((s) => s.absent).map((s) => s.limitMs)
      const full = all.filter((s) => !s.absent).map((s) => s.limitMs)
      expect(empty.length > 0 && full.length > 0, `L${level}`).toBe(true)
      expect(new Set([...empty, ...full]).size, `L${level}`).toBe(1)
    }
    const near = (ms: number, s: number) => expect(Math.abs(ms / 1000 - s), `${ms} vs ${s}s`).toBeLessThanOrEqual(0.02)
    near(oddOneOutLimitMs('pop', 1, 4), 4.52)
    near(oddOneOutLimitMs('pop', 5, 36), 6.49)
    near(oddOneOutLimitMs('lookalike', 6, 4), 4.17)
    near(oddOneOutLimitMs('glyph', 11, 4), 3.59)
    near(oddOneOutLimitMs('glyph', 15, 36), 6.03)
    near(oddOneOutLimitMs('mirror', 16, 4), 3.53)
    near(oddOneOutLimitMs('mirror', 20, 36), 8.0)
    near(oddOneOutLimitMs('mirror', 25, 36, { inked: true }), 6.27)
    near(oddOneOutLimitMs('mirror', 30, 36, { inked: true, none: true }), 5.42)
  })

  it('inside a tier a bigger board gets more time in all but less per card; the clock grows with the cards', () => {
    for (let tier = 1; tier <= ODD_TIER_COUNT; tier++) {
      const start = oddTierStart(tier)
      const last = tier === ODD_TIER_COUNT ? 5 : 4
      for (const kind of Object.keys(oddKindWeights(start)) as OddKind[]) {
        const inked = tier >= 5
        for (let step = 1; step <= last; step++) {
          const [a, b] = [start + step - 1, start + step]
          const [ca, cb] = [oddOneOutSide(a) ** 2, oddOneOutSide(b) ** 2]
          const [la, lb] = [oddOneOutLimitMs(kind, a, ca, { inked }), oddOneOutLimitMs(kind, b, cb, { inked })]
          expect(lb, `T${tier} ${kind} L${b}`).toBeGreaterThan(la)
          expect(lb / cb, `T${tier} ${kind} L${b}`).toBeLessThan(la / ca)
        }
      }
    }
  })
})

describe('Odd One Out: new content opens on its smallest board', () => {
  const at = (level: number, recent: RecentTrial[], extra: Partial<CreateContext> = {}, n = 120) =>
    Array.from({ length: n }, (_, i) => oddOneOut.create(level, createRng(i + 1), { ...DESKTOP, recent, ...extra }))
  const trial = (level: number, kind: OddKind, carry: string): RecentTrial => ({ level, kind, carry })

  it('arriving mid-tier by a jump (placement handing over), the first board is the tier’s 2×2 at its first clock; the next is the level’s own', () => {
    const fromBelow = [trial(13, 'glyph', '3'), trial(14, 'glyph', '3')]
    for (const s of at(18, fromBelow)) {
      expect([s.cols, s.kind, s.level], 'the first mirror board').toEqual([2, 'mirror', 16])
      expect(s.limitMs).toBe(oddOneOutLimitMs('mirror', 16, 4))
      const next = oddOneOut.create(18, createRng(99), { ...DESKTOP, recent: [fromBelow[1], recentOf(s, 18)] })
      expect([next.cols, next.level]).toEqual([4, 18])
    }
    for (const s of at(9.4, [trial(4, 'pop', '1'), trial(5, 'pop', '1')])) expect([s.cols, s.kind]).toEqual([2, 'lookalike'])
  })

  it('a rule opening on a tier the round was playing without it starts on 2×2, and that board shows the rule', () => {
    // Placement blocked the mirror (tier 5 played as letters in colour noise); now it opens.
    const placedT5 = [trial(23, 'noise', '5'), trial(23.5, 'twin', '5')]
    for (const s of at(24, placedT5)) {
      expect([s.cols, s.kind, s.mirror || s.absent]).toEqual([2, 'mirror', true])
      expect(oddOneOut.mechanics(s)).toContain('oddOneOut.mirror')
    }
    // «없음» opens on the last tier: its first board is 2×2, with the button.
    for (const s of at(29, [trial(28, 'mirror', '6m'), trial(28.5, 'twin', '6m')])) {
      expect([s.cols, s.none]).toEqual([2, true])
      expect(view(s).extra?.index).toBe(4)
    }
  })

  it('never in placement or practice, never on a round’s first trial, a step down, or more of the same content', () => {
    const fromBelow = [trial(13, 'glyph', '3'), trial(14, 'glyph', '3')]
    for (const trialKind of ['placement', 'practice'] as const) for (const s of at(18, fromBelow, { trialKind })) expect(s.cols).toBe(4)
    for (const s of at(18, [])) expect(s.cols).toBe(4)
    // Down a tier after a miss: the content was met above.
    for (const s of at(15.2, [trial(16.1, 'mirror', '4m'), trial(16.3, 'mirror', '4m')])) expect([s.cols, s.kind]).toEqual([6, 'glyph'])
    // Tier 5 alternating mirror and twins, the rules unchanged.
    for (const s of at(24, [trial(24, 'mirror', '5m'), trial(24, 'twin', '5m')])) expect(s.cols).toBe(5)
    // A recent trial without a carry (built before it existed) counts as seen.
    for (const s of at(24, [{ level: 23, kind: 'mirror' }])) expect(s.cols).toBe(5)
    // Climbing one step a level never needs it: a tier starts on 2×2 anyway.
    for (const level of LEVELS) for (const s of chain(level, 30)) expect(s.cols, `L${level}`).toBe(sideOn(level, DESKTOP))
  })
})

describe('Odd One Out: variety and gating', () => {
  it('never the same kind three in a row where a tier has two, given ctx.recent', () => {
    for (const level of [21, 24, 26, 30, 35]) {
      for (const kind of Object.keys(oddKindWeights(level))) {
        const recent: RecentTrial[] = [{ level, kind, carry: `${oddOneOutTier(level)}m${level >= 26 ? 'n' : ''}` }, { level, kind, carry: `${oddOneOutTier(level)}m${level >= 26 ? 'n' : ''}` }]
        for (let seed = 1; seed <= 150; seed++) {
          expect(oddOneOut.create(level, createRng(seed), { ...DESKTOP, recent }).kind, `L${level} after ${kind} ×2`).not.toBe(kind)
        }
      }
      const run = chain(level, 1500).map((s) => s.kind)
      for (let i = 2; i < run.length; i++) expect(run[i] === run[i - 1] && run[i] === run[i - 2], `L${level} #${i}`).toBe(false)
    }
  })

  it('with every rule blocked, no rule shows: no mirror, no turn, no «없음» — the tier’s plain letters instead', () => {
    for (const ctx of [DESKTOP, PHONE]) {
      for (const level of [...LEVELS, 16.5, 26.5, 41]) {
        for (let seed = 1; seed <= 40; seed++) {
          const s = oddOneOut.create(level, createRng(seed), { ...ctx, blockRules: RULES, trialKind: 'placement' })
          const at = `L${level} seed ${seed} ${s.kind}`
          expect(oddOneOut.mechanics(s).filter((t) => RULES.includes(t)), at).toEqual([])
          expect(s.none || s.absent || s.mirror, at).toBe(false)
          expect(s.rotations.every((r) => r === 0), at).toBe(true)
          expect(view(s).extra).toBeUndefined()
          expect(s.open).toBe('')
          if (s.tier === 4) expect(s.kind, at).toBe('glyph')
          if (s.tier >= 5) expect(['noise', 'twin'], at).toContain(s.kind)
        }
      }
    }
  })

  it('one rule blocked takes out that rule alone', () => {
    const boards = (block: string) => Array.from({ length: 400 }, (_, i) => oddOneOut.create(30, createRng(i + 1), { ...DESKTOP, blockRules: [block] }))
    const noMirror = boards('oddOneOut.mirror')
    expect(noMirror.some((s) => s.kind === 'mirror')).toBe(false)
    expect(noMirror.some((s) => s.absent) && noMirror.some((s) => s.kind === 'noise')).toBe(true)
    const noNone = boards('oddOneOut.absent')
    expect(noNone.some((s) => s.none)).toBe(false)
    expect(noNone.some((s) => s.kind === 'mirror')).toBe(true)
  })
})

/**
 * A modelled check of the clock, not measured people (plan §7; recalibrate from logged medians,
 * EVIDENCE §4.5). Serial self-terminating search (Treisman & Gelade 1980; Wolfe 1998): cells are
 * looked at in random order, so the odd one is the k-th, k uniform over the cells; an empty board is
 * searched to the end and checked again (× 1.15). Time = (base + k·slope) × a spread of 0.8, 1 or
 * 1.25 (equal weights, about a lognormal of σ 0.18); a timeout is a time over the limit. The base
 * covers orienting and the tap; colour noise adds 5 ms a cell. A slow 75-year-old is the young adult
 * × 2.2 per cell, base 1.6 s. Expectations are taken over a level's kinds and its empty share.
 */
const SLOPE: Record<OddKind, number> = { pop: 8, lookalike: 35, glyph: 45, noise: 45, twin: 70, mirror: 110 }
const PERSONAS = {
  young: { base: 700, perCell: 1 },
  slow75: { base: 1600, perCell: 2.2 },
} as const
const SPREAD = [0.8, 1, 1.25]

function timeouts(persona: keyof typeof PERSONAS, kind: OddKind, inked: boolean, cells: number, limit: number, absent: boolean): number {
  const p = PERSONAS[persona]
  const slope = p.perCell * (SLOPE[kind] + (inked ? 5 : 0))
  let over = 0
  for (const f of SPREAD) {
    if (absent) over += (p.base + cells * slope * 1.15) * f > limit ? cells : 0
    else for (let k = 1; k <= cells; k++) over += (p.base + k * slope) * f > limit ? 1 : 0
  }
  return over / (cells * SPREAD.length)
}

function expectedTimeouts(persona: keyof typeof PERSONAS, level: number, ctx: CreateContext): number {
  const tier = oddOneOutTier(level)
  const none = tier === ODD_TIER_COUNT
  const cells = sideOn(level, ctx, none) ** 2
  const inked = tier >= 5
  const empty = oddAbsentShare(level)
  const weights = Object.entries(oddKindWeights(level)) as [OddKind, number][]
  return weights.reduce((sum, [kind, w]) => {
    const limit = oddOneOutLimitMs(kind, level, cells, { none, inked })
    return sum + w * ((1 - empty) * timeouts(persona, kind, inked, cells, limit, false) + empty * timeouts(persona, kind, inked, cells, limit, true))
  }, 0)
}

describe('Odd One Out: hard enough', () => {
  it('mirror boards: every one of tier 4, half of tiers 5-6', () => {
    for (let level = 16; level <= 20; level++) expect(share(chain(level, 500), (s) => s.kind === 'mirror'), `L${level}`).toBe(1)
    for (const level of [21, 25, 26, 30, 35]) expect(Math.abs(share(chain(level, 2000), (s) => s.kind === 'mirror') - 0.5), `L${level}`).toBeLessThanOrEqual(0.05)
  })

  it('empty boards: 25% ± 4% at L26-28, a third from L29, none before', () => {
    for (const level of LEVELS) {
      const empty = share(chain(level, 2000, PHONE), (s) => s.absent)
      expect(Math.abs(empty - oddAbsentShare(level)), `L${level}: ${empty}`).toBeLessThanOrEqual(0.04)
    }
    expect([oddAbsentShare(25), oddAbsentShare(26), oddAbsentShare(28)]).toEqual([0, 0.25, 0.25])
    expect(oddAbsentShare(29)).toBeCloseTo(1 / 3)
  })

  it('modelled: each bigger board of a tier is harder, and each tier’s first board harder than the last tier’s first', () => {
    for (const persona of ['young', 'slow75'] as const) {
      for (let tier = 1; tier <= ODD_TIER_COUNT; tier++) {
        const start = oddTierStart(tier)
        const steps = Array.from({ length: tier === ODD_TIER_COUNT ? 6 : 5 }, (_, i) => expectedTimeouts(persona, start + i, DESKTOP))
        for (let i = 1; i < steps.length; i++) expect(steps[i], `${persona} T${tier} step ${i}`).toBeGreaterThanOrEqual(steps[i - 1])
        if (tier > 1) expect(steps[0], `${persona} T${tier} opens`).toBeGreaterThanOrEqual(expectedTimeouts(persona, oddTierStart(tier - 1), DESKTOP))
      }
    }
    // Where it bites: the slow 75-year-old on big letter and mirror boards, the young adult in the last tier.
    expect(expectedTimeouts('slow75', 15, DESKTOP)).toBeGreaterThan(0)
    expect(expectedTimeouts('slow75', 20, DESKTOP)).toBeGreaterThan(0.2)
  })

  it('modelled: a young adult times out on ≥ 10% at L29 and ≥ 25% at L31; a slow 75-year-old on ≤ 7% across tier 1', () => {
    for (const ctx of [DESKTOP, PHONE]) {
      expect(expectedTimeouts('young', 29, ctx), `young L29 ${ctx.maxCols} cols`).toBeGreaterThanOrEqual(0.1)
      expect(expectedTimeouts('young', 31, ctx), `young L31 ${ctx.maxCols} cols`).toBeGreaterThanOrEqual(0.25)
      expect(expectedTimeouts('young', 25, ctx), `young L25 ${ctx.maxCols} cols`).toBeLessThan(0.1)
    }
    for (const ctx of SCREENS) {
      for (let level = 1; level <= 5; level++) expect(expectedTimeouts('slow75', level, ctx), `slow L${level} ${ctx.maxCols} cols`).toBeLessThanOrEqual(0.07)
    }
  })
})
