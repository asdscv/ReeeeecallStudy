import type { CreateContext } from '../types'
import type { Rng } from '../rng'

/**
 * Which band (content table row) a trial of a banded game comes from — Quick Math, Number Pattern.
 *
 * Mostly the player's own band, with the three below mixed in for review: 55 / 25 / 12 / 8 over the
 * current band and one, two and three below (renormalised where fewer exist), never older. Never
 * the same band three times in a row; the draw makes up for that rule, so over a round the shares
 * stay the weights wherever the rule allows them (L2 can be at most 2/3 its own band). Placement
 * trials, and the first trial after the level crosses into a new band, use the current band. A
 * blocked band (an unseen rule) falls to the nearest unblocked band below.
 */
export interface BandOptions {
  /**
   * The game's bands, as their start levels in ascending order (a level belongs to the last band
   * starting at or below it) — or a count N for bands 1…N, one per level.
   */
  bands: number | readonly number[]
  /** A band whose content this trial may not use (its rule is in ctx.blockRules). */
  isBlocked?: (band: number) => boolean
  /** How the game's `trialInfo` names a band's trials, to read `ctx.recent` (default `b<band>`). */
  kindOf?: (band: number) => string
}

const WEIGHTS = [55, 25, 12, 8] as const

/**
 * Draw weights while the last two trials were not one band, for 1-4 bands in reach (current
 * first). Larger on the current band than WEIGHTS: the no-three-in-a-row rule takes draws away
 * from it, and these give them back, so the long-run shares are WEIGHTS (L2: as near as allowed).
 * Solved for the stationary shares of the last-two-bands chain; brain-choice.test.ts re-measures.
 */
const COMPENSATED: readonly (readonly number[])[] = [
  [1],
  [0.95, 0.05],
  [0.819, 0.127, 0.054],
  [0.714, 0.165, 0.073, 0.048],
]

/** The band index (into `starts`) a level falls in. */
function bandIndex(starts: readonly number[], level: number): number {
  const lv = Math.floor(level)
  let i = 0
  while (i + 1 < starts.length && starts[i + 1] <= lv) i++
  return i
}

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

/** Returns the chosen band's start level (with `bands: N`, the band number itself). */
export function pickBand(level: number, rng: Rng, ctx: Pick<CreateContext, 'trialKind' | 'recent'>, opts: BandOptions): number {
  const starts = typeof opts.bands === 'number' ? Array.from({ length: Math.max(1, Math.floor(opts.bands)) }, (_, i) => i + 1) : opts.bands
  if (starts.length === 0) return 1
  const kindOf = opts.kindOf ?? ((band: number) => `b${band}`)
  const blocked = opts.isBlocked ?? (() => false)
  const safeLevel = Number.isFinite(level) ? level : starts[0]
  const cur = bandIndex(starts, safeLevel)
  // A blocked band gives way to the nearest unblocked one below (the lowest band if all are).
  const fall = (i: number) => {
    let j = i
    while (j > 0 && blocked(starts[j])) j--
    return j
  }
  const last = ctx.recent.length > 0 ? ctx.recent[ctx.recent.length - 1] : undefined
  if (ctx.trialKind === 'placement' || (last && Math.floor(last.level) < Math.floor(safeLevel))) return starts[fall(cur)]

  // In reach: the current band and up to three below, as the bands they actually play (after a fall).
  const reach = Array.from({ length: Math.min(WEIGHTS.length, cur + 1) }, (_, k) => fall(cur - k))
  const recent = ctx.recent.slice(-2).map((r) => r.kind)
  const repeated = recent.length === 2 && recent[0] === recent[1] ? recent[0] : null
  const isRepeat = (i: number) => repeated !== null && kindOf(starts[i]) === repeated
  if (repeated !== null && reach.some(isRepeat) && !reach.every(isRepeat)) {
    // Two in a row already: anything but that band, by the plain weights.
    const weights = reach.map((i, k) => (isRepeat(i) ? 0 : WEIGHTS[k]))
    return starts[reach[drawIndex(weights, rng)]]
  }
  const weights = recent.length < 2 ? WEIGHTS.slice(0, reach.length) : COMPENSATED[reach.length - 1]
  return starts[reach[drawIndex(weights, rng)]]
}
