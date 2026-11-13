import type { BrainGameDef, BrainGameId, BrainSkill, GameGroup } from './types'
import { quickEye } from './games/quick-eye'
import { memoryGrid } from './games/memory-grid'
import { sequence } from './games/sequence'
import { pairs } from './games/pairs'
import { schulte } from './games/schulte'
import { oddOneOut } from './games/odd-one-out'
import { stroop } from './games/stroop'
import { math } from './games/math'
import { series } from './games/series'

/**
 * Adding a game = write its state machine in `games/` and add one entry here. Names and
 * descriptions live in the `brain` locale namespace under `games.<id>`; the icon is a name both
 * platforms draw (lucide on web, Feather on mobile).
 */
export interface BrainGameEntry {
  id: BrainGameId
  skill: BrainSkill
  /** Which adaptive rule it follows — see rules.ts. */
  group: GameGroup
  /**
   * How the research rates it, which decides how often Today's Training uses it:
   * 'core' — the speed-of-processing family with the most consistent evidence (always included);
   * 'span' / 'reasoning' — trained skills improve, little transfer; rotated;
   * 'variety' — no specific evidence, kept for enjoyment and used at most every other session.
   */
  role: 'core' | 'speed' | 'span' | 'reasoning' | 'variety'
  icon: string
  /**
   * Staircase step scaling (useBrainRound judgeTrial): both steps are multiplied by `scale` (so the
   * 85% target is unchanged), and while unsure by up to `kMax` instead of the group's own.
   */
  steps?: { scale: number; kMax: number }
  // The registry is heterogeneous by design; each game's state type stays private to it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: BrainGameDef<any>
}

export const BRAIN_GAMES: readonly BrainGameEntry[] = [
  { id: 'quickEye', skill: 'speed', group: 'quickEye', role: 'core', icon: 'aperture', def: quickEye },
  { id: 'oddOneOut', skill: 'speed', group: 'speed', role: 'speed', icon: 'eye', def: oddOneOut },
  { id: 'schulte', skill: 'speed', group: 'speed', role: 'speed', icon: 'hash', def: schulte },
  { id: 'memoryGrid', skill: 'memory', group: 'span', role: 'span', icon: 'grid', def: memoryGrid },
  { id: 'sequence', skill: 'memory', group: 'span', role: 'span', icon: 'repeat', def: sequence },
  { id: 'series', skill: 'reasoning', group: 'speed', role: 'reasoning', icon: 'trending-up', def: series },
  { id: 'pairs', skill: 'memory', group: 'speed', role: 'variety', icon: 'copy', steps: { scale: 2, kMax: 1.5 }, def: pairs },
  { id: 'stroop', skill: 'attention', group: 'speed', role: 'variety', icon: 'droplet', def: stroop },
  { id: 'math', skill: 'speed', group: 'speed', role: 'variety', icon: 'plus-circle', def: math },
]

export function brainGame(id: BrainGameId): BrainGameEntry {
  const entry = BRAIN_GAMES.find((g) => g.id === id)
  if (!entry) throw new Error(`unknown brain game: ${id}`)
  return entry
}

export function isBrainGameId(value: unknown): value is BrainGameId {
  return typeof value === 'string' && BRAIN_GAMES.some((g) => g.id === value)
}
