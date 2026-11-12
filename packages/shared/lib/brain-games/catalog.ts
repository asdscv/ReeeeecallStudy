import type { BrainGameDef, BrainGameId, BrainSkill } from './types'
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
  icon: string
  // The registry is heterogeneous by design; each game's state type stays private to it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: BrainGameDef<any>
}

export const BRAIN_GAMES: readonly BrainGameEntry[] = [
  { id: 'memoryGrid', skill: 'memory', icon: 'grid', def: memoryGrid },
  { id: 'sequence', skill: 'memory', icon: 'repeat', def: sequence },
  { id: 'pairs', skill: 'memory', icon: 'copy', def: pairs },
  { id: 'schulte', skill: 'attention', icon: 'hash', def: schulte },
  { id: 'oddOneOut', skill: 'attention', icon: 'eye', def: oddOneOut },
  { id: 'stroop', skill: 'speed', icon: 'droplet', def: stroop },
  { id: 'math', skill: 'speed', icon: 'plus-circle', def: math },
  { id: 'series', skill: 'reasoning', icon: 'trending-up', def: series },
]

export function brainGame(id: BrainGameId): BrainGameEntry {
  const entry = BRAIN_GAMES.find((g) => g.id === id)
  if (!entry) throw new Error(`unknown brain game: ${id}`)
  return entry
}

export function isBrainGameId(value: unknown): value is BrainGameId {
  return typeof value === 'string' && BRAIN_GAMES.some((g) => g.id === value)
}
