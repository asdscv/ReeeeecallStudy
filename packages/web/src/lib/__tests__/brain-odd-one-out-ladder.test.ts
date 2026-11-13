/**
 * Odd One Out's content ladder (GAMES_DIFFICULTY_PLAN §3.3). Read off the boards themselves: what
 * kind of odd one each level shows (pop-out, look-alike, turned, glyph, colour noise, mirror image,
 * none at all, CJK twin), how often, on which board, against which clock — and that it stays hard:
 * the kinds that need real search dominate from L10, and a modelled young adult still runs out of
 * time at L24 while a slow 75-year-old almost never does at L1-2.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONTEXT, MECHANICS, createRng, maxColsFor, type CreateContext, type GridView, type RecentTrial } from '@reeeeecall/shared/lib/brain-games'
import {
  GLYPH_PAIRS,
  LOOKALIKE_PAIRS,
  MIRROR_GLYPHS,
  ODD_MAX_LEVEL,
  POP_PAIRS,
  ROTATABLE,
  TWIN_PAIRS,
  oddAbsentShare,
  oddKindWeights,
  oddOneOut,
  oddOneOutBand,
  oddOneOutLimitMs,
  oddTurn,
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

/** A round's boards at one level, each built with the last two as `ctx.recent` — as the round builds them. */
function chain(level: number, n: number, ctx: CreateContext = DESKTOP, seed = 1): OddOneOutState[] {
  const rng = createRng(seed)
  const out: OddOneOutState[] = []
  let recent: RecentTrial[] = []
  for (let i = 0; i < n; i++) {
    const s = oddOneOut.create(level, rng, { ...ctx, recent })
    out.push(s)
    recent = [...recent, { level, kind: oddOneOut.trialInfo!(s).kind }].slice(-2)
  }
  return out
}

const share = (boards: OddOneOutState[], p: (s: OddOneOutState) => boolean) => boards.filter(p).length / boards.length
const pairKey = (a: string, b: string) => [a, b].sort().join('|')
const keys = (pairs: readonly (readonly [string, string])[]) => new Set(pairs.map(([a, b]) => pairKey(a, b)))
const inked = (kind: OddKind, level: number) => kind === 'noise' || (kind === 'twin' && level >= 24)

describe('Odd One Out: a new puzzle every level', () => {
  it('every level 1-31 opens a new band, or tightens some kind it shows by ≥ 5% (desktop)', () => {
    for (let level = 2; level <= 31; level++) {
      if (oddOneOutBand(level) !== oddOneOutBand(level - 1)) continue
      const cells = make(level, 1).cols ** 2
      expect(make(level - 1, 1).cols ** 2, `L${level}: same band, same board`).toBe(cells)
      const kinds = Object.keys(oddKindWeights(level)) as OddKind[]
      const gain = Math.max(...kinds.map((k) => oddOneOutLimitMs(k, level - 1, cells, { inked: inked(k, level) }) / oddOneOutLimitMs(k, level, cells, { inked: inked(k, level) })))
      expect(gain, `L${level}`).toBeGreaterThanOrEqual(1.05)
    }
  })

  it('the ceiling is where the slowest kind meets the floor on that screen, always above the master tier', () => {
    expect(oddOneOut.maxLevel!(DESKTOP)).toBe(32)
    expect(oddOneOut.maxLevel!(PHONE)).toBe(30)
    // At the ceiling every kind is at its floor: the level above would be the same puzzle.
    for (const ctx of [DESKTOP, PHONE, { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 7 }]) {
      const cap = oddOneOut.maxLevel!(ctx)
      expect(cap).toBeGreaterThan(26)
      const cells = make(cap, 1, ctx).cols ** 2
      expect(oddOneOutLimitMs('mirror', cap, cells)).toBe(900 + 45 * cells)
      expect(oddOneOutLimitMs('mirror', cap - 1, cells)).toBeGreaterThan(900 + 45 * cells)
    }
  })

  it('the kinds come in where the plan puts them', () => {
    const kindsAt = (level: number) => new Set(sample(level, 300).map((s) => s.kind))
    expect([...kindsAt(1)]).toEqual(['pop'])
    expect([...kindsAt(2)]).toEqual(['pop'])
    expect([...kindsAt(3)]).toEqual(['lookalike'])
    expect([...kindsAt(4.99)]).toEqual(['lookalike'])
    expect([...kindsAt(5)].sort()).toEqual(['lookalike', 'rotation'])
    expect([...kindsAt(7)].sort()).toEqual(['glyph', 'rotation'])
    expect([...kindsAt(10)].sort()).toEqual(['glyph', 'noise', 'rotation'])
    expect([...kindsAt(12)].sort()).toEqual(['glyph', 'mirror', 'noise', 'rotation'])
    expect([...kindsAt(17)].sort()).toEqual(['glyph', 'mirror', 'noise', 'rotation', 'twin'])
    // From L24 the twins sit inside colour noise.
    expect(sample(23, 300).filter((s) => s.kind === 'twin').every((s) => s.inks.length === 0)).toBe(true)
    expect(sample(24, 300).filter((s) => s.kind === 'twin').every((s) => s.inks.length > 0)).toBe(true)
  })

  it('each tag first appears at its level, never a hair below', () => {
    const tags = (level: number) => new Set(sample(level, 300).flatMap((s) => [...oddOneOut.mechanics(s)]))
    for (const [tag, from] of [
      ['oddOneOut.lookalike', 3], ['oddOneOut.rotation', 5], ['oddOneOut.glyphs', 7], ['oddOneOut.colorNoise', 10],
      ['oddOneOut.mirror', 12], ['oddOneOut.absent', 16], ['oddOneOut.glyphTwin', 17],
      ['oddOneOut.grid4', 3], ['oddOneOut.grid5', 6], ['oddOneOut.grid6', 12], ['oddOneOut.grid7', 18],
    ] as const) {
      expect(tags(from).has(tag), `${tag} at ${from}`).toBe(true)
      expect(tags(from - 0.01).has(tag), `${tag} below ${from}`).toBe(false)
    }
    // Emoji near-twins are gone; the tag stays registered (retired) so the bits never move.
    for (const level of LEVELS) expect(tags(level).has('oddOneOut.nearTwin')).toBe(false)
  })

  it('the kind is the trial info and part of the signature', () => {
    for (const s of sample(20, 100)) {
      expect(oddOneOut.trialInfo!(s)).toEqual({ kind: s.kind })
      expect(oddOneOut.signature(s).startsWith(`oo:${s.kind}:`)).toBe(true)
    }
  })
})

describe('Odd One Out: what each kind looks like', () => {
  it('pop-out only at L1-2; no colour-only pair anywhere; no emoji from L7', () => {
    const pop = keys(POP_PAIRS)
    const lookalike = keys(LOOKALIKE_PAIRS)
    const glyph = keys(GLYPH_PAIRS)
    const twin = keys(TWIN_PAIRS)
    // Same shape, another colour: never a pair here.
    const colourOnly = keys([['🔴', '🟠'], ['📕', '📙'], ['🔵', '🟣'], ['🟦', '🟩'], ['🍏', '🍎'], ['💙', '💚'], ['🟡', '🟢'], ['🔶', '🔷'], ['🌕', '🌖']])
    expect(LOOKALIKE_PAIRS.map(([a, b]) => pairKey(a, b)).sort()).toEqual(
      [...keys([['🍊', '🍑'], ['🐯', '🦁'], ['🐭', '🐹'], ['🍋', '🍈'], ['🐸', '🐢'], ['🍒', '🍓']])].sort(),
    )
    for (const level of [...LEVELS, 1.5, 6.99, 40, 120]) {
      for (const s of sample(level, 120)) {
        const k = pairKey(s.common, s.odd)
        const at = `L${level} ${s.kind} ${s.common}/${s.odd}`
        expect(colourOnly.has(k), at).toBe(false)
        expect(pop.has(k), at).toBe(level < 3)
        if (level >= 7) expect(EMOJI.test(s.common + s.odd), at).toBe(false)
        if (s.absent) continue
        expect(s.odd === s.common, at).toBe(s.kind === 'rotation' || s.kind === 'mirror')
        const from = { pop, lookalike, glyph, noise: glyph, twin }[s.kind as Exclude<OddKind, 'rotation' | 'mirror'>]
        if (from) expect(from.has(k), at).toBe(true)
        else expect((s.kind === 'mirror' ? MIRROR_GLYPHS : ROTATABLE).includes(s.common), at).toBe(true)
      }
    }
  })

  it('rotation: the odd one turned max(15, 120·0.86^(L−5))°; from L18 every cell tilts a little, never as far', () => {
    let tilted = 0
    for (const level of [5, 6, 7, 9, 10, 14, 17, 18, 19, 24, 31, 5.5, 18.5]) {
      for (const s of sample(level, 400).filter((x) => x.kind === 'rotation' && !x.absent)) {
        const turn = oddTurn(level)
        const odd = Math.abs(s.rotations[s.oddIndex])
        const rest = s.rotations.filter((_, i) => i !== s.oddIndex).map(Math.abs)
        if (level < 18) {
          expect(odd).toBe(Math.round(turn))
          expect(rest.every((r) => r === 0)).toBe(true)
        } else {
          const tilt = Math.min(8, turn / 2)
          expect(odd).toBeGreaterThanOrEqual(Math.round(turn))
          expect(Math.max(...rest)).toBeLessThanOrEqual(Math.round(tilt))
          expect(odd - Math.max(...rest), `L${level}: the odd one stands out of the tilt`).toBeGreaterThanOrEqual(7)
          if (Math.max(...rest) > 0) tilted++
        }
      }
    }
    expect(tilted).toBeGreaterThan(0)
    expect(Math.round(oddTurn(5))).toBe(120)
    expect(Math.round(oddTurn(6))).toBe(103)
    // The plan's «89° → 65°» over L7-9 (65.6° unrounded).
    expect(Math.round(oddTurn(7))).toBe(89)
    expect(Math.abs(oddTurn(9) - 65)).toBeLessThan(1)
    expect(oddTurn(40)).toBe(15)
  })

  it('mirror: F, P, G or J, every cell at a 45° step, the odd one (and only it) mirrored', () => {
    let seen = 0
    for (const level of [12, 13, 15, 16, 20, 24, 30]) {
      for (const s of sample(level, 300).filter((x) => x.kind === 'mirror')) {
        const cells = view(s).cells
        expect(MIRROR_GLYPHS).toContain(s.common)
        expect(cells.every((c) => c.label === s.common)).toBe(true)
        expect(s.rotations.every((r) => r % 45 === 0 && r >= 0 && r < 360)).toBe(true)
        const mirrored = cells.flatMap((c, i) => (c.mirror ? [i] : []))
        expect(mirrored).toEqual(s.absent ? [] : [s.oddIndex])
        seen++
      }
    }
    expect(seen).toBeGreaterThan(100)
  })

  it('colour noise: the others in ≥ 2 inks, the odd one in one of theirs — it differs only in its glyph', () => {
    const oddInks: Record<string, number> = {}
    let n = 0
    for (const level of [10, 11, 14, 20, 24, 28]) {
      for (const s of sample(level, 400).filter((x) => x.inks.length > 0)) {
        const cells = view(s).cells
        const others = cells.filter((_, i) => i !== s.oddIndex)
        expect(new Set(others.map((c) => c.ink)).size).toBeGreaterThanOrEqual(2)
        expect(cells.every((c) => !c.rotate && !c.mirror)).toBe(true)
        expect(['noise', 'twin']).toContain(s.kind)
        if (s.absent) continue
        const odd = cells[s.oddIndex]
        expect(others.map((c) => c.ink)).toContain(odd.ink)
        expect(odd.label).not.toBe(s.common)
        oddInks[odd.ink!] = (oddInks[odd.ink!] ?? 0) + 1
        n++
      }
    }
    // Its ink tells nothing: about a third each.
    for (const ink of ['neutral', 'amber', 'cyan']) expect((oddInks[ink] ?? 0) / n, ink).toBeGreaterThan(0.25)
  })

  it('a miss shows the odd one beside a typical one, upright, without ink; not on a rotation board', () => {
    for (const s of sample(24, 300).filter((x) => !x.absent)) {
      const wrong = (s.oddIndex + 1) % (s.cols * s.rows)
      const v = view(oddOneOut.tap(s, wrong))
      expect(v.cells[s.oddIndex].tone).toBe('missed')
      expect(v.cells[wrong].tone).toBe('wrong')
      if (s.kind === 'rotation') {
        expect(v.missChip).toBeUndefined()
        continue
      }
      expect(v.missChip).toEqual({ odd: { label: s.odd, tone: 'idle', ...(s.mirror ? { mirror: true } : {}) }, common: { label: s.common, tone: 'idle' } })
      expect(view(oddOneOut.tap(s, s.oddIndex)).missChip).toBeUndefined()
      expect(view(oddOneOut.timeout(s)).missChip).toBeDefined()
    }
  })
})

describe('Odd One Out: «없음»', () => {
  it('from L16 every board has the button (so it gives nothing away); before, none does', () => {
    for (const ctx of [DESKTOP, PHONE]) {
      for (const level of LEVELS) {
        for (const s of sample(level, 60, ctx)) {
          const v = view(s)
          if (level < 16) {
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
    for (const level of [16, 17, 19, 22, 26, 31]) {
      for (const s of sample(level, 300, PHONE)) {
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
    expect(empty).toBeGreaterThan(100)
    expect(full).toBeGreaterThan(100)
  })
})

describe('Odd One Out: board and clock', () => {
  it('3×3 → 4×4 (L3) → 5×5 (L6) → 6×6 (L12) → 7×7 (L18) on a desktop; a phone stays at 5 columns', () => {
    const side = (level: number) => (level < 3 ? 3 : level < 6 ? 4 : level < 12 ? 5 : level < 18 ? 6 : 7)
    for (const level of LEVELS) {
      for (const s of sample(level, 20, DESKTOP)) expect([s.cols, s.rows], `L${level}`).toEqual([side(level), side(level)])
      for (const s of sample(level, 20, PHONE)) expect([s.cols, s.rows]).toEqual([Math.min(5, side(level)), Math.min(5, side(level))])
    }
    // A screen known to be short keeps a row for the «없음» button.
    const short = { ...DEFAULT_CONTEXT, maxCols: 7, maxRows: 5 }
    expect(make(10, 1, short).cols).toBe(5)
    expect(make(20, 1, short).cols).toBe(4)
    expect(make(20, 1, { ...short, blockRules: ['oddOneOut.absent'] }).cols).toBe(5)
  })

  it('clock ≥ 900 + 45·cells; L1 ≥ 4.5 s; boards with «없음» get 1 + 0.4·(empty share), empty or not; the plan’s spot values', () => {
    for (const ctx of SCREENS) {
      for (const level of [...LEVELS, 1.5, 7.3, 13.5, 25.75, 60, 120]) {
        for (const s of sample(level, 40, ctx)) {
          const cells = s.cols * s.rows
          const limit = oddOneOut.timeLimitMs(s)!
          const kindClock = oddOneOutLimitMs(s.kind, level, cells, { inked: s.inks.length > 0 })
          expect(kindClock).toBeGreaterThanOrEqual(900 + 45 * cells)
          // The timer bar never tells an empty board apart: the same factor on every board that
          // carries the button, so the average is the plan's (1.4× on the empty share).
          const factor = s.none ? 1 + 0.4 * oddAbsentShare(level) : 1
          expect(Math.abs(limit - factor * kindClock), `L${level} ${s.kind} absent=${s.absent}`).toBeLessThanOrEqual(1.001)
          if (level < 2) expect(limit).toBeGreaterThanOrEqual(4500)
        }
      }
    }
    // Same kind, same board, same level: an empty board's clock equals a full one's.
    for (const level of [16, 20, 24, 30]) {
      const all = chain(level, 400).filter((s) => s.kind === 'glyph')
      const boards = all.filter((s) => s.cols === all[0].cols)
      const empty = boards.filter((s) => s.absent).map((s) => s.limitMs)
      const full = boards.filter((s) => !s.absent).map((s) => s.limitMs)
      expect(empty.length > 0 && full.length > 0, `L${level}`).toBe(true)
      expect(new Set([...empty, ...full]).size, `L${level}`).toBe(1)
    }
    const near = (ms: number, s: number) => expect(Math.abs(ms / 1000 - s), `${ms} vs ${s}s`).toBeLessThanOrEqual(0.1)
    near(oddOneOutLimitMs('pop', 1, 9), 4.8)
    near(oddOneOutLimitMs('pop', 2, 9), 4.4)
    near(oddOneOutLimitMs('lookalike', 3, 16), 6.1)
    near(oddOneOutLimitMs('lookalike', 4, 16), 5.6)
    near(oddOneOutLimitMs('rotation', 5, 16), 4.5)
    near(oddOneOutLimitMs('lookalike', 6, 25), 6.4)
    near(oddOneOutLimitMs('noise', 10, 25), 5.2)
    near(oddOneOutLimitMs('mirror', 12, 25), 7.6)
  })
})

describe('Odd One Out: variety and gating', () => {
  it('never the same kind three in a row, given ctx.recent', () => {
    for (const level of [5, 6, 7, 9, 10, 12, 16, 17, 20, 24, 30]) {
      for (const kind of Object.keys(oddKindWeights(level))) {
        const recent: RecentTrial[] = [{ level, kind }, { level, kind }]
        for (let seed = 1; seed <= 150; seed++) {
          expect(oddOneOut.create(level, createRng(seed), { ...DESKTOP, recent }).kind, `L${level} after ${kind} ×2`).not.toBe(kind)
        }
      }
      const run = chain(level, 1500).map((s) => s.kind)
      for (let i = 2; i < run.length; i++) expect(run[i] === run[i - 1] && run[i] === run[i - 2], `L${level} #${i}`).toBe(false)
    }
  })

  it('with every rule blocked, no rule shows: no turned cell, no mirror, no «없음» — the level’s plain content instead', () => {
    for (const ctx of [DESKTOP, PHONE]) {
      for (const level of [...LEVELS, 5.5, 12.5, 16.5, 41]) {
        for (let seed = 1; seed <= 60; seed++) {
          const s = oddOneOut.create(level, createRng(seed), { ...ctx, blockRules: RULES, trialKind: 'placement' })
          const at = `L${level} seed ${seed} ${s.kind}`
          expect(oddOneOut.mechanics(s).filter((t) => RULES.includes(t)), at).toEqual([])
          expect(s.none || s.absent || s.mirror, at).toBe(false)
          expect(s.rotations.every((r) => r === 0), at).toBe(true)
          expect(view(s).extra).toBeUndefined()
          // Rotation falls back to look-alikes to L6, to glyphs after (no emoji from L7).
          if (level >= 5 && level < 7) expect(s.kind, at).toBe('lookalike')
          if (level >= 7) expect(['glyph', 'noise', 'twin'], at).toContain(s.kind)
        }
      }
    }
  })

  it('one rule blocked takes out that rule alone', () => {
    const boards = (block: string) => Array.from({ length: 400 }, (_, i) => oddOneOut.create(20, createRng(i + 1), { ...DESKTOP, blockRules: [block] }))
    const noMirror = boards('oddOneOut.mirror')
    expect(noMirror.some((s) => s.kind === 'mirror')).toBe(false)
    expect(noMirror.some((s) => s.absent) && noMirror.some((s) => s.kind === 'rotation')).toBe(true)
    const noNone = boards('oddOneOut.absent')
    expect(noNone.some((s) => s.none)).toBe(false)
    expect(noNone.some((s) => s.kind === 'mirror')).toBe(true)
    const noTurn = boards('oddOneOut.rotation')
    expect(noTurn.some((s) => s.kind === 'rotation')).toBe(false)
    expect(noTurn.some((s) => s.kind === 'mirror') && noTurn.some((s) => s.absent)).toBe(true)
  })
})

/**
 * A modelled check of the clock, not measured people (plan §7; recalibrate from logged medians,
 * EVIDENCE §4.5). Serial self-terminating search (Treisman & Gelade 1980; Wolfe 1998): cells are
 * looked at in random order, so the odd one is the k-th, k uniform over the cells; an empty board is
 * searched to the end and checked again (× 1.15). Time = (base + k·slope) × a spread of 0.8, 1 or
 * 1.25 (equal weights, about a lognormal of σ 0.18); a timeout is a time over the limit. The base
 * covers orienting and the tap. A slow 75-year-old is the young adult × 2.2 per cell, base 1.6 s.
 */
const SLOPE: Record<Exclude<OddKind, 'rotation'>, number> = { pop: 8, lookalike: 35, glyph: 45, noise: 50, twin: 70, mirror: 110 }
const PERSONAS = {
  young: { base: 700, perCell: 1 },
  slow75: { base: 1600, perCell: 2.2 },
} as const
const SPREAD = [0.8, 1, 1.25]

function timeoutShare(persona: keyof typeof PERSONAS, s: OddOneOutState): number {
  const p = PERSONAS[persona]
  const cells = s.cols * s.rows
  const slope = p.perCell * (s.kind === 'rotation' ? 30 + 1000 / oddTurn(s.level) : SLOPE[s.kind])
  const limit = oddOneOut.timeLimitMs(s)!
  let over = 0
  for (const f of SPREAD) {
    if (s.absent) over += (p.base + cells * slope * 1.15) * f > limit ? cells : 0
    else for (let k = 1; k <= cells; k++) over += (p.base + k * slope) * f > limit ? 1 : 0
  }
  return over / (cells * SPREAD.length)
}

const expectedTimeouts = (persona: keyof typeof PERSONAS, level: number, ctx: CreateContext) => {
  const boards = chain(level, 2000, ctx, 7)
  return boards.reduce((sum, s) => sum + timeoutShare(persona, s), 0) / boards.length
}

describe('Odd One Out: hard enough', () => {
  it('from L10 at least 70% of boards need real search: glyphs, noise, mirror, or a turn of ≤ 60°', () => {
    for (let level = 10; level <= ODD_MAX_LEVEL; level++) {
      const hard = share(chain(level, 2000), (s) => s.kind === 'glyph' || s.kind === 'twin' || s.kind === 'noise' || s.kind === 'mirror' || (s.kind === 'rotation' && oddTurn(s.level) <= 60))
      expect(hard, `L${level}`).toBeGreaterThanOrEqual(0.7)
    }
  })

  it('mirror boards are ≥ 15% of L12-19 (30% planned from L20)', () => {
    for (let level = 12; level <= 19; level++) expect(share(chain(level, 2000), (s) => s.kind === 'mirror'), `L${level}`).toBeGreaterThanOrEqual(0.15)
    for (const level of [20, 26]) expect(share(chain(level, 2000), (s) => s.kind === 'mirror'), `L${level}`).toBeGreaterThanOrEqual(0.25)
  })

  it('empty boards: 25% ± 4% from L16, a third from L22, none before', () => {
    for (const level of LEVELS) {
      const empty = share(chain(level, 2000, PHONE), (s) => s.absent)
      expect(Math.abs(empty - oddAbsentShare(level)), `L${level}: ${empty}`).toBeLessThanOrEqual(0.04)
    }
    expect(oddAbsentShare(16)).toBe(0.25)
    expect(oddAbsentShare(22)).toBeCloseTo(1 / 3)
    expect(oddAbsentShare(15)).toBe(0)
  })

  it('modelled: a young adult times out on ≥ 15% at L24; a slow 75-year-old on ≤ 7% at L1-2', () => {
    for (const ctx of [DESKTOP, PHONE]) {
      expect(expectedTimeouts('young', 24, ctx), `young L24 ${ctx.maxCols} cols`).toBeGreaterThanOrEqual(0.15)
    }
    for (const ctx of SCREENS) {
      for (const level of [1, 2]) expect(expectedTimeouts('slow75', level, ctx), `slow L${level} ${ctx.maxCols} cols`).toBeLessThanOrEqual(0.07)
    }
  })
})
