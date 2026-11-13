import type { BrainGameId } from './types'
import { levelAtStanding } from './tiers'

/**
 * Save format v2 changed what a level MEANS for the board games (GAMES_DIFFICULTY_PLAN §2.2): the
 * same number now stands for harder content. A v1 level is converted once, when a v1 document is
 * read (progress.ts, meta.ts, history.ts); a v2 document is never converted again, and the format
 * bump stops old apps writing old-scale levels over it (sync.ts isNewerFormat, migration 288).
 */

type Six = readonly [number, number, number, number, number, number]

/** The games a v1 save can hold levels for — the catalogue then (the thinking games came with v3). */
export type V1GameId = 'oddOneOut' | 'schulte' | 'stroop' | 'math' | 'series' | 'pairs' | 'memoryGrid' | 'sequence'

/** The tier table v1 levels were climbed against (tiers.ts before the hard-content change). */
export const V1_TIERS: Record<V1GameId, Six> = {
  oddOneOut: [4, 10, 15, 22, 30, 42],
  schulte: [5, 9, 12, 22, 30, 35],
  stroop: [3, 8, 11, 17, 24, 28],
  math: [3, 6, 10, 18, 28, 36],
  series: [4, 8, 12, 16, 22, 32],
  pairs: [4, 10, 16, 20, 26, 38],
  memoryGrid: [3, 4, 6, 7, 9, 12],
  sequence: [2, 3, 4, 5, 6, 8],
}

/** The span games' new level cap (Flash Grid on a board of ≥ 28 cells, Sequence on 4×4). */
export const SPAN_LEVEL_CAP = 14

/** A level's standing (0 = start … 6 = master) on a given tier table — tiers.ts `standing`, for any table. */
export function standingOn<K extends string>(table: Record<K, Six>, game: K, level: number): number {
  const anchors = [1, ...table[game]]
  if (level <= anchors[0]) return 0
  for (let i = 1; i < anchors.length; i++) {
    if (level <= anchors[i]) return i - 1 + (level - anchors[i - 1]) / (anchors[i] - anchors[i - 1])
  }
  return anchors.length - 1
}

const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * A v1 level on the v2 scale. Quick Math and Number Pattern by a fitted line (their content was
 * rebuilt band by band); Odd One Out, Number Hunt and Color Word by standing on each table (the
 * tier a level reached stays the tier it reaches); Match Pairs by board size; the span games keep
 * their scale (level = length − 2), clamped to the new cap. Anything else (an old save's Quick Eye
 * record, its game since removed) is untouched.
 */
export function migrateLevelV1(id: BrainGameId, lv: number): number {
  if (!Number.isFinite(lv)) return 1
  switch (id) {
    case 'math':
      return clamp(1, 0.45 * lv + 1, 12)
    case 'series':
      return clamp(1, 0.75 * lv, 14)
    case 'oddOneOut':
    case 'schulte':
    case 'stroop':
      return Math.max(1, levelAtStanding(id, standingOn(V1_TIERS, id, lv)))
    case 'pairs': {
      const b = Math.floor(lv)
      return b <= 3 ? 1 : b <= 6 ? 2 : b <= 9 ? 4 : b <= 12 ? 6 : b <= 15 ? 9 : b <= 23 ? 11 : 12
    }
    case 'memoryGrid':
    case 'sequence':
      return clamp(1, lv, SPAN_LEVEL_CAP)
    default:
      return lv
  }
}

/** The board games whose level changed meaning in v2 (every game then but Quick Eye, since removed). */
export const V2_RESCALED: readonly BrainGameId[] = ['oddOneOut', 'schulte', 'stroop', 'math', 'series', 'pairs', 'memoryGrid', 'sequence']

/** Their skill estimates are re-found once (n = 0 forces a placement or a probe); span estimates stay. */
export const V2_REPLACED: readonly BrainGameId[] = ['oddOneOut', 'schulte', 'stroop', 'math', 'series', 'pairs']
