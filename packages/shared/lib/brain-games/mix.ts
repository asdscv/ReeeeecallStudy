import type { Rng } from './rng'
import type { BrainGameId } from './types'
import type { BrainProgress } from './progress'
import { gameProgress } from './progress'
import { BRAIN_GAMES } from './catalog'

/** Rounds of one game before the mix moves on — enough to settle into it, short enough to switch. */
export const MIX_BURST = 3

/**
 * The next game in the endless mix. Never the one just played, and weighted toward what has
 * been practised least and what lags behind the player's other games — so the mix drifts to
 * the weak spot instead of rotating in a fixed order.
 */
export function pickNextGame(progress: BrainProgress, recent: readonly BrainGameId[], rng: Rng): BrainGameId {
  const levels = BRAIN_GAMES.map((g) => gameProgress(progress, g.id).level)
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length
  const avoid = new Set(recent.slice(-2))
  const pool = BRAIN_GAMES.filter((g) => !avoid.has(g.id))
  const weights = pool.map((g) => {
    const p = gameProgress(progress, g.id)
    const lag = Math.max(0, (mean - p.level) / mean)
    const fresh = 1 / (1 + p.rounds / 30)
    return 1 + lag * 2 + fresh
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = rng.next() * total
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return pool[i].id
  }
  return pool[pool.length - 1].id
}
