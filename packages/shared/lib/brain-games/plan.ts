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
 * So a session is bounded: a varied set of games, then an end screen. The player picks 5 minutes
 * (the default) or 20 — a product decision (2026-11-13: 20 minutes was too long to start every
 * time, and every session looked the same). The studies ran 20-75 minute
 * sessions and sessions under 30 minutes had weak evidence; the research page says so plainly, and
 * nothing in the app presents either length as a studied dose.
 */
export interface PlanSlot {
  gameId: BrainGameId
  /** Time budget for this game. When a round ends with under a minute left, the session moves on. */
  minutes: number
  /** Most rounds in this slot (Quick Eye: 4). */
  maxRounds: number
}

/** The day's emphasis — a light theme so sessions do not all feel alike. */
export type SessionFocus = 'mixed' | 'speed' | 'memory' | 'thinking'

/** Per session length: how many games, the shortest slot, and slot sizes in half-minute steps. */
const LENGTHS = {
  5: { counts: [2, 3, 3, 4], minSlot: 1, slowMin: 1.5 },
  20: { counts: [3, 4, 4, 5, 5, 6], minSlot: 2.5, slowMin: 3 },
} as const
/** Games whose single trial is long (a whole board): they need a bigger slot to be worth starting. */
const SLOW: readonly BrainGameId[] = ['schulte', 'pairs', 'quickEye']
const FOCI: readonly SessionFocus[] = ['mixed', 'mixed', 'speed', 'memory', 'thinking']
const FOCUS_SKILLS: Record<Exclude<SessionFocus, 'mixed'>, readonly string[]> = {
  speed: ['speed', 'attention'],
  memory: ['memory'],
  thinking: ['reasoning', 'attention', 'speed'],
}
const THINKING: readonly BrainGameId[] = ['series', 'math', 'stroop']

const skillOf = (id: BrainGameId) => BRAIN_GAMES.find((g) => g.id === id)!.skill

function matchesFocus(id: BrainGameId, focus: SessionFocus): boolean {
  if (focus === 'mixed') return false
  if (focus === 'thinking') return THINKING.includes(id)
  return FOCUS_SKILLS[focus].includes(skillOf(id))
}

/** Split `total` minutes over the games in half-minute steps: everyone gets a floor, the rest by random weight. */
function splitMinutes(games: readonly BrainGameId[], total: number, minSlot: number, slowMin: number, rng: Rng): number[] {
  const units = Math.round(total * 2)
  const floors = games.map((id) => Math.round((SLOW.includes(id) ? slowMin : minSlot) * 2))
  let left = units - floors.reduce((a, b) => a + b, 0)
  const weights = games.map(() => 0.7 + rng.next() * 0.7)
  const sum = weights.reduce((a, b) => a + b, 0)
  const extra = weights.map((w) => Math.floor((w / sum) * left))
  left -= extra.reduce((a, b) => a + b, 0)
  // The last half-minutes go to the heaviest weights.
  const order = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) extra[order[k].i]++
  return floors.map((f, i) => (f + extra[i]) / 2)
}

/**
 * Today's session: a different mix every time — how many games, which ones, in what order, and how
 * the minutes are split — within the length the player picked (5 or 20 minutes).
 *
 * - The day's focus (mixed, speed, memory, thinking) leans the picks; mixed avoids two games of the
 *   same kind.
 * - Games used longest ago in Today's Training come first, so all nine keep turning up.
 * - Quick Eye — the task closest to the studied training — is in at least every other session, at
 *   any position, not pinned to the start.
 * - Each game plays until its time is up (the round ends after the trial in play); slow games
 *   (Number Hunt, Match Pairs, Quick Eye) get a slot big enough for a few boards.
 */
export function planToday(p: BrainProgress, rng: Rng): { focus: SessionFocus; slots: PlanSlot[] } {
  const total: 5 | 20 = p.settings.sessionMinutes === 20 ? 20 : 5
  const shape = LENGTHS[total]
  const focus = rng.pick(FOCI)
  const count: number = rng.pick(shape.counts)
  const withQuickEye = p.sessions.total % 2 === 0 || rng.chance(0.5)

  const recent = p.sessions.recentGames
  // How recently a game was used in Today's Training: 0 = not lately, up to 9 = the last game played.
  const recency = (id: BrainGameId) => {
    const at = recent.lastIndexOf(id)
    return at < 0 ? 0 : Math.max(0, 10 - (recent.length - at))
  }
  const picked: BrainGameId[] = withQuickEye ? ['quickEye'] : []
  const pool = rng.shuffle(BRAIN_GAMES.map((g) => g.id).filter((id) => id !== 'quickEye'))
  while (picked.length < count) {
    const usedSkills = new Set(picked.map(skillOf))
    const scored = pool
      .filter((id) => !picked.includes(id))
      .map((id) => ({
        id,
        // Lower is better: used longest ago, matching the focus, a new kind of game for a mixed day.
        score: recency(id) - (matchesFocus(id, focus) ? 6 : 0) + (focus === 'mixed' && usedSkills.has(skillOf(id)) ? 4 : 0) + rng.next() * 2,
      }))
      .sort((a, b) => a.score - b.score)
    if (scored.length === 0) break
    picked.push(scored[0].id)
  }
  // Too many slow boards for a short session: drop games until every slot can hold its floor.
  const floorOf = (id: BrainGameId) => (SLOW.includes(id) ? shape.slowMin : shape.minSlot)
  while (picked.length > 1 && picked.reduce((a, id) => a + floorOf(id), 0) > total) picked.pop()

  const games = rng.shuffle(picked)
  const minutes = splitMinutes(games, total, shape.minSlot, shape.slowMin, rng)
  // The label says what the session turned out to be: a focus only when most of its games fit it.
  const fits = games.filter((id) => matchesFocus(id, focus)).length
  const shown: SessionFocus = focus !== 'mixed' && fits * 2 >= games.length ? focus : 'mixed'
  return { focus: shown, slots: games.map((gameId, i) => ({ gameId, minutes: minutes[i], maxRounds: 6 })) }
}

/** The line-up alone (see planToday). */
export function planTodaysSession(p: BrainProgress, rng: Rng): PlanSlot[] {
  return planToday(p, rng).slots
}

/**
 * The seed for today's line-up: the same all day until a session is finished, so the line-up the
 * home screen previews is the one that plays (and a reload does not reshuffle it).
 */
export function todaysPlanSeed(p: BrainProgress, today: string): number {
  const [y, m, d] = today.split('-').map(Number)
  return ((y * 372 + m * 31 + d) * 101 + p.sessions.total * 7919) >>> 0
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
  const coreDone = Math.min(CORE_COURSE_SESSIONS, s.course)
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
