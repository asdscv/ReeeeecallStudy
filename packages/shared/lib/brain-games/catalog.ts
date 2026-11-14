import type { BrainGameDef, BrainGameId, BrainSkill, GameGroup, RetiredGameId } from './types'
import { DIFFICULTY_GAMES } from './difficulty-range'
import { CODE_BREAK_ROUND_CAP } from './games/code-break'

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
   * The kind of game, for a never-played game's first level (skill.ts crossGameSeed: games of the
   * same kind seed each other more). No game is modelled on a studied training programme (Quick
   * Eye, the one that was, was removed by the owner 2026-11-13), so no role claims an effect.
   */
  role: 'speed' | 'span' | 'reasoning' | 'variety'
  icon: string
  /**
   * Staircase step scaling (useBrainRound judgeTrial): both steps are multiplied by `scale` (so the
   * 85% target is unchanged), and while unsure by up to `kMax` instead of the group's own.
   */
  steps?: { scale: number; kMax: number }
  /**
   * Counted trials after which a round ends as cleared, when a trial is a whole puzzle and the
   * group's cap (rules.ts GROUP_RULES — 20 for the speed group) would make a round of half an hour.
   * Unset: the group's cap.
   */
  roundCap?: number
  // The registry is heterogeneous by design; each game's state type stays private to it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: BrainGameDef<any>
}

export const BRAIN_GAMES: readonly BrainGameEntry[] = [
  { id: 'oddOneOut', skill: 'speed', group: 'speed', role: 'speed', icon: 'eye', def: DIFFICULTY_GAMES.oddOneOut },
  { id: 'schulte', skill: 'speed', group: 'speed', role: 'speed', icon: 'hash', def: DIFFICULTY_GAMES.schulte },
  { id: 'memoryGrid', skill: 'memory', group: 'span', role: 'span', icon: 'grid', def: DIFFICULTY_GAMES.memoryGrid },
  { id: 'sequence', skill: 'memory', group: 'span', role: 'span', icon: 'repeat', def: DIFFICULTY_GAMES.sequence },
  { id: 'series', skill: 'reasoning', group: 'speed', role: 'reasoning', icon: 'trending-up', def: DIFFICULTY_GAMES.series },
  { id: 'pairs', skill: 'memory', group: 'speed', role: 'variety', icon: 'copy', steps: { scale: 2, kMax: 1.5 }, def: DIFFICULTY_GAMES.pairs },
  { id: 'stroop', skill: 'attention', group: 'speed', role: 'variety', icon: 'droplet', def: DIFFICULTY_GAMES.stroop },
  { id: 'math', skill: 'speed', group: 'speed', role: 'variety', icon: 'plus-circle', def: DIFFICULTY_GAMES.math },
  // The thinking games (owner 2026-11-13). All on the 85% staircase: each level is a harder board
  // (more cards, digits, tiles or cells, or less time), so the speed group's rule fits; none is a
  // span task. Skills (the hub label and the day's focus) spread the twelve games three a skill: Set
  // Match is card-by-card comparison (주의), Make the Number arithmetic reasoning (추리). A Code Break
  // trial is a whole puzzle (a minute or more): Match Pairs' doubled steps, so a round moves in fewer
  // trials (target unchanged), and a round is five codes, not twenty (`roundCap`).
  { id: 'setMatch', skill: 'attention', group: 'speed', role: 'reasoning', icon: 'layers', def: DIFFICULTY_GAMES.setMatch },
  { id: 'codeBreak', skill: 'reasoning', group: 'speed', role: 'reasoning', icon: 'lock', steps: { scale: 2, kMax: 1.5 }, roundCap: CODE_BREAK_ROUND_CAP, def: DIFFICULTY_GAMES.codeBreak },
  { id: 'makeNumber', skill: 'reasoning', group: 'speed', role: 'reasoning', icon: 'target', def: DIFFICULTY_GAMES.makeNumber },
  { id: 'mazeRun', skill: 'attention', group: 'speed', role: 'variety', icon: 'compass', def: DIFFICULTY_GAMES.mazeRun },
]

export function brainGame(id: BrainGameId): BrainGameEntry {
  const entry = BRAIN_GAMES.find((g) => g.id === id)
  if (!entry) throw new Error(`unknown brain game: ${id}`)
  return entry
}

export function isBrainGameId(value: unknown): value is BrainGameId {
  return typeof value === 'string' && BRAIN_GAMES.some((g) => g.id === value)
}

/**
 * Removed games whose records an old save may still hold (Quick Eye, removed by the owner
 * 2026-11-13). Reading and merging keep them, so an app version that still has the game loses
 * nothing in a sync — but nothing on screen reads them, and they are never a route or a plan slot.
 */
export const RETIRED_GAME_IDS: readonly RetiredGameId[] = ['quickEye']

/** A game id a save may carry: one in the catalogue, or a removed one (RETIRED_GAME_IDS). */
export function isSavedGameId(value: unknown): value is BrainGameId | RetiredGameId {
  return isBrainGameId(value) || (typeof value === 'string' && (RETIRED_GAME_IDS as readonly string[]).includes(value))
}
