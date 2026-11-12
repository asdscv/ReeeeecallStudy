import type { RoundOutcome } from './types'

/**
 * Adaptive difficulty — the reason the games do not end.
 *
 * Level is a float with no ceiling. A right answer nudges it up, a miss drops it further than a
 * hit raises it, so it settles where the player gets roughly three in four right: hard enough to
 * work, easy enough to keep going. (Up 0.3 vs down 0.8 balances at p ≈ 0.73.)
 */
export const MIN_LEVEL = 1
const UP = 0.3
const UP_FAST = 0.45
const DOWN = 0.8

/** A fast answer used less than this share of the time limit. */
const FAST_SHARE = 0.4

export function nextLevel(level: number, outcome: RoundOutcome, usedShare: number): number {
  if (outcome.correct) return round2(level + (usedShare <= FAST_SHARE ? UP_FAST : UP))
  // A near miss (most of the grid right) costs less than a blank.
  const drop = DOWN * (1 - outcome.accuracy * 0.5)
  return Math.max(MIN_LEVEL, round2(level - drop))
}

/** The whole number the player sees. */
export function displayLevel(level: number): number {
  return Math.max(MIN_LEVEL, Math.floor(level))
}

/**
 * Points for one round: level-weighted, a bonus for speed and for a running streak. A miss
 * scores nothing — but never takes points away, so stopping is never punished.
 */
export function roundPoints(level: number, outcome: RoundOutcome, usedShare: number, streak: number): number {
  if (!outcome.correct) return 0
  const speed = 1 + Math.max(0, 1 - usedShare) * 0.5
  const combo = 1 + Math.min(streak, 10) * 0.1
  return Math.round(10 * displayLevel(level) * speed * combo)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
