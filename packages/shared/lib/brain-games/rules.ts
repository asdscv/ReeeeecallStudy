import type { GameGroup } from './types'

/**
 * The adaptive rules — how the level moves, how many misses a round absorbs, when it ends.
 *
 * ── Why these numbers ───────────────────────────────────────────────────────
 *
 * A weighted up-down staircase settles where S_up·p = S_down·(1−p) (Kaernbach 1991), so the step
 * ratio IS the target accuracy. The first version stepped +0.3 / +0.45-when-fast / −0.8, which
 * settled near 73% — and for a fast player near 64%, because the speed bonus quietly moved the
 * target. Speed now only earns points; it never touches the level.
 *
 * With lives, a 73% target meant a 3-life round lasted ~11 trials and nearly every round ended in
 * failure (expected trials ≈ lives / (1 − p)). So the targets are higher:
 *   - speed / variety games: 85% (+0.15 / −0.85), 3 lives, a round "clears" at 20 trials
 *   - span tasks (Flash Grid, Sequence): the Corsi stop rule — two tries at each length; one right
 *     moves up a length, both wrong ends the round (Kessels 2000)
 * How unsure the game still is of the player's level scales both steps by the same factor (skill.ts
 * — ratio, and so target, unchanged), and a game never played starts with a short placement
 * (placement.ts). The level is never reset to 1: the next round starts a little below the round's
 * own estimate (the mean of its reversal levels).
 */
export interface GroupRules {
  /** Misses a round absorbs. For span games this is per length and refills on each step up. */
  lives: number
  /** Level change on a right answer, and on a wrong one (span: wrong does not move the level). */
  up: number
  down: number
  /**
   * Trials after which the round ends as cleared. Span rounds are capped too (14): the Corsi rule
   * alone never ends a round for a player who keeps passing.
   */
  roundCap: number | null
  min: number
  max: number
  /** How far below the finishing level the next round starts. */
  restartDrop: number
}

export const GROUP_RULES: Record<GameGroup, GroupRules> = {
  speed: { lives: 3, up: 0.15, down: 0.85, roundCap: 20, min: 1, max: Infinity, restartDrop: 0.5 },
  span: { lives: 2, up: 1, down: 0, roundCap: 14, min: 1, max: Infinity, restartDrop: 2 },
}

/** Trials in a first-ever practice round: no lives, no level change, no score. */
export const PRACTICE_TRIALS = 4

/** The target accuracy a group's step ratio converges to: up / (up + down). */
export function targetAccuracy(group: GameGroup): number {
  const r = GROUP_RULES[group]
  return group === 'span' ? 0.5 : r.down / (r.up + r.down)
}

/**
 * The level after one judged trial.
 *
 * `k` scales both steps by how unsure the game still is of the player's level (skill.ts): big steps
 * while unsure, base steps once settled. Scaling both keeps their ratio — and so the target
 * accuracy — unchanged. A near miss on a multi-tap grid (most cells right) costs less than a blank:
 * the step down scales with how much was wrong.
 */
export function stepLevel(group: GameGroup, level: number, correct: boolean, accuracy: number, k = 1): number {
  const r = GROUP_RULES[group]
  if (group === 'span') return clampLevel(group, correct ? level + r.up : level)
  const next = correct ? level + r.up * k : level - r.down * k * (1 - accuracy * 0.5)
  return clampLevel(group, round2(next))
}

/** Where the next round starts, from where this one finished (and, for span, its best length). */
export function restartLevel(group: GameGroup, finishLevel: number, bestInRound: number): number {
  const r = GROUP_RULES[group]
  const from = group === 'span' ? bestInRound : finishLevel
  return clampLevel(group, round2(from - r.restartDrop))
}

export function clampLevel(group: GameGroup, level: number): number {
  const r = GROUP_RULES[group]
  return Math.max(r.min, Math.min(r.max, level))
}

/**
 * Relaxed timing (a setting): every time limit is multiplied, or there is none. In a relaxed mode a
 * timeout still counts as wrong for the level but costs no life — age slows choice reaction time
 * (Der 2006), and the setting exists so that is not punished.
 */
export type TimingMode = 1 | 1.5 | 2 | 0

export const TIMING_MODES: readonly TimingMode[] = [1, 1.5, 2, 0]

export function scaledLimit(limitMs: number | null, mode: TimingMode): number | null {
  if (limitMs === null || mode === 0) return null
  return Math.round(limitMs * mode)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
