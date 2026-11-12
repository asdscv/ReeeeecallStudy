import type { BrainGameId } from './types'
import { MIN_LEVEL } from './adaptive'

/**
 * What survives between sessions — small on purpose. Mobile keeps it in SecureStore, which
 * caps a value at ~2KB; eight games of four numbers each is a few hundred bytes.
 */
export interface GameProgress {
  level: number
  bestLevel: number
  rounds: number
  wins: number
}

export interface BrainProgress {
  v: 1
  games: Partial<Record<BrainGameId, GameProgress>>
  totalRounds: number
  totalPoints: number
  /** Local calendar day (YYYY-MM-DD) of the last round played. */
  lastDay: string | null
  /** Consecutive days with at least one round, ending at `lastDay`. */
  dayStreak: number
  todayRounds: number
}

export function emptyProgress(): BrainProgress {
  return { v: 1, games: {}, totalRounds: 0, totalPoints: 0, lastDay: null, dayStreak: 0, todayRounds: 0 }
}

export function gameProgress(p: BrainProgress, id: BrainGameId): GameProgress {
  return p.games[id] ?? { level: MIN_LEVEL, bestLevel: MIN_LEVEL, rounds: 0, wins: 0 }
}

export function localDayKey(date: Date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

function dayDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** Streak and today's count as of `today` — a streak that lapsed reads as 0, not as its old value. */
export function currentDays(p: BrainProgress, today: string): { dayStreak: number; todayRounds: number } {
  if (!p.lastDay) return { dayStreak: 0, todayRounds: 0 }
  const gap = dayDiff(p.lastDay, today)
  if (gap === 0) return { dayStreak: p.dayStreak, todayRounds: p.todayRounds }
  if (gap === 1) return { dayStreak: p.dayStreak, todayRounds: 0 }
  return { dayStreak: 0, todayRounds: 0 }
}

export function recordRound(
  p: BrainProgress,
  id: BrainGameId,
  round: { level: number; correct: boolean; points: number },
  today: string,
): BrainProgress {
  const g = gameProgress(p, id)
  const gap = p.lastDay ? dayDiff(p.lastDay, today) : null
  const dayStreak = gap === 0 ? p.dayStreak : gap === 1 ? p.dayStreak + 1 : 1
  return {
    ...p,
    games: {
      ...p.games,
      [id]: {
        level: round.level,
        bestLevel: Math.max(g.bestLevel, round.level),
        rounds: g.rounds + 1,
        wins: g.wins + (round.correct ? 1 : 0),
      },
    },
    totalRounds: p.totalRounds + 1,
    totalPoints: p.totalPoints + round.points,
    lastDay: today,
    dayStreak,
    todayRounds: gap === 0 ? p.todayRounds + 1 : 1,
  }
}

export function serializeProgress(p: BrainProgress): string {
  return JSON.stringify(p)
}

/** Tolerant: anything unreadable becomes an empty record rather than a crash on launch. */
export function parseProgress(raw: string | null | undefined): BrainProgress {
  if (!raw) return emptyProgress()
  try {
    const data = JSON.parse(raw) as Partial<BrainProgress>
    if (!data || data.v !== 1 || typeof data.games !== 'object' || data.games === null) return emptyProgress()
    const games: BrainProgress['games'] = {}
    for (const [id, g] of Object.entries(data.games)) {
      if (!g || typeof g.level !== 'number' || !Number.isFinite(g.level)) continue
      games[id as BrainGameId] = {
        level: Math.max(MIN_LEVEL, g.level),
        bestLevel: Math.max(MIN_LEVEL, Number(g.bestLevel) || g.level),
        rounds: Math.max(0, Number(g.rounds) || 0),
        wins: Math.max(0, Number(g.wins) || 0),
      }
    }
    return {
      v: 1,
      games,
      totalRounds: Math.max(0, Number(data.totalRounds) || 0),
      totalPoints: Math.max(0, Number(data.totalPoints) || 0),
      lastDay: typeof data.lastDay === 'string' ? data.lastDay : null,
      dayStreak: Math.max(0, Number(data.dayStreak) || 0),
      todayRounds: Math.max(0, Number(data.todayRounds) || 0),
    }
  } catch {
    return emptyProgress()
  }
}
