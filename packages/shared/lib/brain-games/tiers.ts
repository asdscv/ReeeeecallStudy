import type { BrainGameId } from './types'

/**
 * Six mastery tiers per game — 브론즈 · 실버 · 골드 · 플래티넘 · 다이아 · 마스터 — set at points where
 * the puzzle itself changes (a new rule, a bigger board), so a tier says "which puzzle you play",
 * not how able you are. Per game only: never summed, averaged or compared across games (EVIDENCE:
 * no combined "brain score"), and never derived from population data.
 *
 * Thresholds are in the game's level units: speed games their level, span games level (Flash Grid
 * cells − 2; Sequence a row of its ladder, length − 2 up to L5).
 * Every threshold sits below the game's level ceiling, so every tier can be reached on every screen.
 */
export const TIER_COUNT = 6

export const TIERS: Record<BrainGameId, readonly [number, number, number, number, number, number]> = {
  // look-alikes · letters · mirror · mirror and twins in colour noise · «없음» · 7×7 / deep clock —
  // the first five are content tiers' first levels, their 2×2 boards (games/odd-one-out.ts)
  oddOneOut: [6, 11, 16, 21, 26, 31],
  // 4×4 · 5×5 · alternation · reshuffle · unmarked · deep clock
  schulte: [3, 6, 10, 14, 16, 21],
  // 3 options · 6 options · cued switch · frame · clock · clock
  stroop: [3, 7, 10, 14, 20, 27],
  // sub facts · div facts · two carries · × before + · borrow across zero · two-step missing
  math: [3, 6, 10, 13, 18, 23],
  // descending · growing step · Fibonacci · mixed lines and primes · three lines · squares/cubes
  // (the ladder now runs to L31: interleaved pairs to 29, the newest families under a second line)
  series: [3, 6, 9, 12, 15, 20],
  // no preview · 8 pairs · look-alike · 12 pairs · L13 · triples 8 (boards grow to 30 cards on a
  // phone, L21, and 42 on a 7×6 screen, L26 — above Master)
  pairs: [3, 6, 8, 11, 13, 15],
  // 5 cells · 6 · 8 · 9 · 11 · 14 (the ladder now runs to 17 cells on a 5×7 phone, 20 on 7×7)
  memoryGrid: [3, 4, 6, 7, 9, 12],
  // forward 4 · forward 5 · reverse 6 · 4×4, 7 tiles · faster flashes · 5×5, 8 tiles at 600ms
  // (games/sequence.ts SEQUENCE_LADDER; the ladder runs on to 13 tiles at 340ms, L16)
  sequence: [2, 3, 4, 5, 6, 8],
  // The thinking games (2026-11-13) — each threshold a band where the puzzle changes, all below the
  // game's maxLevel (24 / 21 / 21 / 24, the same on every screen).
  // colour · fill (full SET) · 12 cards, 4 attributes · exactly one set · «없음» · 15 cards
  setMatch: [4, 8, 11, 13, 16, 18],
  // three digits · four digits · 0-9 · repeats · four of 0-9 in six guesses · five digits
  codeBreak: [4, 8, 12, 13, 18, 19],
  // × · ÷ · brackets · five tiles · a fraction on the way · five tiles with a fraction
  makeNumber: [4, 7, 9, 13, 15, 17],
  // 6×6 · winding · keys · hidden walls · hidden walls and keys · two keys in a hidden 5×6
  mazeRun: [3, 6, 11, 16, 21, 23],
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
  const lo = tier === 0 ? 1 : t[tier - 1]
  const hi = t[tier]
  return { tier, next: hi, frac: Math.max(0, Math.min(1, (value - lo) / (hi - lo))) }
}

/**
 * A game level's position on that game's own tier anchors, 0 (start) to 6 (master) — the only
 * cross-game comparison the engine makes, used to pick a sensible first level for a game never
 * played. Computed when needed; never stored, synced or shown.
 */
export function standing(game: BrainGameId, level: number): number {
  const anchors = [1, ...TIERS[game]]
  if (level <= anchors[0]) return 0
  for (let i = 1; i < anchors.length; i++) {
    if (level <= anchors[i]) return i - 1 + (level - anchors[i - 1]) / (anchors[i] - anchors[i - 1])
  }
  return TIER_COUNT
}

/** The level in a game that sits at a given standing (the inverse of `standing`). */
export function levelAtStanding(game: BrainGameId, s: number): number {
  const anchors = [1, ...TIERS[game]]
  const clamped = Math.max(0, Math.min(TIER_COUNT, s))
  const i = Math.min(TIER_COUNT - 1, Math.floor(clamped))
  return anchors[i] + (clamped - i) * (anchors[i + 1] - anchors[i])
}
