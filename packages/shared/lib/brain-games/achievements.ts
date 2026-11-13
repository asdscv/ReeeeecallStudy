import type { BrainGameId } from './types'
import type { BrainMeta } from './meta'
import type { BrainProgress } from './progress'
import { BRAIN_GAMES } from './catalog'
import { hasBit } from './meta'
import { weekProgress } from './plan'

/**
 * Achievements — honest ones. They reward skill milestones, clean play, finishing the plan and
 * coming back, all stated as game facts ("cleared a round without losing a chance"). They never
 * reward day streaks, play volume, playing more than three sessions a week, totals, percentiles
 * or anything said about the brain (EVIDENCE: §3 progress display; Hamari & Eranti 2011 on the
 * badge and its logic agreeing). Append-only: the index in ACHIEVEMENT_BITS is the bit in
 * BrainMeta.ach — a retired id keeps its place so the bits after it never move.
 * Copy: `brain` namespace, `achievements.<id>.title/body`.
 */
export const ACHIEVEMENT_BITS = [
  'firstClear',
  'cleanRound',
  'streak10',
  'streak20',
  'flawlessHunt',
  'span7',
  'quickEyeStage5',
  'quickEyeStage10',
  'allGames',
  'firstSession',
  'weekGoal',
  'coreCourse',
  'comeback',
  'goldTier',
  'masterTier',
] as const

/**
 * Never earned or shown again: Quick Eye's stage milestones (the game was removed by the owner
 * 2026-11-13). A bit already set in an old save stays set and is simply not listed.
 */
export const RETIRED_ACHIEVEMENTS = ['quickEyeStage5', 'quickEyeStage10'] as const

/** An achievement that can still be earned and is shown. */
export type AchievementId = Exclude<(typeof ACHIEVEMENT_BITS)[number], (typeof RETIRED_ACHIEVEMENTS)[number]>

const isLive = (id: (typeof ACHIEVEMENT_BITS)[number]): id is AchievementId => !(RETIRED_ACHIEVEMENTS as readonly string[]).includes(id)

/** Every achievement still earned and shown, in bit order — what the screens list. */
export const ACHIEVEMENTS: readonly AchievementId[] = ACHIEVEMENT_BITS.filter(isLive)

export function achievementBit(id: AchievementId): number {
  return ACHIEVEMENT_BITS.indexOf(id)
}

export function hasAchievement(meta: BrainMeta, id: AchievementId): boolean {
  return hasBit(meta.ach, achievementBit(id))
}

/** What one finished round can earn. `meta` is AFTER this round's tier update. */
export interface RoundFacts {
  gameId: BrainGameId
  endedBy: 'lives' | 'cap' | 'stop' | 'void' | 'time' | null
  /** The round's own verdict: reached its end with at least half the counted trials right. */
  cleared: boolean
  /** Counted trials (practice, rule-intro and placement trials excluded), and how many were right. */
  trials: number
  correct: number
  livesLost: number
  bestStreak: number
  /** Span games: the longest length passed this round. */
  spanLength: number
  /** Number Hunt: cleared a 5×5 or larger grid with no wrong tap. */
  flawlessHunt: boolean
}

export function earnedByRound(f: RoundFacts, progress: BrainProgress, meta: BrainMeta): AchievementId[] {
  const out: AchievementId[] = []
  const cleared = f.cleared && f.endedBy === 'cap' && f.trials > 0 && f.correct / f.trials >= 0.5
  if (cleared) out.push('firstClear')
  if (cleared && f.livesLost === 0 && f.trials >= 10) out.push('cleanRound')
  if (f.bestStreak >= 10) out.push('streak10')
  if (f.bestStreak >= 20) out.push('streak20')
  if (f.flawlessHunt) out.push('flawlessHunt')
  if (f.spanLength >= 7) out.push('span7')
  if (BRAIN_GAMES.every((g) => (progress.games[g.id]?.rounds ?? 0) > 0)) out.push('allGames')
  // Games in the catalogue only: an old save's tier for a removed game (Quick Eye) earns nothing.
  const tiers = BRAIN_GAMES.map((g) => meta.tier[g.id]).filter((t): t is number => typeof t === 'number')
  if (tiers.some((t) => t >= 3)) out.push('goldTier')
  if (tiers.some((t) => t >= 6)) out.push('masterTier')
  return out.filter((id) => !hasAchievement(meta, id))
}

/** What a completed Today's Training session can earn. `after` is progress with the session recorded. */
export function earnedBySession(after: BrainProgress, today: string, meta: BrainMeta, daysAway: number): AchievementId[] {
  const out: AchievementId[] = []
  if (after.sessions.total >= 1) out.push('firstSession')
  const week = weekProgress(after, today)
  if (week.done >= week.goal) out.push('weekGoal')
  if (after.sessions.coreDoneOn) out.push('coreCourse')
  // "More than two weeks" away: 15+ days between sessions (14 would be 13 idle days).
  if (daysAway > 14) out.push('comeback')
  return [...new Set(out)].filter((id) => !hasAchievement(meta, id))
}
