import type { Rng } from './rng'
import type { BrainGameId } from './types'
import { BRAIN_GAMES } from './catalog'
import {
  type BrainProgress,
  BOOSTER_MONTHS,
  BOOSTER_SESSIONS,
  CORE_COURSE_SESSIONS,
  WEEKLY_GOAL,
  dayDiff,
} from './progress'

/**
 * Today's Training — the default way in, and the unit the research counts.
 *
 * The evidence ties outcomes to completed dose, not to play time: studies that trained about three
 * times a week did better than ones that trained more (Lampit 2014, a cross-study comparison), the
 * original training ran ten sessions over five or six weeks with refreshers about 11 and 35 months
 * later (Ball 2002), and endless short gamified play is the design that showed nothing (Owen 2010).
 * So a session is bounded: Quick Eye first, then three rotating games, about 22 minutes, then an
 * end screen. Sessions under 30 minutes have weak evidence; the research page says so plainly.
 */
export interface PlanSlot {
  gameId: BrainGameId
  /** Time budget for this game. When a round ends with under a minute left, the session moves on. */
  minutes: number
  /** Most rounds in this slot (Quick Eye: 4). */
  maxRounds: number
}

export const QUICK_EYE_SLOT: PlanSlot = { gameId: 'quickEye', minutes: 10, maxRounds: 4 }
export const GAME_SLOT_MINUTES = 4

const byRole = (role: string) => BRAIN_GAMES.filter((g) => g.role === role).map((g) => g.id)

/**
 * The candidate used longest ago in Today's Training (never used = longest), ties broken by the rng.
 * Not by trial count: a fast game piles up trials four times quicker than a slow one, so counting
 * trials kept steering the session back to the same slow games.
 */
function leastPlayed(p: BrainProgress, ids: BrainGameId[], rng: Rng): BrainGameId {
  const recent = p.sessions.recentGames
  const lastUse = (id: BrainGameId) => recent.lastIndexOf(id)
  const shuffled = rng.shuffle(ids)
  return shuffled.reduce((best, id) => (lastUse(id) < lastUse(best) ? id : best), shuffled[0])
}

/**
 * The session line-up: Quick Eye, one speed game (Odd One Out / Number Hunt — the other
 * processing-speed tasks), one memory-span or reasoning game, and a third that is a variety game
 * (Match Pairs, Color Word, Quick Math — no specific evidence) only every other session.
 */
export function planTodaysSession(p: BrainProgress, rng: Rng): PlanSlot[] {
  const speed = leastPlayed(p, byRole('speed'), rng)
  const spanOrReasoning = [...byRole('span'), ...byRole('reasoning')]
  const second = leastPlayed(p, spanOrReasoning, rng)
  const thirdPool = p.sessions.total % 2 === 0 ? byRole('variety') : spanOrReasoning.filter((id) => id !== second)
  const third = leastPlayed(p, thirdPool, rng)
  return [
    QUICK_EYE_SLOT,
    { gameId: speed, minutes: GAME_SLOT_MINUTES, maxRounds: 6 },
    { gameId: second, minutes: GAME_SLOT_MINUTES, maxRounds: 6 },
    { gameId: third, minutes: GAME_SLOT_MINUTES, maxRounds: 6 },
  ]
}

export function plannedMinutes(slots: readonly PlanSlot[]): number {
  return slots.reduce((a, s) => a + s.minutes, 0)
}

/** Monday of the week containing `day` (local calendar), as YYYY-MM-DD. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dow)
  return date.toISOString().slice(0, 10)
}

/** Sessions completed this week (Monday to Sunday), out of the weekly goal. */
export function weekProgress(p: BrainProgress, today: string): { done: number; goal: number } {
  const start = weekStart(today)
  const done = p.sessions.recentDays.filter((day) => day >= start && day <= today).length
  return { done, goal: WEEKLY_GOAL }
}

export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(d, last))
  return date.toISOString().slice(0, 10)
}

export interface CourseStatus {
  /** 'core' until ten sessions; 'booster' while a refresher is open; 'maintenance' between them. */
  phase: 'core' | 'booster' | 'maintenance'
  coreDone: number
  coreTotal: number
  /** The refresher open now (1 or 2), its sessions so far and its target. */
  booster: { index: number; done: number; total: number } | null
  /** When the next refresher opens (local day), if one is still ahead. */
  nextBoosterOn: string | null
}

export function courseStatus(p: BrainProgress, today: string): CourseStatus {
  const s = p.sessions
  const coreDone = Math.min(CORE_COURSE_SESSIONS, s.total)
  if (!s.coreDoneOn) {
    return { phase: 'core', coreDone, coreTotal: CORE_COURSE_SESSIONS, booster: null, nextBoosterOn: null }
  }
  for (let i = 0; i < BOOSTER_MONTHS.length; i++) {
    const index = i + 1
    const opensOn = addMonths(s.coreDoneOn, BOOSTER_MONTHS[i])
    const finished = s.booster.index > index || (s.booster.index === index && s.booster.sessions >= BOOSTER_SESSIONS)
    if (finished) continue
    if (dayDiff(opensOn, today) >= 0) {
      const done = s.booster.index === index ? s.booster.sessions : 0
      return { phase: 'booster', coreDone, coreTotal: CORE_COURSE_SESSIONS, booster: { index, done, total: BOOSTER_SESSIONS }, nextBoosterOn: null }
    }
    return { phase: 'maintenance', coreDone, coreTotal: CORE_COURSE_SESSIONS, booster: null, nextBoosterOn: opensOn }
  }
  return { phase: 'maintenance', coreDone, coreTotal: CORE_COURSE_SESSIONS, booster: null, nextBoosterOn: null }
}

/** The refresher a session completed today should count toward, if any. */
export function openBooster(p: BrainProgress, today: string): number | null {
  const c = courseStatus(p, today)
  return c.booster ? c.booster.index : null
}
