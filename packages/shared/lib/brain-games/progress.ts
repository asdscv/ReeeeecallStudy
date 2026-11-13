import type { BrainGameId } from './types'
import { GROUP_RULES, TIMING_MODES, type TimingMode } from './rules'
import { V2_RESCALED, migrateLevelV1 } from './scale'

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
 * Quick Eye's progression state (its stage and last 24 trials). The game was removed by the owner
 * (2026-11-13): this is still read, clamped and merged, so an app version that still has the game
 * loses nothing in a sync, but nothing in this version writes it or shows it.
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
  /**
   * Sessions counted toward the core course and its refreshers: at most WEEKLY_GOAL a week. A fourth
   * session in a week is welcome but earns nothing more (EVIDENCE §3) — not even course progress.
   */
  course: number
  minutes: number
  /** Local day the 10-session core course was completed. */
  coreDoneOn: string | null
  /** Refresher courses: index of the one in progress or last done (0 = none yet) and its sessions. */
  booster: { index: number; sessions: number }
  /** Games played in the most recent sessions, oldest first (last 9) — what the rotation avoids. */
  recentGames: BrainGameId[]
}

/** Today's Training length the player picked: a quick 5 minutes (the default) or the full 20. */
export type SessionMinutes = 5 | 20
export const SESSION_MINUTES: readonly SessionMinutes[] = [5, 20]

export interface BrainSettings {
  timing: TimingMode
  /** Quick Eye's centre-only setting — the game is removed; kept so the setting round-trips, never shown. */
  centerOnly: boolean
  /** Game sounds (web). On by default; mobile uses the app's vibration setting instead. */
  sound: boolean
  /** Today's Training length. Per device, like every setting. */
  sessionMinutes: SessionMinutes
}

export interface BrainProgress {
  /**
   * 3 since the thinking games (2026-11-13; sync.ts BRAIN_PROGRESS_FORMAT says why); 2 since the
   * hard-content change (levels on the v2 scale). A v1 record is converted once on reading; a v2
   * record is read as it is — v2 → v3 changes nothing in the content.
   */
  v: 3
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
  /** Quick Eye's state from an old save (the game is removed) — kept for older app versions only. */
  quickEye: QuickEyeProgress
  /**
   * Which Quick Eye field the record was played on: 2 = the mid-grey field with a matched mask.
   * Absent = the old dark field, whose trials (an afterimage made short flashes easy) are dropped
   * once on reading. Top level, not inside `quickEye`: a client that predates it keeps unknown
   * top-level fields when it syncs (sync.ts) but would strip a nested one.
   */
  quickEyeField?: 2
  sessions: SessionLog
  settings: BrainSettings
}

export const CORE_COURSE_SESSIONS = 10
export const WEEKLY_GOAL = 3
export const BOOSTER_SESSIONS = 4
/** Refreshers about 11 and 35 months after the core course, as the original training scheduled them. */
export const BOOSTER_MONTHS = [11, 35] as const

const emptyQuickEye = (): QuickEyeProgress => ({ variant: 2, recentMs: [], recentOk: '', thresholdMs: null })
const emptySessions = (): SessionLog => ({ recentDays: [], total: 0, course: 0, minutes: 0, coreDoneOn: null, booster: { index: 0, sessions: 0 }, recentGames: [] })

export function emptyProgress(): BrainProgress {
  return {
    v: 3,
    games: {},
    totalRounds: 0,
    totalPoints: 0,
    lastDay: null,
    dayStreak: 0,
    todayRounds: 0,
    bestRuns: {},
    practiced: [],
    quickEye: emptyQuickEye(),
    quickEyeField: 2,
    sessions: emptySessions(),
    settings: { timing: 1, centerOnly: false, sound: true, sessionMinutes: 5 },
  }
}

/** A game's progress, defaulting to level 1. */
export function gameProgress(p: BrainProgress, id: BrainGameId): GameProgress {
  const min = GROUP_RULES.speed.min
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

/** One judged trial. `level` is the level AFTER the trial. */
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
/** Monday of the week `day` falls in (the week the 3-a-week goal counts). */
function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

export function recordSession(p: BrainProgress, minutes: number, today: string, boosterOpen: number | null, games: BrainGameId[] = []): BrainProgress {
  const s = p.sessions
  const total = s.total + 1
  // Only the first WEEKLY_GOAL sessions of a week move the course on.
  const monday = mondayOf(today)
  const counts = s.recentDays.filter((day) => day >= monday && day <= today).length < WEEKLY_GOAL
  const course = s.course + (counts ? 1 : 0)
  let booster = s.booster
  if (boosterOpen !== null && counts) {
    booster = booster.index === boosterOpen ? { index: boosterOpen, sessions: booster.sessions + 1 } : { index: boosterOpen, sessions: 1 }
  }
  return {
    ...p,
    sessions: {
      recentDays: [...s.recentDays, today].slice(-12),
      total,
      course,
      minutes: s.minutes + Math.max(0, Math.round(minutes)),
      coreDoneOn: s.coreDoneOn ?? (course >= CORE_COURSE_SESSIONS ? today : null),
      booster,
      recentGames: [...s.recentGames, ...games].slice(-9),
    },
  }
}

export function serializeProgress(p: BrainProgress): string {
  return JSON.stringify(p)
}

const num = (v: unknown, min = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : min)

/**
 * The removed Quick Eye's bounds, for reading an old save's record of it unchanged: its 16 stages,
 * its 24-trial window, its level 0-12 (games/quick-eye.ts until 2026-11-13).
 */
const LEGACY_QUICK_EYE = { maxVariant: 16, window: 24, minLevel: 0, maxLevel: 12 } as const
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * Tolerant: anything unreadable becomes an empty record rather than a crash on launch.
 *
 * Reads v1, v2 or v3 and always returns v3. A v1 record's board-game levels are converted to the v2
 * scale (scale.ts) and their best scores cleared — earned on easier content, the precedent Quick
 * Eye's field change set. Converting happens only on a v1 document, so reading the result again
 * changes nothing. A v2 record is the same content under the old number (sync.ts BRAIN_PROGRESS_FORMAT).
 */
export function parseProgress(raw: string | null | undefined): BrainProgress {
  if (!raw) return emptyProgress()
  try {
    const data = JSON.parse(raw) as Partial<Omit<BrainProgress, 'v'>> & { v?: unknown }
    if (!data || (data.v !== 1 && data.v !== 2 && data.v !== 3) || typeof data.games !== 'object' || data.games === null) return emptyProgress()
    const oldScale = data.v === 1
    const games: BrainProgress['games'] = {}
    // Older still: v1 records written before Today's Training existed (so without `sessions`)
    // measured the span games on another scale: Flash Grid had 3 + ⌊(L−1)·0.6⌋ cells and Sequence
    // 3 + ⌊(L−1)·0.45⌋ tiles, where the level is now the length − 2. Convert, or a level 6 would
    // open at 8 tiles.
    const preSessions = oldScale && data.sessions === undefined
    for (const [id, g] of Object.entries(data.games)) {
      if (!g || typeof g.level !== 'number' || !Number.isFinite(g.level)) continue
      // A removed game's record (Quick Eye) is kept on its own scale for older app versions.
      const min = id === 'quickEye' ? LEGACY_QUICK_EYE.minLevel : 1
      // A sane ceiling as well as a floor: a corrupted or edited level (1e308) would otherwise make
      // the games build absurd puzzles. No game's level means anything past these.
      const max = id === 'quickEye' ? LEGACY_QUICK_EYE.maxLevel : 500
      const span = preSessions && (id === 'memoryGrid' || id === 'sequence')
      const toLength = (lv: number) => (span ? Math.max(1, 1 + Math.floor((lv - 1) * (id === 'memoryGrid' ? 0.6 : 0.45))) : lv)
      const rescale = (lv: number) => (oldScale ? migrateLevelV1(id as BrainGameId, toLength(lv)) : lv)
      const clampLv = (lv: number) => Math.min(max, Math.max(min, Number.isFinite(lv) ? lv : min))
      games[id as BrainGameId] = {
        level: clampLv(rescale(g.level)),
        bestLevel: clampLv(rescale(Number(g.bestLevel) || g.level)),
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
    if (oldScale) for (const id of V2_RESCALED) delete bestRuns[id]
    const qe = (data.quickEye ?? {}) as Partial<QuickEyeProgress>
    const quickEye: QuickEyeProgress = {
      variant: Math.min(LEGACY_QUICK_EYE.maxVariant, Math.max(1, Math.round(num(qe.variant, 1)))),
      recentMs: Array.isArray(qe.recentMs) ? qe.recentMs.filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(-LEGACY_QUICK_EYE.window) : [],
      recentOk: typeof qe.recentOk === 'string' ? qe.recentOk.replace(/[^01]/g, '').slice(-LEGACY_QUICK_EYE.window) : '',
      thresholdMs: typeof qe.thresholdMs === 'number' && Number.isFinite(qe.thresholdMs) ? qe.thresholdMs : null,
    }
    if (quickEye.recentMs.length !== quickEye.recentOk.length) {
      quickEye.recentMs = []
      quickEye.recentOk = ''
    }
    const centerOnly = data.settings?.centerOnly === true
    // A record from the old dark field, once: its window measured flashes an afterimage made easy,
    // so it is dropped (the stage stays; the round recalibrates the speed level). Its variant 1 —
    // where every record used to start — becomes 2, where they start now (the centre-only setting
    // keeps 1), and its best Quick Eye score, earned on that easier screen, is cleared.
    if (data.quickEyeField !== 2) {
      quickEye.recentMs = []
      quickEye.recentOk = ''
      quickEye.thresholdMs = null
      if (quickEye.variant === 1 && !centerOnly) quickEye.variant = 2
      delete (bestRuns as Record<string, number>).quickEye
    }
    const se = (data.sessions ?? {}) as Partial<SessionLog>
    const booster = se.booster && typeof se.booster === 'object' ? se.booster : { index: 0, sessions: 0 }
    const sessions: SessionLog = {
      recentDays: Array.isArray(se.recentDays) ? se.recentDays.filter(isDay).slice(-12) : [],
      total: num(se.total),
      // Records from before the weekly cap: every session counted then.
      course: typeof se.course === 'number' ? Math.round(num(se.course)) : Math.min(num(se.total), CORE_COURSE_SESSIONS),
      minutes: num(se.minutes),
      coreDoneOn: isDay(se.coreDoneOn) ? se.coreDoneOn : null,
      booster: { index: Math.round(num(booster.index)), sessions: Math.round(num(booster.sessions)) },
      recentGames: Array.isArray(se.recentGames) ? se.recentGames.filter((x): x is BrainGameId => typeof x === 'string').slice(-9) : [],
    }
    const timing = data.settings && TIMING_MODES.includes(data.settings.timing) ? data.settings.timing : 1
    return {
      v: 3,
      games,
      totalRounds: num(data.totalRounds),
      totalPoints: num(data.totalPoints),
      lastDay: isDay(data.lastDay) ? data.lastDay : null,
      dayStreak: num(data.dayStreak),
      todayRounds: num(data.todayRounds),
      bestRuns,
      practiced: Array.isArray(data.practiced) ? data.practiced.filter((x): x is BrainGameId => typeof x === 'string') : [],
      quickEye,
      quickEyeField: 2,
      sessions,
      settings: { timing, centerOnly, sound: data.settings?.sound !== false, sessionMinutes: data.settings?.sessionMinutes === 20 ? 20 : 5 },
    }
  } catch {
    return emptyProgress()
  }
}
