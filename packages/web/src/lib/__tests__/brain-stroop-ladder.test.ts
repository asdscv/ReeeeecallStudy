/**
 * Color Word's content ladder (GAMES_DIFFICULTY_PLAN §3.5). Read off the trials themselves: which
 * colours a round uses and where the buttons sit, how often the word and the ink disagree, when the
 * cue switches the rule and how early it comes, the coloured labels and the frame lure — never a
 * colour a colour-blind player could take for the stimulus ink — and a clock that moves every level.
 */
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_CONTEXT, INK_COLORS, INK_CONFUSABLE, MECHANICS, createRng, type BrainColor, type ChoiceView, type CreateContext, type RecentTrial } from '@reeeeecall/shared/lib/brain-games'
import { BRAIN_COLORS, STROOP_MAX_LEVEL, stroop, stroopBand, stroopColors, stroopLimitMs } from '@reeeeecall/shared/lib/brain-games/games/stroop'
import type { ChoiceState } from '@reeeeecall/shared/lib/brain-games/games/choice'

// Thousands of sampled trials per test: a second or three here, several times that on a CI runner,
// where the 5s default would time out.
vi.setConfig({ testTimeout: 30_000 })

const LEVELS = Array.from({ length: STROOP_MAX_LEVEL }, (_, i) => i + 1)
const BLOCK_WORD: CreateContext = { ...DEFAULT_CONTEXT, blockRules: ['stroop.word'] }
const BLOCK_LABELS: CreateContext = { ...DEFAULT_CONTEXT, blockRules: ['stroop.labelInk'] }

const make = (level: number, seed: number, ctx: CreateContext = DEFAULT_CONTEXT) => stroop.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx)
const sample = (level: number, n: number, ctx: CreateContext = DEFAULT_CONTEXT) => Array.from({ length: n }, (_, i) => make(level, i + 1, ctx))
const view = (s: ChoiceState) => stroop.view(s) as ChoiceView
const colorOf = (key: string | undefined) => (key ?? '').replace('colors.', '') as BrainColor
const wordOf = (s: ChoiceState) => colorOf(s.stimulus.textKey)
const inkOf = (s: ChoiceState) => s.stimulus.color as BrainColor
const ruleOf = (s: ChoiceState) => stroop.trialInfo!(s).kind as 'ink' | 'word'
const optionColors = (s: ChoiceState) => s.options.map((o) => colorOf(o.textKey))
const answerOf = (s: ChoiceState) => optionColors(s)[s.correctIndex]
const share = (trials: ChoiceState[], p: (s: ChoiceState) => boolean) => trials.filter(p).length / trials.length

/** A round's trials at one level, each built with the last two as `ctx.recent` — as the round builds them. */
function chain(level: number, n: number, ctx: CreateContext = DEFAULT_CONTEXT, seed = 1): ChoiceState[] {
  const rng = createRng(seed)
  const out: ChoiceState[] = []
  let recent: RecentTrial[] = []
  for (let i = 0; i < n; i++) {
    const s = stroop.create(level, rng, { ...ctx, recent })
    out.push(s)
    const info = stroop.trialInfo!(s)
    recent = [...recent, { level, kind: info.kind, carry: info.carry }].slice(-2)
  }
  return out
}

// ── The confusable-ink table, recomputed: CVD simulation (linear sRGB) → CIELAB → CIEDE2000. ──
type Mat = readonly (readonly [number, number, number])[]
const SIMULATIONS: Record<string, Mat> = {
  // Machado, Oliveira & Fernandes 2009, severity 1.0.
  protanMachado: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutanMachado: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  // Viénot, Brettel & Mollon 1999 (dichromats), in linear sRGB.
  protanVienot: [[0.11238, 0.88762, 0], [0.11238, 0.88762, 0], [0.00401, -0.00401, 1]],
  deutanVienot: [[0.29275, 0.70725, 0], [0.29275, 0.70725, 0], [-0.02234, 0.02234, 1]],
  // Machado 2009, severity 1.0 (tritanopia, about 1 in 10,000 — covered too since the 2026-11-13 palette).
  tritanMachado: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
}
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearRgb = (hex: string) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number]
const simulate = (m: Mat, c: [number, number, number]) => m.map((r) => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2]))) as [number, number, number]
function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const fx = f(x / 0.95047), fy = f(y), fz = f(z / 1.08883)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
/** CIEDE2000 (Sharma, Wu & Dalal 2005). */
function deltaE2000([l1, a1, b1]: [number, number, number], [l2, a2, b2]: [number, number, number]): number {
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
/** The smallest distance between two inks over every simulation. */
const worstDistance = (a: BrainColor, b: BrainColor) =>
  Math.min(...Object.values(SIMULATIONS).map((m) => deltaE2000(lab(simulate(m, linearRgb(INK_COLORS[a]))), lab(simulate(m, linearRgb(INK_COLORS[b]))))))
/** WCAG contrast of an ink against the white card. */
const contrastOnWhite = (hex: string) => {
  const [r, g, b] = linearRgb(hex)
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)
}

describe('Color Word: the confusable-ink table', () => {
  it('CIEDE2000 matches the published test pairs', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3)
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 3)
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 3)
    expect(deltaE2000([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(1.2644, 3)
  })

  it('INK_CONFUSABLE is what protan/deutan/tritan simulation of INK_COLORS gives (ΔE2000 < 20), symmetric', () => {
    const computed = Object.fromEntries(BRAIN_COLORS.map((a) => [a, BRAIN_COLORS.filter((b) => b !== a && worstDistance(a, b) < 20)]))
    expect(INK_CONFUSABLE).toEqual(computed)
    for (const a of BRAIN_COLORS) for (const b of INK_CONFUSABLE[a]) expect(INK_CONFUSABLE[b], `${a}-${b}`).toContain(a)
  })

  it('the palette is colour-vision safe for everyone: no pair under 21 in any simulation or in normal vision, so the table is empty', () => {
    for (const a of BRAIN_COLORS) {
      for (const b of BRAIN_COLORS.filter((x) => x !== a)) {
        expect(worstDistance(a, b), `${a}-${b}`).toBeGreaterThan(21)
        expect(deltaE2000(lab(linearRgb(INK_COLORS[a])), lab(linearRgb(INK_COLORS[b]))), `${a}-${b} normal vision`).toBeGreaterThan(21)
      }
      expect(INK_CONFUSABLE[a], a).toEqual([])
    }
    // No red, green or yellow (owner 2026-11-13: «적록색맹인데 색 자체가 너무 구분이 안됨»).
    expect(BRAIN_COLORS.slice().sort()).toEqual(['black', 'blue', 'brown', 'gray', 'orange', 'purple'])
    expect(Object.keys(INK_COLORS).sort()).toEqual(BRAIN_COLORS.slice().sort())
  })

  it('every ink reads on the white card: at least 3.5:1 (the word is 40px+, coloured labels ≥ 24px bold)', () => {
    for (const c of BRAIN_COLORS) expect(contrastOnWhite(INK_COLORS[c]), c).toBeGreaterThanOrEqual(3.5)
  })
})

describe('Color Word: the round colours and the buttons', () => {
  it('options by level: 2 · 3 · 3 · 4 · 4 · 5 · 6 …', () => {
    const counts = LEVELS.map((l) => make(l, 1).options.length)
    expect(counts.slice(0, 8)).toEqual([2, 3, 3, 4, 4, 5, 6, 6])
    expect(counts.slice(7).every((n) => n === 6)).toBe(true)
  })

  it('word and ink always come from the round subset, and the options are exactly that subset', () => {
    for (let roundSeed = 1; roundSeed <= 12; roundSeed++) {
      for (const level of [...LEVELS, 1.5, 2.99, 4.5, 6.7, 40, 120]) {
        const subset = stroopColors(roundSeed).slice(0, stroopBand(level).options)
        for (const s of chain(level, 30, { ...DEFAULT_CONTEXT, roundSeed }, roundSeed * 31 + Math.round(level))) {
          const at = `L${level} round ${roundSeed}`
          expect(subset, at).toContain(wordOf(s))
          expect(subset, at).toContain(inkOf(s))
          expect(optionColors(s).slice().sort(), at).toEqual(subset.slice().sort())
          if (s.stimulus.frame) expect(subset, at).toContain(s.stimulus.frame)
        }
      }
    }
  })

  it('the round order is a permutation fixed by the round seed, and differs between rounds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(stroopColors(seed).slice().sort()).toEqual(BRAIN_COLORS.slice().sort())
      expect(stroopColors(seed)).toEqual(stroopColors(seed))
    }
    expect(new Set(Array.from({ length: 20 }, (_, i) => stroopColors(i + 1).join(','))).size).toBeGreaterThan(10)
  })

  it('the first two round colours (all L1 shows) are never a confusable pair, and every such pair turns up', () => {
    const pairs = new Set<string>()
    for (let seed = 1; seed <= 400; seed++) {
      const [a, b] = stroopColors(seed)
      expect(INK_CONFUSABLE[a], `round ${seed}`).not.toContain(b)
      pairs.add([a, b].sort().join('|'))
    }
    // No pair is confusable, so all 15 pairs of the six colours open rounds.
    expect(pairs.size).toBe(15)
  })

  it('below L5 the buttons keep the round order (colours added at the end); from L5 they move, never to the home order', () => {
    for (let roundSeed = 1; roundSeed <= 8; roundSeed++) {
      const ctx = { ...DEFAULT_CONTEXT, roundSeed }
      const home = stroopColors(roundSeed)
      for (const level of [1, 2, 3, 4, 4.9]) {
        const n = stroopBand(level).options
        for (const s of chain(level, 20, ctx, roundSeed)) expect(optionColors(s), `L${level}`).toEqual(home.slice(0, n))
      }
      for (const level of [5, 6, 7, 12, 34]) {
        const n = stroopBand(level).options
        const orders = chain(level, 20, ctx, roundSeed).map((s) => optionColors(s).join(','))
        expect(orders, `L${level}`).not.toContain(home.slice(0, n).join(','))
        expect(new Set(orders).size, `L${level}: the buttons move`).toBeGreaterThan(5)
      }
    }
  })
})

describe('Color Word: conflict, the cued switch, carry-over', () => {
  it('conflicting share 50 / 60 / 67%, then 75 ± 3% from L4 (word trials included)', () => {
    const conflicting = (s: ChoiceState) => wordOf(s) !== inkOf(s)
    expect(Math.abs(share(sample(1, 4000), conflicting) - 0.5)).toBeLessThan(0.03)
    expect(Math.abs(share(sample(2, 4000), conflicting) - 0.6)).toBeLessThan(0.03)
    expect(Math.abs(share(sample(3, 4000), conflicting) - 2 / 3)).toBeLessThan(0.03)
    for (const level of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 26, 34]) {
      expect(Math.abs(share(sample(level, 4000), conflicting) - 0.75), `L${level}`).toBeLessThan(0.03)
      expect(Math.abs(share(sample(level, 4000, BLOCK_WORD), conflicting) - 0.75), `L${level}, word blocked`).toBeLessThan(0.03)
    }
  })

  it('word trials are never congruent', () => {
    for (const level of LEVELS.filter((l) => l >= 10)) {
      for (const s of chain(level, 300, DEFAULT_CONTEXT, level)) if (ruleOf(s) === 'word') expect(wordOf(s), `L${level}`).not.toBe(inkOf(s))
    }
  })

  it('the word is asked on 25% of trials at L10-11, 50% from L12, never before', () => {
    for (const level of LEVELS) {
      const asked = share(sample(level, 4000), (s) => ruleOf(s) === 'word')
      const want = level >= 12 ? 0.5 : level >= 10 ? 0.25 : 0
      expect(Math.abs(asked - want), `L${level}`).toBeLessThan(0.03)
    }
  })

  it('from L10 every trial has a cue that matches its rule, with a 600 / 300 / 0 ms lead; none before', () => {
    for (const level of LEVELS) {
      const lead = level >= 18 ? 0 : level >= 16 ? 300 : level >= 10 ? 600 : null
      for (const s of sample(level, 60)) {
        const at = `L${level}`
        expect(s.prompt.key, at).toBe(ruleOf(s) === 'ink' ? 'play.pickInk' : 'play.pickWord')
        if (lead === null) {
          expect(s.stimulus.cue, at).toBeUndefined()
          expect(s.leadMs, at).toBeUndefined()
          continue
        }
        expect(s.stimulus.cue, at).toBe(ruleOf(s))
        expect(s.leadMs ?? 0, at).toBe(lead)
        expect(view(s).stimulus.cue, at).toBe(ruleOf(s))
      }
    }
  })

  it('during the lead the cue is up, the word is not, and nothing can be answered', () => {
    const s = make(12, 3)
    expect(stroop.pendingMs(s)).toBe(600)
    expect(view(s).stimulus).toMatchObject({ hidden: true, cue: ruleOf(s) })
    expect(stroop.acceptsInput(s)).toBe(false)
    expect(stroop.solution(s)).toBeNull()
    const on = stroop.advance(s)
    expect(view(on).stimulus.hidden).toBeUndefined()
    expect(stroop.acceptsInput(on)).toBe(true)
    expect(stroop.solution(on)).toEqual([on.correctIndex])
    // L18: the cue and the word together.
    const together = make(18, 3)
    expect(stroop.pendingMs(together)).toBeNull()
    expect(view(together).stimulus.cue).toBe(ruleOf(together))
  })

  it('a blocked word rule leaves ink-only trials with no cue, at the same clock', () => {
    for (const level of [10, 12, 16, 20, 34]) {
      for (const s of sample(level, 200, BLOCK_WORD)) {
        expect(ruleOf(s)).toBe('ink')
        expect(s.stimulus.cue).toBeUndefined()
        expect(s.leadMs).toBeUndefined()
        expect(s.tags).not.toContain('stroop.word')
        expect(s.tags).not.toContain('stroop.switchOften')
        expect(s.limitMs).toBe(stroopLimitMs(level))
      }
    }
  })

  it('carry-over: from L9, on ≥ 40% of conflicting trials the ink is the word the trial before showed', () => {
    const carried = (level: number) => {
      const trials = chain(level, 3000, DEFAULT_CONTEXT, level)
      let hits = 0
      let conflicting = 0
      for (let i = 1; i < trials.length; i++) {
        if (wordOf(trials[i]) === inkOf(trials[i])) continue
        conflicting++
        if (inkOf(trials[i]) === wordOf(trials[i - 1])) hits++
      }
      return hits / conflicting
    }
    for (const level of [9, 10, 12, 16, 20, 34]) expect(carried(level), `L${level}`).toBeGreaterThanOrEqual(0.4)
    // Before L9 it is chance (about 1 in 6).
    expect(carried(8)).toBeLessThan(0.25)
  })
})

describe('Color Word: coloured labels and the frame lure', () => {
  it('from L8: no label in its own colour, exactly one in the stimulus ink (never the answer), the rest never confusable with it', () => {
    for (let roundSeed = 1; roundSeed <= 6; roundSeed++) {
      for (const level of LEVELS.filter((l) => l >= 8)) {
        for (const s of chain(level, 80, { ...DEFAULT_CONTEXT, roundSeed }, roundSeed * 97 + level)) {
          const at = `L${level} round ${roundSeed}`
          const ink = inkOf(s)
          const texts = optionColors(s)
          const inks = s.options.map((o) => o.color)
          expect(inks.every((c) => c !== undefined), `${at}: every label inked`).toBe(true)
          texts.forEach((t, i) => expect(inks[i], `${at}: ${t} in its own colour`).not.toBe(t))
          const lures = inks.map((c, i) => (c === ink ? i : -1)).filter((i) => i >= 0)
          expect(lures, at).toHaveLength(1)
          expect(lures[0], `${at}: the lure is the answer`).not.toBe(s.correctIndex)
          inks.forEach((c, i) => {
            if (i !== lures[0]) expect(INK_CONFUSABLE[ink], `${at}: ${c} next to ${ink}`).not.toContain(c)
          })
          expect(s.tags).toContain('stroop.labelInk')
        }
      }
    }
  })

  it('before L8, or with the rule blocked, labels are white — at the same clock', () => {
    for (const level of LEVELS) {
      for (const ctx of level >= 8 ? [BLOCK_LABELS] : [DEFAULT_CONTEXT]) {
        for (const s of sample(level, 40, ctx)) {
          expect(s.options.every((o) => o.color === undefined), `L${level}`).toBe(true)
          expect(s.tags).not.toContain('stroop.labelInk')
          expect(s.limitMs).toBe(stroopLimitMs(level))
        }
      }
    }
  })

  it('from L14 a frame in a third colour: not the ink, not the word, never confusable with the ink; none before', () => {
    for (const level of LEVELS) {
      for (const s of chain(level, 120, DEFAULT_CONTEXT, level)) {
        const frame = s.stimulus.frame
        if (level < 14) {
          expect(frame, `L${level}`).toBeUndefined()
          continue
        }
        expect(frame, `L${level}`).toBeDefined()
        expect(frame).not.toBe(inkOf(s))
        expect(frame).not.toBe(wordOf(s))
        expect(INK_CONFUSABLE[inkOf(s)]).not.toContain(frame)
        expect(frame).not.toBe(answerOf(s))
        expect(s.tags).toContain('stroop.frame')
      }
    }
  })
})

describe('Color Word: the clock', () => {
  it('follows the plan: 4.8s at L1, 5.0 at L4, 4.9 at L10, 4.1 at L14, 3.4 at L18, 3.1 at L20, 2.4 at L26, 1.6 at L34', () => {
    const table: [number, number][] = [[1, 4.8], [4, 5.0], [10, 4.9], [14, 4.1], [18, 3.4], [20, 3.1], [26, 2.4], [34, 1.6]]
    for (const [level, seconds] of table) expect(Math.abs(stroopLimitMs(level) / 1000 - seconds), `L${level}`).toBeLessThan(0.05)
    for (const level of LEVELS) for (const s of sample(level, 5)) expect(s.limitMs).toBe(stroopLimitMs(level))
  })

  it('never under 1.2s, and nothing changes past the cap', () => {
    for (const level of [...LEVELS, 1.5, 7.3, 13.5, 25.75, 40, 60, 120, 1e9]) expect(stroopLimitMs(level), `L${level}`).toBeGreaterThanOrEqual(1200)
    expect(stroop.maxLevel!(DEFAULT_CONTEXT)).toBe(34)
    expect(stroopLimitMs(120)).toBe(stroopLimitMs(34))
    expect(stroopBand(120)).toEqual(stroopBand(34))
  })

  it('every level 1-33 opens a new band, or tightens the clock by ≥ 3%', () => {
    for (let level = 1; level < STROOP_MAX_LEVEL; level++) {
      const sameBand = JSON.stringify(stroopBand(level)) === JSON.stringify(stroopBand(level + 1))
      if (!sameBand) continue
      expect(stroopLimitMs(level) / stroopLimitMs(level + 1), `L${level} → L${level + 1}`).toBeGreaterThanOrEqual(1.03)
    }
  })
})

describe('Color Word: what the round is told', () => {
  const stroopMechanics = MECHANICS.filter((m) => m.game === 'stroop')

  it('trialInfo is the rule and the word shown', () => {
    for (const level of [1, 9, 12, 20]) {
      for (const s of sample(level, 30)) expect(stroop.trialInfo!(s)).toEqual({ kind: ruleOf(s), carry: wordOf(s) })
    }
  })

  it('tags by level, and never one before its stated level', () => {
    const fromOf = (tag: string) => stroopMechanics.find((m) => m.tag === tag)?.from
    for (const level of LEVELS) {
      for (const s of sample(level, 40)) {
        const tags = s.tags ?? []
        const n = s.options.length
        expect(tags.includes(`stroop.options${n}`), `L${level}`).toBe(n >= 3)
        expect(tags.includes('stroop.shuffle')).toBe(level >= 5)
        expect(tags.includes('stroop.labelInk')).toBe(level >= 8)
        expect(tags.includes('stroop.word')).toBe(level >= 10)
        expect(tags.includes('stroop.switchOften')).toBe(level >= 12)
        expect(tags.includes('stroop.frame')).toBe(level >= 14)
        for (const tag of tags) expect(fromOf(tag), `${tag} at L${level}`).toBeLessThanOrEqual(level)
      }
    }
  })

  it('every stroop line is live, and the rules sit where the plan puts them', () => {
    expect(stroopMechanics.filter((m) => m.retired)).toEqual([])
    expect(Object.fromEntries(stroopMechanics.map((m) => [m.tag, [m.kind, m.from]]))).toEqual({
      'stroop.word': ['rule', 10],
      'stroop.options3': ['board', 2],
      'stroop.options4': ['board', 4],
      'stroop.options5': ['board', 6],
      'stroop.options6': ['board', 7],
      'stroop.shuffle': ['board', 5],
      'stroop.labelInk': ['rule', 8],
      'stroop.switchOften': ['board', 12],
      'stroop.frame': ['board', 14],
    })
  })

  it('after an ink trial, «글자 색: …» names the ink; nothing before the answer, nothing on word trials', () => {
    for (const level of [1, 8, 12, 20]) {
      for (const s0 of sample(level, 40)) {
        expect(view(s0).stimulus.reveal).toBeUndefined()
        let s = s0
        while (stroop.pendingMs(s) !== null) s = stroop.advance(s)
        const wrong = (s.correctIndex + 1) % s.options.length
        const done = view(stroop.tap(s, wrong))
        if (ruleOf(s) === 'ink') expect(done.stimulus.reveal).toEqual({ prompt: { key: 'play.inkWas', params: { color: `colors.${inkOf(s)}` } } })
        else expect(done.stimulus.reveal).toBeUndefined()
        expect(done.picked).toBe(wrong)
        expect(done.correctIndex).toBe(s.correctIndex)
      }
    }
  })
})
