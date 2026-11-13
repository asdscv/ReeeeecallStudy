import type { CreateContext } from '../types'
import type { Rng } from '../rng'
import { choiceGame, nearMissOptions } from './choice'
import { GAP_ANYWHERE, SERIES_FAMILIES, buildSeriesRow, isSeriesFamily, seriesReveal, seriesTags, seriesWrongs } from './series-rules'

/**
 * A number pattern with one term missing. Inductive reasoning.
 *
 * The level picks a band of the content ladder (series-rules.ts): each band brings a rule family
 * — falling rows, ×2, alternating steps, growing steps and triangular numbers, interleaved lines,
 * the two before added, primes, products, digit sums, prime gaps … — then the gap moves inside the
 * row (21), then two families are interleaved (22–29), and at the top (30–31) one of the newest
 * families sits under a second hard line. Every row is checked against every rule a player might
 * read in it and kept only when they all agree, and the wrong options are what plausible wrong
 * rules give.
 *
 * Most trials come from the player's own band, the three below mixed in for review; no band below
 * the current one comes twice in a row, and the current one never three times. Each band has its
 * own clock; the level's fraction tightens it.
 */

export const SERIES_MAX_LEVEL = 31
/** Band start levels: one per level to 21, then one every two levels (the top band 30–31). */
export const SERIES_BANDS: readonly number[] = [...Array.from({ length: 21 }, (_, i) => i + 1), 22, 24, 26, 28, 30]

/** Shares over the current band and one, two and three below (renormalised where fewer exist). */
const WEIGHTS = [55, 25, 12, 8] as const
/**
 * Draw weights once a trial has a history, for 1–4 bands in reach (current first): larger on the
 * current band than WEIGHTS, because the variety rules (no lower band twice running, the current
 * band never three times) take draws from it. Solved for the stationary shares of the
 * last-two-bands chain, so over a round the shares are WEIGHTS — at L2 as near as the rules allow
 * (at most 2/3). brain-series-ladder.test.ts measures them.
 */
const COMPENSATED: readonly (readonly number[])[] = [[1], [0.9, 0.1], [0.7235, 0.1946, 0.0819], [0.6275, 0.2224, 0.0913, 0.0588]]

const clampLevel = (level: number) => (Number.isFinite(level) ? Math.min(SERIES_MAX_LEVEL, Math.max(1, level)) : 1)

/** The index (into SERIES_BANDS) of the band a level falls in. */
function bandIndex(level: number): number {
  const lv = Math.floor(clampLevel(level))
  let i = 0
  while (i + 1 < SERIES_BANDS.length && SERIES_BANDS[i + 1] <= lv) i++
  return i
}

const familiesOf = (carry: string | undefined) => (carry ?? '').split('+').filter(isSeriesFamily)

function drawIndex(weights: readonly number[], rng: Rng): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0 && weights[i] > 0) return i
  }
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i
  return 0
}

/**
 * The band (its start level) this trial comes from. Placement and practice trials, and the first
 * trial after the level crosses a whole number, use the current band.
 */
export function seriesBand(level: number, rng: Rng, ctx: Pick<CreateContext, 'trialKind' | 'recent'>): number {
  const cur = bandIndex(level)
  const recent = ctx.recent ?? []
  const last = recent.length > 0 ? recent[recent.length - 1] : undefined
  const prev = recent.length > 1 ? recent[recent.length - 2] : undefined
  if (ctx.trialKind === 'placement' || ctx.trialKind === 'practice' || (last && Math.floor(last.level) < Math.floor(clampLevel(level)))) return SERIES_BANDS[cur]

  const reach = Array.from({ length: Math.min(WEIGHTS.length, cur + 1) }, (_, k) => cur - k)
  const kindOf = (i: number) => `b${SERIES_BANDS[i]}`
  const lastBands = new Set(familiesOf(last?.carry).map((f) => SERIES_FAMILIES[f].band))
  const blocked = (k: number) => {
    const i = reach[k]
    // The current band: never three in a row. A band below: never twice in a row, nor the band of
    // a family the last trial used.
    if (k === 0) return reach.length > 1 && last?.kind === kindOf(i) && prev?.kind === kindOf(i)
    return last?.kind === kindOf(i) || lastBands.has(SERIES_BANDS[i])
  }
  const base = recent.length === 0 ? WEIGHTS.slice(0, reach.length) : COMPENSATED[reach.length - 1]
  const weights = base.map((w, k) => (blocked(k) ? 0 : w))
  return SERIES_BANDS[reach[weights.some((w) => w > 0) ? drawIndex(weights, rng) : 0]]
}

/** The band's par: 15 s for the first three bands, 16 s to band 12, 18 s to band 20, then 20 s. */
export function seriesPar(band: number): number {
  return band <= 3 ? 15000 : band <= 12 ? 16000 : band <= 20 ? 18000 : 20000
}

/** Limit = the trial's band par × (1.15 − 0.35·frac(L)); the first three bands never under 14.8 s. */
export function seriesLimitMs(band: number, level: number): number {
  const lv = clampLevel(level)
  const ms = Math.round(seriesPar(band) * (1.15 - 0.35 * (lv - Math.floor(lv))))
  return band <= 3 ? Math.max(14800, ms) : ms
}

export const series = choiceGame(
  'series',
  (level, rng, ctx) => {
    const lv = clampLevel(level)
    const recent = ctx.recent ?? []
    const band = seriesBand(lv, rng, { trialKind: ctx.trialKind ?? 'counted', recent })
    const last = recent.length > 0 ? recent[recent.length - 1] : undefined
    // An unseen missing-term rule keeps the gap at the end (the same row otherwise).
    const gapInside = GAP_ANYWHERE.has(band) && !(ctx.blockRules ?? []).includes('series.missingTerm')
    const spec = buildSeriesRow(band, lv, rng, { gapInside, avoid: new Set(familiesOf(last?.carry)) })
    const choice = nearMissOptions(
      spec.answer,
      seriesWrongs(spec).map((v) => ({ v })),
      rng,
    )
    const terms = spec.terms.map((t, i) => (i === spec.gap ? null : t))
    const text = terms.map((t) => t ?? '?').join(', ')
    return {
      prompt: { key: spec.gap < spec.terms.length - 1 ? 'play.missingTerm' : 'play.nextNumber' },
      stimulus: { text, terms },
      options: choice.options.map((v) => ({ text: String(v), value: v })),
      correctIndex: choice.correctIndex,
      limitMs: seriesLimitMs(band, lv),
      picked: null,
      timedOut: false,
      sig: `se:${text}`,
      tags: seriesTags(spec),
      reveal: seriesReveal(spec),
      info: { kind: `b${band}`, carry: spec.families.join('+') },
    }
  },
  { maxLevel: SERIES_MAX_LEVEL },
)
