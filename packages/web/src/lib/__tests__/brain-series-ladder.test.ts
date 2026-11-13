/**
 * Number Pattern's content ladder (GAMES_DIFFICULTY_PLAN §3.2). Every row is read back from what
 * the player sees — the tiles, the gap, the options — and checked: the marked option is the one
 * value every rule a player might read in the row agrees on, no distractor is explained by any of
 * them, the naive strategies (repeat the last difference, repeat the last ratio, pick a middle
 * option) fail most of the time, and the band mix, the clock and the missing-term gating hold.
 * The 2026-11-13 families (triangular numbers, ×k − c, primes, products of the two before, digit
 * sums, prime gaps) and the top band 30–31 are held to the same checks.
 */
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_CONTEXT, createRng, type ChoiceView, type CreateContext, type RecentTrial } from '@reeeeecall/shared/lib/brain-games'
import { MECHANICS } from '@reeeeecall/shared/lib/brain-games'
import { SERIES_BANDS, SERIES_MAX_LEVEL, series, seriesLimitMs, seriesPar } from '@reeeeecall/shared/lib/brain-games/games/series'
import {
  GAP_ANYWHERE,
  PRIMES,
  SERIES_FAMILIES,
  SERIES_TOP_BAND,
  SERIES_TOP_FIRST,
  buildSeriesRow,
  digitSum,
  isSeriesFamily,
  seriesExplainedBy,
  seriesReadings,
  type SeriesFamilyId,
} from '@reeeeecall/shared/lib/brain-games/games/series-rules'

// Thousands of sampled trials per test: a second or three here, several times that on a CI runner,
// where the 5s default would time out.
vi.setConfig({ testTimeout: 30_000 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

interface Trial {
  s: Any
  row: (number | null)[]
  gap: number
  /** The shown terms, the gap left out. */
  shown: number[]
  options: number[]
  answer: number
  band: number
  families: SeriesFamilyId[]
  tags: readonly string[]
  view: ChoiceView
}

function read(s: Any): Trial {
  const view = series.view(s) as ChoiceView
  const row = view.stimulus.terms as (number | null)[]
  const options = view.options.map((o) => o.value as number)
  const info = series.trialInfo!(s)
  return {
    s,
    row,
    gap: row.indexOf(null),
    shown: row.filter((t): t is number => t !== null),
    options,
    answer: options[s.correctIndex],
    band: Number(info.kind.slice(1)),
    families: (info.carry ?? '').split('+').filter(isSeriesFamily),
    tags: series.mechanics(s),
    view,
  }
}

const ctxOf = (over: Partial<CreateContext> = {}): CreateContext => ({ ...DEFAULT_CONTEXT, ...over })
const trial = (level: number, seed: number, over: Partial<CreateContext> = {}) => read(series.create(level, createRng(seed), ctxOf(over)))
/** `n` trials at one band only (placement trials come from the current band). */
const atBand = (band: number, n: number, salt = 0) => Array.from({ length: n }, (_, i) => trial(band, band * 100003 + i * 7919 + salt, { trialKind: 'placement' }))

/** A round's worth of counted trials, each told the last two (as the round does). */
function chain(level: number, n: number, salt = 0, over: Partial<CreateContext> = {}): Trial[] {
  const out: Trial[] = []
  let recent: RecentTrial[] = []
  for (let i = 0; i < n; i++) {
    const s = series.create(level, createRng(salt + i * 7919 + Math.round(level * 977)), ctxOf({ ...over, recent }))
    out.push(read(s))
    recent = [...recent, { level, ...series.trialInfo!(s) }].slice(-2)
  }
  return out
}

const LEVELS = Array.from({ length: SERIES_MAX_LEVEL }, (_, i) => i + 1)
const bandIndex = (band: number) => SERIES_BANDS.indexOf(band)
/** The band a level falls in (its start level). */
const bandOf = (level: number) => SERIES_BANDS.filter((b) => b <= Math.floor(level)).at(-1) as number
/** A trial's families by the band that brings each in (Number Pattern's "family" — ×3 and halving are one). */
const familyBands = (t: Trial) => [...new Set(t.families.map((f) => SERIES_FAMILIES[f].band))]
/** Families whose lines multiply — their tails may run to four digits. */
const MULTIPLIES: ReadonlySet<SeriesFamilyId> = new Set(['geo', 'triple', 'halve', 'dbl', 'altOps', 'altMinus', 'mixed', 'growF', 'cycle', 'product'])

/** Collects failures, so a loop over thousands of trials makes one assertion (and stays fast). */
function collect() {
  const out: string[] = []
  return {
    out,
    check(ok: boolean, msg: () => string) {
      if (!ok && out.length < 8) out.push(msg())
    },
  }
}
const SLOW = 60_000
const show = (t: Trial) => `B${t.band} ${t.families.join('+')}: ${t.row.map((x) => x ?? '?').join(', ')} [${t.options}] marked ${t.answer}`

describe('Number Pattern: every row has one answer, and it is marked', () => {
  it('readings agree on the marked option; no distractor is explained by any reading; all ≥ 0 (L1–31, 400 each)', () => {
    const c = collect()
    for (const level of [...LEVELS, 2.5, 13.75, 21.4, 27.9, 29.5, 30.8]) {
      for (const t of chain(level, 400, 11)) {
        const at = () => `L${level} ${show(t)}`
        c.check(t.row.filter((x) => x === null).length === 1, at)
        c.check(t.options.length === 4 && t.options.every((v, i) => Number.isInteger(v) && v >= 0 && (i === 0 || v > t.options[i - 1])), at)
        c.check(t.shown.every((v) => Number.isInteger(v) && v >= 0), at)
        // The one value every reading that counts gives, and some reading explains it.
        c.check(JSON.stringify(seriesReadings(t.row)) === JSON.stringify([t.answer]), at)
        c.check(seriesExplainedBy(t.row, t.answer).length > 0, at)
        for (const d of t.options) if (d !== t.answer) c.check(seriesExplainedBy(t.row, d).length === 0, () => `${at()} — ${d} explained by ${seriesExplainedBy(t.row, d)}`)
      }
    }
    expect(c.out).toEqual([])
  }, SLOW)

  it('three digits at most; geometric tails up to four', () => {
    const c = collect()
    for (const level of LEVELS) {
      for (const t of chain(level, 300, 5)) {
        const max = t.families.some((f) => MULTIPLIES.has(f)) ? 9999 : 999
        c.check([...t.shown, t.answer].every((v) => v <= max), () => show(t))
      }
    }
    expect(c.out).toEqual([])
  })

  it('the stand-in row (if every try failed) is itself a one-answer row', () => {
    const fallback = [2, 4, 6, 8, null]
    expect(seriesReadings(fallback)).toEqual([10])
  })
})

describe('Number Pattern: the band mix', () => {
  it('mostly the current band, never more than three bands below, never above; placement all current', () => {
    for (const level of [...LEVELS, 4.5, 12.3, 21.8, 26.6, 30.5]) {
      const cur = bandOf(level)
      const trials = chain(level, 1500, 3)
      const idx = trials.map((t) => bandIndex(t.band))
      expect(Math.max(...idx), `L${level}`).toBe(bandIndex(cur))
      expect(Math.min(...idx), `L${level}`).toBeGreaterThanOrEqual(Math.max(0, bandIndex(cur) - 3))
      if (level >= 4) expect(trials.filter((t) => t.band === cur).length / trials.length, `L${level} current share`).toBeGreaterThanOrEqual(0.5)
      // The current band never three times running; a band below never twice running.
      if (level >= 2) {
        expect(trials.findIndex((t, i) => i >= 2 && t.band === cur && trials[i - 1].band === cur && trials[i - 2].band === cur), `L${level}`).toBe(-1)
        expect(trials.findIndex((t, i) => i >= 1 && t.band !== cur && t.band === trials[i - 1].band), `L${level}`).toBe(-1)
      }
      expect(new Set(Array.from({ length: 100 }, (_, seed) => trial(level, seed, { trialKind: 'placement' }).band)), `L${level} placement`).toEqual(new Set([cur]))
    }
  }, SLOW)

  it('no family above 55% at any level from L4 (2.5 points for sampling noise); the long-run shares are 55/25/12/8', () => {
    for (const level of LEVELS.slice(3)) {
      const trials = chain(level, 4000, 21)
      const count = new Map<number, number>()
      for (const t of trials) for (const b of familyBands(t)) count.set(b, (count.get(b) ?? 0) + 1)
      const top = Math.max(...count.values()) / trials.length
      expect(top, `L${level}: ${[...count].map(([b, n]) => `${b}:${n}`)}`).toBeLessThanOrEqual(0.575)
      const cur = bandIndex(bandOf(level))
      const shares = [0, 1, 2, 3].map((k) => trials.filter((t) => bandIndex(t.band) === cur - k).length / trials.length)
      ;[0.55, 0.25, 0.12, 0.08].forEach((w, k) => expect(Math.abs(shares[k] - w), `L${level} band −${k}: ${shares}`).toBeLessThan(0.03))
    }
  }, SLOW)

  it('no family twice in a row unless it is the current band', () => {
    for (const level of [5, 9, 14, 21, 22, 25, 28, 31]) {
      const trials = chain(level, 1500, 23)
      const cur = bandOf(level)
      const repeats = trials.filter((t, i) => i >= 1 && t.band !== cur && familyBands(t).some((b) => familyBands(trials[i - 1]).includes(b)))
      expect(repeats.map(show), `L${level}`).toEqual([])
    }
  })

  it('the first trial after crossing into a level comes from the new band', () => {
    for (const level of [5, 13, 21, 22, 24, 28, 30]) {
      const recent: RecentTrial[] = [{ level: level - 0.2, kind: 'b1' }]
      for (let seed = 0; seed < 100; seed++) expect(trial(level + 0.1, seed, { recent }).band).toBe(bandOf(level))
    }
  })

  it('accepts any level: fractions, below 1, past the cap (31) and junk', () => {
    expect(series.maxLevel!(DEFAULT_CONTEXT)).toBe(31)
    expect(SERIES_MAX_LEVEL).toBe(31)
    expect(trial(0.2, 1, { trialKind: 'placement' }).band).toBe(1)
    expect(trial(120, 1, { trialKind: 'placement' }).band).toBe(30)
    expect(trial(Number.NaN, 1).band).toBe(1)
    expect(trial(2.99, 1, { trialKind: 'placement' }).band).toBe(2)
  })

  it('L22+ changes every two levels: bands 22, 24, 26, 28, 30, each its own content', () => {
    const bandAt = (level: number) => new Set(Array.from({ length: 40 }, (_, seed) => trial(level, seed, { trialKind: 'placement' }).band))
    for (const [level, band] of [[22, 22], [23.9, 22], [24, 24], [25.5, 24], [26, 26], [27.99, 26], [28, 28], [29.9, 28], [30, 30], [31, 30]] as const) {
      expect(bandAt(level), `L${level}`).toEqual(new Set([band]))
    }
    // 22–23 interleave two families from bands 4–12 (gap at the end); 24–25 from 9–16; 26–29 from
    // 13–20, gap anywhere; 30–31 one of the newest families (primes, products, digit sums, prime
    // gaps) under a line from 13–20.
    const pools: Record<number, [number, number]> = { 22: [4, 12], 24: [9, 16], 26: [13, 20], 28: [13, 20], 30: [12, 20] }
    for (const band of [22, 24, 26, 28, 30]) {
      const trials = atBand(band, 300, 1)
      for (const t of trials) {
        expect(t.families, show(t)).toHaveLength(2)
        expect(new Set(familyBands(t)).size, show(t)).toBe(2)
        expect(familyBands(t).every((b) => b >= pools[band][0] && b <= pools[band][1]), show(t)).toBe(true)
        if (band === SERIES_TOP_BAND) expect(t.families.some((f) => SERIES_TOP_FIRST.includes(f)), show(t)).toBe(true)
      }
      expect(trials.some((t) => t.gap < t.row.length - 1), `B${band} gap inside`).toBe(band !== 22)
      if (band === 22) expect(trials.every((t) => t.gap === t.row.length - 1)).toBe(true)
    }
    // Band 28 shows fewer terms than 26 (down to free parameters + 2).
    const mean = (band: number) => atBand(band, 400, 2).reduce((a, t) => a + t.shown.length, 0) / 400
    expect(mean(28)).toBeLessThan(mean(26))
    // Every new family turns up in the top band.
    expect(new Set(atBand(30, 400, 3).flatMap((t) => t.families.filter((f) => SERIES_TOP_FIRST.includes(f))))).toEqual(new Set(SERIES_TOP_FIRST))
  })
})

describe('Number Pattern: each band is what the plan says (placement mode)', () => {
  const BAND_FAMILY: Record<number, SeriesFamilyId[]> = {
    1: ['up'], 2: ['up2'], 3: ['down'], 4: ['geo'], 5: ['alt'], 6: ['grow', 'tri'], 7: ['triple', 'halve'], 8: ['inter'], 9: ['fib'], 10: ['dbl'],
    11: ['altOps', 'altMinus'], 12: ['mixed', 'prime'], 13: ['growF'], 14: ['trib', 'product'], 15: ['three'], 16: ['diffGrow'], 17: ['cycle', 'digitSum'],
    18: ['diffLines'], 19: ['diffFib', 'diffPrime'], 20: ['square', 'cube'],
  }

  it('≥ 50 distinct rows per band, every band its own family', () => {
    for (const band of SERIES_BANDS) {
      const trials = atBand(band, 600)
      expect(new Set(trials.map((t) => series.signature(t.s))).size, `B${band}`).toBeGreaterThanOrEqual(50)
      expect(trials.every((t) => t.band === band)).toBe(true)
      if (BAND_FAMILY[band]) expect(new Set(trials.flatMap((t) => t.families)), `B${band}`).toEqual(new Set(BAND_FAMILY[band]))
      if (band === 21) expect(trials.every((t) => t.families.length === 1 && SERIES_FAMILIES[t.families[0]].band >= 9)).toBe(true)
    }
  })

  it('each row reads as its family (checked on the numbers shown)', () => {
    const c = collect()
    const diffs = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i])
    const every = (xs: number[], k: number, r: number) => xs.filter((_, i) => i % k === r)
    const constant = (xs: number[]) => xs.every((x) => x === xs[0])
    const consecutivePrimes = (xs: number[]) => {
      const j0 = PRIMES.indexOf(xs[0])
      return j0 >= 0 && xs.every((x, i) => PRIMES[j0 + i] === x)
    }
    // The 2026-11-13 families, each read on its own numbers.
    const NEW: Partial<Record<SeriesFamilyId, (full: number[], d: number[], t: Trial) => boolean>> = {
      prime: (full, _d, t) => consecutivePrimes(full) && full[0] <= 41 && t.shown.length >= 4,
      product: (full) => full.every((x, i) => i < 2 || x === full[i - 1] * full[i - 2]) && full[0] >= 2 && full[1] >= 2,
      digitSum: (full, d) => full.every((x, i) => i === 0 || x === full[i - 1] + digitSum(full[i - 1])) && full[0] >= 10 && new Set(d).size >= 3,
      diffPrime: (_full, d, t) => consecutivePrimes(d) && t.shown.length >= 5,
    }
    for (const band of SERIES_BANDS.slice(0, 20)) {
      for (const t of atBand(band, 300, 3)) {
        const full = t.row.map((x) => x ?? t.answer)
        const d = diffs(full)
        const own = NEW[t.families[0]]
        if (own) {
          c.check(own(full, d, t), () => show(t))
          continue
        }
        const ok: Record<number, () => boolean> = {
          1: () => constant(d) && d[0] >= 1 && d[0] <= 3 && t.shown.length === 4,
          2: () => constant(d) && d[0] >= 4 && d[0] <= 12 && full[0] >= 10 && full[0] <= 99,
          3: () => constant(d) && d[0] < 0,
          4: () => full.every((x, i) => i === 0 || x === 2 * full[i - 1]) && full[0] <= 30 && t.shown.length >= 4 && t.shown.length <= 5,
          5: () => constant(every(d, 2, 0)) && constant(every(d, 2, 1)) && Math.sign(d[0]) !== Math.sign(d[1]),
          6: () => constant(diffs(d)) && [1, 2].includes(diffs(d)[0]) && t.shown.length >= 5,
          7: () => full.every((x, i) => i === 0 || x === 3 * full[i - 1]) || full.every((x, i) => i === 0 || 2 * x === full[i - 1]),
          8: () => constant(diffs(every(full, 2, 0))) && constant(diffs(every(full, 2, 1))) && diffs(every(full, 2, 0))[0] !== diffs(every(full, 2, 1))[0],
          9: () => full.every((x, i) => i < 2 || x === full[i - 1] + full[i - 2]) && full[0] <= 15 && full[1] <= 15,
          10: () => {
            const c0 = full[1] - 2 * full[0]
            return full.every((x, i) => i === 0 || x === 2 * full[i - 1] + c0) && c0 !== 0 && c0 >= -3 && c0 <= 5 && d.every((x) => x > 0)
          },
          11: () => [0, 1].some((r) => every(d, 2, r).every((_, j) => full[2 * j + r + 1] === 2 * full[2 * j + r]) && constant(every(d, 2, 1 - r))),
          12: () => [0, 1].some((r) => every(full, 2, r).every((x, i, xs) => i === 0 || x === 2 * xs[i - 1] || x === 3 * xs[i - 1]) && constant(diffs(every(full, 2, 1 - r)))),
          13: () => {
            const ratios = full.slice(1).map((x, i) => x / full[i])
            return ratios.every((r, i) => i === 0 || r === ratios[i - 1] + 1) && ratios[0] >= 2 && ratios[0] <= 4
          },
          14: () => full.every((x, i) => i < 3 || x === full[i - 1] + full[i - 2] + full[i - 3]),
          15: () => [0, 1, 2].every((r) => constant(diffs(every(full, 3, r)))) && new Set([0, 1, 2].map((r) => diffs(every(full, 3, r))[0])).size === 3,
          16: () => constant(diffs(diffs(d))) && !constant(diffs(d)) && t.shown.length >= 6,
          // A cycle of three steps: each step the same every time it comes round (adding or multiplying).
          17: () =>
            [0, 1, 2].every((r) => {
              const steps = full.slice(0, -1).map((x, i) => [x, full[i + 1]] as const).filter((_, i) => i % 3 === r)
              const [a0, b0] = steps[0]
              return steps.every(([a, b]) => b - a === b0 - a0) || steps.every(([a, b]) => b * a0 === a * b0)
            }),
          18: () => {
            const [a, b] = [diffs(every(d, 2, 0)), diffs(every(d, 2, 1))]
            return constant(a) && constant(b) && a[0] + b[0] !== 0 && a[0] !== b[0]
          },
          19: () => d.every((x, i) => i < 2 || x === d[i - 1] + d[i - 2]),
          20: () => [2, 3].some((e) => Array.from({ length: 13 }, (_, n0) => n0).some((n0) => full.every((x, i) => x - (n0 + i) ** e === full[0] - n0 ** e))),
        }
        c.check(ok[band](), () => show(t))
      }
    }
    expect(c.out).toEqual([])
  })

  it('shown terms ≥ free parameters + 2; growing-step rows show at least 5', () => {
    const c = collect()
    for (const band of SERIES_BANDS) {
      for (const t of atBand(band, 300, 4)) {
        const params = t.families.reduce((a, f) => a + SERIES_FAMILIES[f].params, 0)
        c.check(t.shown.length >= params + 2, () => `${show(t)}: ${t.shown.length} shown, ${params} parameters`)
        if (t.families.includes('grow') && t.families.length === 1) c.check(t.shown.length >= 5, () => show(t))
      }
    }
    expect(c.out).toEqual([])
  })
})

/** The option a strategy picks: the one equal to its guess, else the nearest (ties: the lower). */
function pickNearest(options: number[], guess: number): number {
  let best = 0
  for (let i = 1; i < options.length; i++) if (Math.abs(options[i] - guess) < Math.abs(options[best] - guess)) best = i
  return best
}

/** Two shown terms next to the gap, nearest first (left side if it has two). */
function besideGap(t: Trial): [number, number] | null {
  const r = t.row
  const g = t.gap
  if (g >= 2) return [r[g - 1] as number, r[g - 2] as number]
  if (g + 2 < r.length) return [r[g + 1] as number, r[g + 2] as number]
  return null
}

describe('Number Pattern: hard enough', () => {
  it('from band 4 the naive strategies score ≤ 35%: last term + last difference, last term × last ratio, a middle option', () => {
    const strategies: Record<string, (t: Trial, i: number) => number> = {
      lastDifference: (t) => {
        const b = besideGap(t)
        return b ? pickNearest(t.options, 2 * b[0] - b[1]) : 0
      },
      lastRatio: (t) => {
        const b = besideGap(t)
        return b && b[1] !== 0 ? pickNearest(t.options, (b[0] * b[0]) / b[1]) : 0
      },
      middle: (_t, i) => 1 + (i % 2),
    }
    const scores: string[] = []
    for (const band of SERIES_BANDS.slice(3)) {
      const trials = atBand(band, 1000, 6)
      for (const [name, pick] of Object.entries(strategies)) {
        // Where repeating the ratio IS the band's rule (×2; ×3 or halving), that strategy is the rule.
        if (name === 'lastRatio' && (band === 4 || band === 7)) continue
        const score = trials.filter((t, i) => pick(t, i) === t.s.correctIndex).length / trials.length
        if (score > 0.35) scores.push(`B${band} ${name}: ${score}`)
      }
    }
    expect(scores).toEqual([])
  }, SLOW)

  it("the answer's position is near-uniform in every band from 4 (placement mode, 2000 each, 25% ± 4%)", () => {
    for (const band of SERIES_BANDS.slice(3)) {
      const at = [0, 0, 0, 0]
      for (const t of atBand(band, 2000, 8)) at[t.s.correctIndex]++
      for (const n of at) expect(Math.abs(n / 2000 - 0.25), `B${band}: ${at}`).toBeLessThan(0.04)
    }
  }, SLOW)
})

describe('Number Pattern: the clock', () => {
  it('pars: bands 1–3 15 s, 4–12 16 s, 13–20 18 s, 21+ 20 s', () => {
    expect(SERIES_BANDS.map(seriesPar)).toEqual(SERIES_BANDS.map((b) => (b <= 3 ? 15000 : b <= 12 ? 16000 : b <= 20 ? 18000 : 20000)))
  })

  it("limit = the trial's band par × (1.15 − 0.35·frac(L)); bands 1–3 never under 14.8 s; no other floor", () => {
    for (const level of [1, 1.5, 2.99, 3.4, 4, 4.75, 12.25, 13.5, 20.9, 21, 23.5, 27.99, 28, 29.5, 31]) {
      const frac = level - Math.floor(level)
      const wrong = chain(level, 200, 17).filter((t) => {
        const raw = Math.round(seriesPar(t.band) * (1.15 - 0.35 * frac))
        const want = t.band <= 3 ? Math.max(14800, raw) : raw
        return series.timeLimitMs(t.s) !== want || seriesLimitMs(t.band, level) !== want
      })
      expect(wrong.map((t) => `L${level} B${t.band}: ${t.s.limitMs}`)).toEqual([])
    }
    expect(seriesLimitMs(2, 2.99)).toBe(14800)
    expect(seriesLimitMs(13, 13.99)).toBe(Math.round(18000 * (1.15 - 0.35 * 0.99)))
  })
})

describe('Number Pattern: the missing term', () => {
  it('with series.missingTerm blocked no row has a gap inside, and the tag never appears', () => {
    for (const level of [21, 21.5, 22, 24, 25.5, 26, 28, 30.5]) {
      for (const trialKind of ['counted', 'placement', 'intro'] as const) {
        const leaked = chain(level, 200, 19, { blockRules: ['series.missingTerm'], trialKind }).filter((t) => t.gap !== t.row.length - 1 || t.tags.includes('series.missingTerm'))
        expect(leaked.map(show), `L${level} ${trialKind}`).toEqual([])
      }
    }
  })

  it('unblocked, the gap sits anywhere from band 21 — tagged, and asked as «which number fills the gap»', () => {
    const trials = atBand(21, 600, 9)
    const positions = new Set(trials.map((t) => t.gap / (t.row.length - 1)))
    expect(trials.some((t) => t.gap === 0)).toBe(true)
    expect(positions.size).toBeGreaterThan(10)
    for (const t of trials) {
      const inside = t.gap < t.row.length - 1
      expect(t.tags.includes('series.missingTerm'), show(t)).toBe(inside)
      expect(t.view.prompt.key, show(t)).toBe(inside ? 'play.missingTerm' : 'play.nextNumber')
    }
  })

  it('never below its level: no gap inside before band 21', () => {
    for (const level of [1, 8, 15, 20, 20.99]) for (const t of chain(level, 300, 2)) expect(t.gap, show(t)).toBe(t.row.length - 1)
  })
})

describe('Number Pattern: what the player sees', () => {
  it('tags: each family its own (from its band on), interleaving for two-family rows', () => {
    const c = collect()
    for (const band of SERIES_BANDS) {
      for (const t of atBand(band, 100, 5)) {
        const want = new Set(t.families.map((f) => SERIES_FAMILIES[f].tag).filter((x): x is string => x !== undefined))
        if (t.families.length > 1) want.add('series.interleaved')
        if (t.gap < t.row.length - 1) want.add('series.missingTerm')
        c.check(JSON.stringify([...t.tags].sort()) === JSON.stringify([...want].sort()), () => `${show(t)}: ${t.tags}`)
      }
    }
    expect(c.out).toEqual([])
  })

  it('the reveal comes after the answer: gap labels per tile, the lines coloured, the gap worked out', () => {
    const c = collect()
    for (const band of SERIES_BANDS) {
      for (const t of atBand(band, 60, 7)) {
        c.check(t.view.stimulus.reveal === undefined, () => show(t))
        const done = series.tap(t.s, t.s.correctIndex)
        const reveal = (series.view(done) as ChoiceView).stimulus.reveal!
        c.check(reveal.gaps!.length === t.row.length && reveal.gaps![t.row.length - 1] === '', () => `${show(t)} ${reveal.gaps}`)
        c.check(reveal.gaps!.slice(0, -1).filter((g) => g !== '').every((g) => /^([+−×÷]\d+|×\d[+−]\d)$/.test(g)), () => `${show(t)} ${reveal.gaps}`)
        if (t.families.length > 1 || ['inter', 'mixed', 'three'].includes(t.families[0])) c.check(reveal.groups !== undefined && new Set(reveal.groups).size >= 2, () => show(t))
        // The gap worked out — or, for a prime, the rule named (a prime has no step to work out).
        const gapIsPrime = (t.families.length > 1 ? t.families[t.gap % 2] : t.families[0]) === 'prime'
        if (gapIsPrime) c.check(reveal.lines === undefined && reveal.prompt?.key === 'mechanics.series.primes.title', () => `${show(t)} ${JSON.stringify(reveal)}`)
        else c.check(reveal.lines !== undefined && reveal.lines[0].endsWith(`= ${t.answer}`) && reveal.prompt === undefined, () => `${show(t)} ${reveal.lines}`)
      }
    }
    expect(c.out).toEqual([])
  })

  it('options carry their values, ascending; the row is tiles with one gap; trialInfo names the band and families', () => {
    const t = trial(9, 3, { trialKind: 'placement' })
    expect(t.view.options.every((o) => o.value !== undefined && o.text === String(o.value))).toBe(true)
    expect(t.view.stimulus.text).toBe(t.row.map((x) => x ?? '?').join(', '))
    expect(series.trialInfo!(t.s)).toEqual({ kind: 'b9', carry: 'fib' })
  })

  it('the stand-in row is used only if a band fails 200 tries — never in 300 rows of any band', () => {
    for (const band of SERIES_BANDS.slice(1)) {
      for (let i = 0; i < 300; i++) {
        const spec = buildSeriesRow(band, band, createRng(band * 7 + i), { gapInside: GAP_ANYWHERE.has(band) })
        expect(spec.families[0] === 'up' && spec.terms.join() === '2,4,6,8,10', `B${band} seed ${i}`).toBe(false)
      }
    }
  })
})

describe('Number Pattern: the 2026-11-13 families (owner «더 다양한 규칙»)', () => {
  it('each new rule is read where it holds — and two shown terms alone are no reading', () => {
    expect(seriesReadings([2, 3, 5, 7, null])).toEqual([11])
    expect(seriesReadings([13, 17, 19, 23, null])).toEqual([29])
    expect(seriesReadings([11, 13, null, 19, 23])).toEqual([17])
    expect(seriesReadings([2, 3, 6, 18, null])).toEqual([108])
    expect(seriesReadings([2, null, 6, 18, 108])).toEqual([3])
    expect(seriesReadings([19, 29, 40, 44, null])).toEqual([52])
    expect(seriesReadings([1, 3, 6, 11, 18, null])).toEqual([29])
    expect(seriesReadings([1, 3, 6, 10, 15, null])).toEqual([21])
    expect(seriesReadings([9, 18, 15, 30, 27, null])).toEqual([54])
    expect(seriesExplainedBy([2, 3, 5, 7, null], 11)).toContain('primes')
    expect(seriesExplainedBy([2, 3, 6, 18, null], 108)).toContain('product')
    expect(seriesExplainedBy([19, 29, 40, 44, null], 52)).toContain('digitSum')
    expect(seriesExplainedBy([1, 3, 6, 11, 18, null], 29)).toContain('diffPrimes')
    // Two primes, two terms a digit sum apart: not enough to read a rule from.
    expect(seriesReadings([5, 7, null])).toEqual([])
    expect(seriesReadings([12, 15, null])).toEqual([])
  })

  it('every family is reachable, 28 in all, and each new tag is told from the band that brings it', () => {
    const reached = new Set<SeriesFamilyId>()
    for (const band of SERIES_BANDS) for (const t of atBand(band, 200, 13)) for (const f of t.families) reached.add(f)
    expect(reached).toEqual(new Set(Object.keys(SERIES_FAMILIES)))
    expect(reached.size).toBe(28)
    const from = Object.fromEntries(MECHANICS.filter((m) => m.game === 'series').map((m) => [m.tag, m.from]))
    for (const f of Object.values(SERIES_FAMILIES)) if (f.tag) expect(from[f.tag], `${f.id} ${f.tag}`).toBeLessThanOrEqual(f.band)
    expect([from['series.primes'], from['series.product'], from['series.digitSum'], from['series.diffPrimes']]).toEqual([12, 14, 17, 19])
    for (const tag of ['series.primes', 'series.product', 'series.digitSum', 'series.diffPrimes']) expect(MECHANICS.find((m) => m.tag === tag)).toMatchObject({ kind: 'board', copy: tag })
  })

  it('the reveal: a product steps by × the term two back; a digit sum works the digits out', () => {
    const products = atBand(14, 300, 17).filter((t) => t.families[0] === 'product')
    const sums = atBand(17, 300, 17).filter((t) => t.families[0] === 'digitSum')
    expect(products.length).toBeGreaterThan(50)
    expect(sums.length).toBeGreaterThan(50)
    for (const t of products) {
      const full = t.row.map((x) => x ?? t.answer)
      const reveal = (series.view(series.tap(t.s, t.s.correctIndex)) as ChoiceView).stimulus.reveal!
      for (let i = 1; i + 1 < full.length; i++) expect(reveal.gaps![i], show(t)).toBe(`×${full[i - 1]}`)
      expect(reveal.lines![0], show(t)).toBe(`${full.at(-3)} × ${full.at(-2)} = ${t.answer}`)
    }
    for (const t of sums) {
      const reveal = (series.view(series.tap(t.s, t.s.correctIndex)) as ChoiceView).stimulus.reveal!
      const before = t.row.at(-2) as number
      expect(reveal.lines![0], show(t)).toBe(`${before} + ${String(before).split('').join(' + ')} = ${t.answer}`)
    }
  })
})
