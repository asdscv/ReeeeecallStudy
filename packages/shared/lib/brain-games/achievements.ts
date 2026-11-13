import type { BrainGameId } from './types'
import type { BrainMeta } from './meta'
import type { BrainProgress } from './progress'
import { BRAIN_GAMES } from './catalog'
import { hasBit } from './meta'
import { quickEyeTierStage } from './tiers'
import { weekProgress } from './plan'

/**
 * Achievements — honest ones. They reward skill milestones, clean play, finishing the plan and
 * coming back, all stated as game facts ("cleared a round without losing a chance"). They never
 * reward day streaks, play volume, playing more than three sessions a week, totals, percentiles
 * or anything said about the brain (EVIDENCE: §3 progress display; Hamari & Eranti 2011 on the
 * badge and its logic agreeing). Append-only: the index is the bit in BrainMeta.ach.
 * Copy: `brain` namespace, `achievements.<id>.title/body`.
 */
export const ACHIEVEMENTS = [
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

export type AchievementId = (typeof ACHIEVEMENTS)[number]

export function achievementBit(id: AchievementId): number {
  return ACHIEVEMENTS.indexOf(id)
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
  const qeStage = quickEyeTierStage(progress.quickEye.variant, progress.settings.centerOnly)
  if (qeStage >= 5) out.push('quickEyeStage5')
  if (qeStage >= 10) out.push('quickEyeStage10')
  if (BRAIN_GAMES.every((g) => (progress.games[g.id]?.rounds ?? 0) > 0)) out.push('allGames')
  const tiers = Object.values(meta.tier).filter((t): t is number => typeof t === 'number')
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
