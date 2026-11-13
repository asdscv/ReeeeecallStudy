import type { BrainGameId, GameGroup } from './types'
import type { BrainMeta, SkillEstimate } from './meta'
import { GROUP_RULES } from './rules'
import { brainGame, isBrainGameId } from './catalog'
import { TIERS, levelAtStanding, standing } from './tiers'

/**
 * Each game's skill estimate with its uncertainty — the part of the game logic that makes a level
 * follow the player instead of resetting.
 *
 * - The staircase still decides every step and still converges to its evidence-based target
 *   (S_up·p = S_down·(1−p), Kaernbach 1991). Uncertainty only scales BOTH steps by k, so the ratio
 *   — and the target — is unchanged: big steps while unsure, small once settled. This replaces the
 *   fixed "first 8 trials ×2" warm-up with the Kesten / PEST idea that steps shrink as reversals
 *   accumulate (Kesten 1958; Taylor & Creelman 1967).
 * - Uncertainty grows with days away (Glicko's rating-deviation rule, Glickman 1999), slower than a
 *   reset because trained-task skill lasts (Rebok 2014): a returning player re-finds their level
 *   in a few trials and is never told "your level dropped".
 * - The round's own estimate is the mean of its last reversal levels (Levitt 1971), not the level
 *   it happened to stop at — so a round that ends on a miss no longer restarts the next one low.
 */
export interface SkillParams {
  /** Uncertainty with nothing known. */
  sd0: number
  /** Uncertainty once settled — steps are at their base size here. */
  floor: number
  /** Largest step multiplier. */
  kMax: number
  /** Uncertainty growth per √day away. */
  c: number
  /** How far below the estimate the next round starts. */
  drop: number
}

export const SKILL: Record<GameGroup, SkillParams> = {
  speed: { sd0: 9, floor: 1.0, kMax: 3, c: 0.3, drop: 0.5 },
  // Span games move one whole length per pass (Corsi); no step scaling.
  span: { sd0: 3, floor: 1, kMax: 1, c: 0.15, drop: 2 },
}

/** A known player without a stored estimate yet (progress from before estimates): one doubling to start. */
export function legacySd(group: GameGroup): number {
  return SKILL[group].floor * Math.min(2, SKILL[group].kMax)
}

/** How much both steps are scaled: 1 once settled, up to `kMax` (the group's, or a game's own — catalog `steps`) while unsure. */
export function stepMultiplier(group: GameGroup, sd: number, kMax: number = SKILL[group].kMax): number {
  const p = SKILL[group]
  return Math.max(1, Math.min(kMax, sd / p.floor))
}

/** After a judged trial: a little surer every trial, a lot surer at a reversal. */
export function shrinkSd(group: GameGroup, sd: number, reversal: boolean): number {
  const p = SKILL[group]
  return Math.max(p.floor, sd * (reversal ? 0.7 : 0.92))
}

/**
 * The uncertainty after a counted trial. A speed-group run of 4 or more right answers in a row says
 * the level is still too low, so it re-opens a little (×1.1, never past sd0) and the steps grow
 * with it; everything else shrinks it. Only upward runs: holding on downward runs too pushed a
 * slow player down to L1.3-1.6 in simulation.
 */
export function nextSd(group: GameGroup, sd: number, reversal: boolean, upRun: number): number {
  if (group === 'speed' && upRun >= 4) return Math.min(SKILL[group].sd0, sd * 1.1)
  return shrinkSd(group, sd, reversal)
}

/** Uncertainty after `days` away. */
export function sdAfterDays(group: GameGroup, sd: number, days: number): number {
  const p = SKILL[group]
  if (days <= 0) return sd
  return Math.min(p.sd0, Math.sqrt(sd * sd + p.c * p.c * days))
}

/** The round's estimate: the mean of its last (up to 6) reversal levels, when there were at least 4. */
export function roundEstimate(reversals: readonly number[]): number | null {
  if (reversals.length < 4) return null
  const tail = reversals.slice(-6)
  return tail.reduce((a, b) => a + b, 0) / tail.length
}

/**
 * Where the next round starts. Not from where the last one happened to stop, and never back to the
 * floor: the estimate minus a little (more when unsure); a strong cleared round keeps it.
 */
export function startFromEstimate(group: GameGroup, mu: number, sd: number, opts: { momentum?: boolean; mercy?: boolean } = {}): number {
  const p = SKILL[group]
  const rules = GROUP_RULES[group]
  let start = opts.momentum ? mu : mu - Math.max(p.drop, 0.5 * sd)
  // The mercy rule: after rounds in a row that ended early on chances, one easier step more.
  if (opts.mercy) start -= group === 'span' ? 1 : rules.down
  return Math.max(rules.min, start)
}

/**
 * A first level for a game never played, from how the player stands in games they have played —
 * shrunk toward the start on purpose (ρ 0.6 for a game of the same kind, 0.4 otherwise), and capped
 * at the game's Silver tier. Null when nothing is known yet. Never stored, synced or shown.
 */
export function crossGameSeed(meta: BrainMeta, target: BrainGameId): number | null {
  const targetRole = brainGame(target).role
  const samples: { s: number; rho: number }[] = []
  for (const [id, est] of Object.entries(meta.sk) as [string, SkillEstimate][]) {
    // Games in the catalogue only: an old save can still hold a removed game's estimate (Quick Eye's
    // was a speed level within a stage, never a level on a tier scale), which never seeds one.
    if (id === target || !isBrainGameId(id) || !est || est.n < 20) continue
    const sameKind = brainGame(id).role === targetRole || (isSpeedKind(id) && isSpeedKind(target))
    samples.push({ s: standing(id, est.mu), rho: sameKind ? 0.6 : 0.4 })
  }
  if (samples.length === 0) return null
  const meanS = samples.reduce((a, x) => a + x.s, 0) / samples.length
  const rho = samples.reduce((a, x) => a + x.rho, 0) / samples.length
  const s = Math.max(0, rho * meanS - 0.5)
  return Math.min(TIERS[target][1], levelAtStanding(target, s))
}

const isSpeedKind = (id: BrainGameId) => id === 'oddOneOut' || id === 'schulte'
