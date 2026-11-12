import type { BrainGameId } from './types'
import { GROUP_RULES, TIMING_MODES, type TimingMode } from './rules'
import { quickEyeAdvance, QUICK_EYE_MAX_VARIANT, QUICK_EYE_WINDOW } from './games/quick-eye'

/**
 * What survives between sessions — small on purpose. Mobile keeps it in SecureStore, which caps a
 * value at ~2KB; a fully played record stays near 1KB (pinned by a test).
 */
export interface GameProgress {
  level: number
  bestLevel: number
  rounds: number
  wins: number
}

/**
 * Quick Eye's progression state: its variant and the last 24 valid trials. The threshold in ms is
 * kept for the advancement rule only — it is never shown (a ms threshold reads as an assessment).
 */
export interface QuickEyeProgress {
  variant: number
  /** Exposure actually shown in each recent valid trial, ms, oldest first. */
  recentMs: number[]
  /** '1'/'0' per recent valid trial, same order. */
  recentOk: string
  thresholdMs: number | null
}

/** Today's Training sessions — the dose the research ties outcomes to, so it is what is counted. */
export interface SessionLog {
  /** Local days (YYYY-MM-DD) of the most recent completed sessions, oldest first (last 12). */
  recentDays: string[]
  total: number
  minutes: number
  /** Local day the 10-session core course was completed. */
  coreDoneOn: string | null
  /** Refresher courses: index of the one in progress or last done (0 = none yet) and its sessions. */
  booster: { index: number; sessions: number }
  /** Games played in the most recent sessions, oldest first (last 9) — what the rotation avoids. */
  recentGames: BrainGameId[]
}

export interface BrainSettings {
  timing: TimingMode
  /** Quick Eye without the periphery — for players with a visual-field loss. */
  centerOnly: boolean
  /** Game sounds (web). On by default; mobile uses the app's vibration setting instead. */
  sound: boolean
}

export interface BrainProgress {
  v: 1
  games: Partial<Record<BrainGameId, GameProgress>>
  totalRounds: number
  totalPoints: number
  /** Local calendar day (YYYY-MM-DD) of the last round played. */
  lastDay: string | null
  /** Consecutive days with at least one round, ending at `lastDay`. Kept, not headlined. */
  dayStreak: number
  todayRounds: number
  /** Best score of a single round of play, per game and for Today's Training. */
  bestRuns: Partial<Record<BrainGameId | 'mix', number>>
  /** Games whose practice round has been played. */
  practiced: BrainGameId[]
  quickEye: QuickEyeProgress
  sessions: SessionLog
  settings: BrainSettings
}

export const CORE_COURSE_SESSIONS = 10
export const WEEKLY_GOAL = 3
export const BOOSTER_SESSIONS = 4
/** Refreshers about 11 and 35 months after the core course, as the original training scheduled them. */
export const BOOSTER_MONTHS = [11, 35] as const

const emptyQuickEye = (): QuickEyeProgress => ({ variant: 1, recentMs: [], recentOk: '', thresholdMs: null })
const emptySessions = (): SessionLog => ({ recentDays: [], total: 0, minutes: 0, coreDoneOn: null, booster: { index: 0, sessions: 0 }, recentGames: [] })

export function emptyProgress(): BrainProgress {
  return {
    v: 1,
    games: {},
    totalRounds: 0,
    totalPoints: 0,
    lastDay: null,
    dayStreak: 0,
    todayRounds: 0,
    bestRuns: {},
    practiced: [],
    quickEye: emptyQuickEye(),
    sessions: emptySessions(),
    settings: { timing: 1, centerOnly: false, sound: true },
  }
}

/** A game's progress, defaulting to its group's floor (Quick Eye starts at 500ms, level 0). */
export function gameProgress(p: BrainProgress, id: BrainGameId): GameProgress {
  const min = id === 'quickEye' ? GROUP_RULES.quickEye.min : GROUP_RULES.speed.min
  return p.games[id] ?? { level: min, bestLevel: min, rounds: 0, wins: 0 }
}

export function localDayKey(date: Date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

export function dayDiff(from: string, to: string): number {
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

/**
 * One judged trial. `level` is the level AFTER the trial. Quick Eye's valid trials also feed its
 * variant ladder: on reaching the criterion the next variant opens and the level eases back.
 */
export function recordRound(
  p: BrainProgress,
  id: BrainGameId,
  round: { level: number; correct: boolean; points: number; shownMs?: number },
  today: string,
): BrainProgress {
  const g = gameProgress(p, id)
  const gap = p.lastDay ? dayDiff(p.lastDay, today) : null
  const dayStreak = gap === 0 ? p.dayStreak : gap === 1 ? p.dayStreak + 1 : 1
  let level = round.level
  let quickEye = p.quickEye
  if (id === 'quickEye' && typeof round.shownMs === 'number') {
    const recentMs = [...p.quickEye.recentMs, Math.round(round.shownMs)].slice(-QUICK_EYE_WINDOW)
    const recentOk = (p.quickEye.recentOk + (round.correct ? '1' : '0')).slice(-QUICK_EYE_WINDOW)
    const { advance, thresholdMs } = quickEyeAdvance(p.quickEye.variant, recentMs, recentOk.split('').map((c) => c === '1'))
    if (advance) {
      quickEye = { variant: Math.min(QUICK_EYE_MAX_VARIANT, p.quickEye.variant + 1), recentMs: [], recentOk: '', thresholdMs }
      level = Math.max(GROUP_RULES.quickEye.min, round.level - 3)
    } else {
      quickEye = { ...p.quickEye, recentMs, recentOk, thresholdMs: thresholdMs ?? p.quickEye.thresholdMs }
    }
  }
  return {
    ...p,
    games: {
      ...p.games,
      [id]: {
        level,
        bestLevel: Math.max(g.bestLevel, round.level),
        rounds: g.rounds + 1,
        wins: g.wins + (round.correct ? 1 : 0),
      },
    },
    quickEye,
    totalRounds: p.totalRounds + 1,
    totalPoints: p.totalPoints + round.points,
    lastDay: today,
    dayStreak,
    todayRounds: gap === 0 ? p.todayRounds + 1 : 1,
  }
}

/** A finished round of play: keeps the best score, says whether this one beat it. */
export function recordRun(p: BrainProgress, mode: BrainGameId | 'mix', points: number): { progress: BrainProgress; isNewBest: boolean; best: number } {
  const prev = p.bestRuns[mode] ?? 0
  const best = Math.max(prev, points)
  return { progress: { ...p, bestRuns: { ...p.bestRuns, [mode]: best } }, isNewBest: points > prev && prev > 0, best }
}

/** Set where the next round of a game starts (the level never goes back to 1 after a round ends). */
export function setStartLevel(p: BrainProgress, id: BrainGameId, level: number): BrainProgress {
  const g = gameProgress(p, id)
  return { ...p, games: { ...p.games, [id]: { ...g, level } } }
}

export function markPracticed(p: BrainProgress, id: BrainGameId): BrainProgress {
  return p.practiced.includes(id) ? p : { ...p, practiced: [...p.practiced, id] }
}

export function updateSettings(p: BrainProgress, patch: Partial<BrainSettings>): BrainProgress {
  return { ...p, settings: { ...p.settings, ...patch } }
}

/**
 * A completed Today's Training session. Counts toward the core course, then toward a refresher
 * when one is open (see `courseStatus` in plan.ts).
 */
export function recordSession(p: BrainProgress, minutes: number, today: string, boosterOpen: number | null, games: BrainGameId[] = []): BrainProgress {
  const s = p.sessions
  const total = s.total + 1
  let booster = s.booster
  if (boosterOpen !== null) {
    booster = booster.index === boosterOpen ? { index: boosterOpen, sessions: booster.sessions + 1 } : { index: boosterOpen, sessions: 1 }
  }
  return {
    ...p,
    sessions: {
      recentDays: [...s.recentDays, today].slice(-12),
      total,
      minutes: s.minutes + Math.max(0, Math.round(minutes)),
      coreDoneOn: s.coreDoneOn ?? (total >= CORE_COURSE_SESSIONS ? today : null),
      booster,
      recentGames: [...s.recentGames, ...games].slice(-9),
    },
  }
}

export function serializeProgress(p: BrainProgress): string {
  return JSON.stringify(p)
}

const num = (v: unknown, min = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : min)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Tolerant: anything unreadable becomes an empty record rather than a crash on launch. */
export function parseProgress(raw: string | null | undefined): BrainProgress {
  if (!raw) return emptyProgress()
  try {
    const data = JSON.parse(raw) as Partial<BrainProgress>
    if (!data || data.v !== 1 || typeof data.games !== 'object' || data.games === null) return emptyProgress()
    const games: BrainProgress['games'] = {}
    // v1 records (written before Today's Training existed, so without `sessions`) measured the span
    // games on another scale: Flash Grid had 3 + ⌊(L−1)·0.6⌋ cells and Sequence 3 + ⌊(L−1)·0.45⌋
    // tiles, where the level is now the length − 2. Convert, or a v1 level 6 would open at 8 tiles.
    const v1 = data.sessions === undefined
    for (const [id, g] of Object.entries(data.games)) {
      if (!g || typeof g.level !== 'number' || !Number.isFinite(g.level)) continue
      const min = id === 'quickEye' ? 0 : 1
      const span = v1 && (id === 'memoryGrid' || id === 'sequence')
      const toLength = (lv: number) => (span ? Math.max(1, 1 + Math.floor((lv - 1) * (id === 'memoryGrid' ? 0.6 : 0.45))) : lv)
      games[id as BrainGameId] = {
        level: Math.max(min, toLength(g.level)),
        bestLevel: Math.max(min, toLength(Number(g.bestLevel) || g.level)),
        rounds: num(g.rounds),
        wins: num(g.wins),
      }
    }
    const bestRuns: BrainProgress['bestRuns'] = {}
    if (data.bestRuns && typeof data.bestRuns === 'object') {
      for (const [mode, v] of Object.entries(data.bestRuns)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) bestRuns[mode as BrainGameId | 'mix'] = v
      }
    }
    const qe = (data.quickEye ?? {}) as Partial<QuickEyeProgress>
    const quickEye: QuickEyeProgress = {
      variant: Math.min(QUICK_EYE_MAX_VARIANT, Math.max(1, Math.round(num(qe.variant, 1)))),
      recentMs: Array.isArray(qe.recentMs) ? qe.recentMs.filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(-QUICK_EYE_WINDOW) : [],
      recentOk: typeof qe.recentOk === 'string' ? qe.recentOk.replace(/[^01]/g, '').slice(-QUICK_EYE_WINDOW) : '',
      thresholdMs: typeof qe.thresholdMs === 'number' && Number.isFinite(qe.thresholdMs) ? qe.thresholdMs : null,
    }
    if (quickEye.recentMs.length !== quickEye.recentOk.length) {
      quickEye.recentMs = []
      quickEye.recentOk = ''
    }
    const se = (data.sessions ?? {}) as Partial<SessionLog>
    const booster = se.booster && typeof se.booster === 'object' ? se.booster : { index: 0, sessions: 0 }
    const sessions: SessionLog = {
      recentDays: Array.isArray(se.recentDays) ? se.recentDays.filter(isDay).slice(-12) : [],
      total: num(se.total),
      minutes: num(se.minutes),
      coreDoneOn: isDay(se.coreDoneOn) ? se.coreDoneOn : null,
      booster: { index: Math.round(num(booster.index)), sessions: Math.round(num(booster.sessions)) },
      recentGames: Array.isArray(se.recentGames) ? se.recentGames.filter((x): x is BrainGameId => typeof x === 'string').slice(-9) : [],
    }
    const timing = data.settings && TIMING_MODES.includes(data.settings.timing) ? data.settings.timing : 1
    return {
      v: 1,
      games,
      totalRounds: num(data.totalRounds),
      totalPoints: num(data.totalPoints),
      lastDay: isDay(data.lastDay) ? data.lastDay : null,
      dayStreak: num(data.dayStreak),
      todayRounds: num(data.todayRounds),
      bestRuns,
      practiced: Array.isArray(data.practiced) ? data.practiced.filter((x): x is BrainGameId => typeof x === 'string') : [],
      quickEye,
      sessions,
      settings: { timing, centerOnly: data.settings?.centerOnly === true, sound: data.settings?.sound !== false },
    }
  } catch {
    return emptyProgress()
  }
}
