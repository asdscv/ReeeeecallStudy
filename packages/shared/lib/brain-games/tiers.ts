import type { BrainGameId } from './types'
import { QUICK_EYE_VARIANTS } from './games/quick-eye'

/**
 * Six mastery tiers per game — 브론즈 · 실버 · 골드 · 플래티넘 · 다이아 · 마스터 — set at points where
 * the puzzle itself changes (a new rule, a bigger board), so a tier says "which puzzle you play",
 * not how able you are. Per game only: never summed, averaged or compared across games (EVIDENCE:
 * no combined "brain score"), and never derived from population data.
 *
 * Thresholds are in the game's level units: speed games their level, span games level (= length − 2),
 * Quick Eye a stage index QI = (stage − 1) + min(level, 11) / 11. Every threshold sits below the
 * game's level ceiling, so every tier can be reached on every screen.
 */
export const TIER_COUNT = 6

export const TIERS: Record<BrainGameId, readonly [number, number, number, number, number, number]> = {
  // look-alikes · glyphs · colour noise · mirror · «없음» · deep clock
  oddOneOut: [3, 7, 10, 13, 17, 26],
  // 4×4 · 5×5 · alternation · reshuffle · unmarked · deep clock
  schulte: [3, 6, 10, 14, 16, 21],
  // 3 options · 6 options · cued switch · frame · clock · clock
  stroop: [3, 7, 10, 14, 20, 27],
  // sub facts · div facts · two carries · × before + · borrow across zero · two-step missing
  math: [3, 6, 10, 13, 18, 23],
  // descending · growing step · Fibonacci · mixed lines · three lines · squares/cubes
  series: [3, 6, 9, 12, 15, 20],
  // no preview · 8 pairs · look-alike · 12 pairs · L13 · triples 8
  pairs: [3, 6, 8, 11, 13, 15],
  memoryGrid: [3, 4, 6, 7, 9, 12],
  // forward 4 · forward 5 · reverse 6 · reverse 7 · reverse 8 · reverse 10
  sequence: [2, 3, 4, 5, 6, 8],
  quickEye: [1, 3, 5, 9, 12, 15.64],
}

/** Quick Eye's single number for tiers: stages first, the speed level within a stage after. Never shown. */
export function quickEyeIndex(stage: number, level: number): number {
  return Math.max(0, stage - 1) + Math.min(Math.max(level, 0), 11) / 11
}

/**
 * Quick Eye's stage as far as tiers and stage achievements count it: the stage where the puzzle on
 * screen last changed. Centre-only play (no periphery) shows the same centre task through stages
 * 1-9, so those count as one stage there; the field stages only count with the field shown.
 */
export function quickEyeTierStage(variant: number, centerOnly: boolean): number {
  const v = Math.max(1, Math.min(QUICK_EYE_VARIANTS.length, Math.round(variant)))
  if (!centerOnly) return v
  const tasks = new Set<string>()
  for (const q of QUICK_EYE_VARIANTS.slice(0, v)) tasks.add(`${q.similarity}:${q.sameDifferent}`)
  return tasks.size
}

/** The tier (0 = none yet, 1-6) a value reaches in a game. */
export function tierFor(game: BrainGameId, value: number): number {
  return TIERS[game].filter((t) => value >= t - 1e-9).length
}

/** Where a value stands toward the next tier, for a progress bar: 0-1, or null at the top. */
export function tierProgress(game: BrainGameId, value: number): { tier: number; next: number | null; frac: number } {
  const t = TIERS[game]
  const tier = tierFor(game, value)
  if (tier >= TIER_COUNT) return { tier, next: null, frac: 1 }
  const lo = tier === 0 ? (game === 'quickEye' ? 0 : 1) : t[tier - 1]
  const hi = t[tier]
  return { tier, next: hi, frac: Math.max(0, Math.min(1, (value - lo) / (hi - lo))) }
}

/**
 * A game level's position on that game's own tier anchors, 0 (start) to 6 (master) — the only
 * cross-game comparison the engine makes, used to pick a sensible first level for a game never
 * played. Computed when needed; never stored, synced or shown.
 */
export function standing(game: BrainGameId, level: number): number {
  const anchors = [game === 'quickEye' ? 0 : 1, ...TIERS[game]]
  if (level <= anchors[0]) return 0
  for (let i = 1; i < anchors.length; i++) {
    if (level <= anchors[i]) return i - 1 + (level - anchors[i - 1]) / (anchors[i] - anchors[i - 1])
  }
  return TIER_COUNT
}

/** The level in a game that sits at a given standing (the inverse of `standing`). */
export function levelAtStanding(game: BrainGameId, s: number): number {
  const anchors = [game === 'quickEye' ? 0 : 1, ...TIERS[game]]
  const clamped = Math.max(0, Math.min(TIER_COUNT, s))
  const i = Math.min(TIER_COUNT - 1, Math.floor(clamped))
  return anchors[i] + (clamped - i) * (anchors[i + 1] - anchors[i])
}
