/**
 * Save format v2 (GAMES_DIFFICULTY_PLAN §2.2): the hard-content change moved the board games'
 * levels to a new scale. A v1 document is converted exactly once, when it is read; a v2 document is
 * never converted again; merges compare like with like; and the format number is what makes an old
 * app stop syncing (isNewerFormat) and the server refuse an older write (migration 288).
 */
import { describe, it, expect } from 'vitest'
import {
  BRAIN_HISTORY_FORMAT,
  BRAIN_META_FORMAT,
  BRAIN_PROGRESS_FORMAT,
  TIERS,
  V1_TIERS,
  docVersion,
  emptyHistory,
  emptyMeta,
  emptyProgress,
  isNewerFormat,
  migrateLevelV1,
  parseHistory,
  parseMeta,
  parseProgress,
  reconcile,
  serializeHistory,
  serializeMeta,
  serializeProgress,
  standing,
  standingOn,
  tierFor,
  type BrainGameId,
} from '@reeeeecall/shared/lib/brain-games'

const v1Tier = (id: BrainGameId, lv: number) => V1_TIERS[id].filter((t) => lv >= t - 1e-9).length

/** A v1 save shaped like a long-time player's: every game played, best scores, a v1 estimate per game. */
const V1_PROGRESS = JSON.stringify({
  v: 1,
  games: {
    math: { level: 3, bestLevel: 7, rounds: 120, wins: 100 },
    series: { level: 10, bestLevel: 12, rounds: 40, wins: 30 },
    oddOneOut: { level: 26, bestLevel: 30, rounds: 80, wins: 60 },
    schulte: { level: 12, bestLevel: 14, rounds: 30, wins: 25 },
    stroop: { level: 17, bestLevel: 20, rounds: 50, wins: 40 },
    pairs: { level: 11, bestLevel: 16, rounds: 20, wins: 15 },
    memoryGrid: { level: 6, bestLevel: 9, rounds: 14, wins: 9 },
    sequence: { level: 18, bestLevel: 20, rounds: 14, wins: 9 },
    quickEye: { level: 7, bestLevel: 9, rounds: 60, wins: 50 },
  },
  totalRounds: 400,
  totalPoints: 12345,
  lastDay: '2026-11-10',
  dayStreak: 2,
  todayRounds: 0,
  bestRuns: { math: 900, series: 800, oddOneOut: 700, schulte: 600, stroop: 500, pairs: 400, memoryGrid: 300, sequence: 200, quickEye: 100, mix: 1500 },
  practiced: ['math', 'stroop'],
  quickEye: { variant: 5, recentMs: [100, 83], recentOk: '11', thresholdMs: null },
  quickEyeField: 2,
  sessions: { recentDays: ['2026-11-10'], total: 1, course: 1, minutes: 20, coreDoneOn: null, booster: { index: 0, sessions: 0 }, recentGames: [] },
  settings: { timing: 1, centerOnly: false, sound: true, sessionMinutes: 5 },
})

const V1_META = JSON.stringify({
  v: 1,
  sk: {
    math: { mu: 3.4, sd: 1, n: 120, day: 1000 },
    oddOneOut: { mu: 26, sd: 1.2, n: 80, day: 1001 },
    pairs: { mu: 11, sd: 1, n: 20, day: 1002 },
    memoryGrid: { mu: 6, sd: 1, n: 14, day: 1003 },
    sequence: { mu: 18, sd: 1, n: 14, day: 1004 },
    quickEye: { mu: 7, sd: 0.8, n: 60, day: 1005 },
  },
  tier: { math: 2, oddOneOut: 4, sequence: 6 },
  seen: 'ff',
  ach: '3',
  practice: { math: 4 },
  wipes: {},
  rt: { math: 2100 },
  span2: { sequence: 18, memoryGrid: 5 },
  span1: { sequence: 16 },
})

describe('migrateLevelV1 (GAMES_DIFFICULTY_PLAN §2.2)', () => {
  it('Quick Math and Number Pattern by their lines, clamped', () => {
    expect(migrateLevelV1('math', 3)).toBeCloseTo(2.35)
    expect(migrateLevelV1('math', 10)).toBeCloseTo(5.5)
    expect(migrateLevelV1('math', 40)).toBe(12)
    expect(migrateLevelV1('math', 0)).toBe(1)
    expect(migrateLevelV1('series', 10)).toBeCloseTo(7.5)
    expect(migrateLevelV1('series', 30)).toBe(14)
    expect(migrateLevelV1('series', 1)).toBe(1)
  })

  it('Odd One Out, Number Hunt, Color Word keep their standing: the tier an old level reached is the tier the new one reaches', () => {
    for (const id of ['oddOneOut', 'schulte', 'stroop'] as const) {
      for (let lv = 1; lv <= 60; lv += 0.5) {
        const moved = migrateLevelV1(id, lv)
        expect(standing(id, moved), `${id} ${lv}`).toBeCloseTo(standingOn(V1_TIERS, id, lv), 9)
        expect(tierFor(id, moved), `${id} ${lv}`).toBe(v1Tier(id, lv))
        expect(moved).toBeLessThanOrEqual(TIERS[id][5])
      }
    }
    // Odd One Out old 26 is halfway from its platinum (22) to diamond (30); on the new table that is
    // halfway from 13 to 17. (The plan's worked example says 11.5; its own formula gives 15.)
    expect(migrateLevelV1('oddOneOut', 26)).toBeCloseTo(15)
    expect(migrateLevelV1('oddOneOut', 1)).toBe(1)
  })

  it('Match Pairs by board, span games as they were (clamped to 14), Quick Eye untouched', () => {
    const pairs = [[1, 1], [3, 1], [3.9, 1], [4, 2], [6, 2], [7, 4], [9, 4], [10, 6], [12, 6], [13, 9], [15, 9], [16, 11], [23, 11], [24, 12], [99, 12]]
    for (const [old, now] of pairs) expect(migrateLevelV1('pairs', old), String(old)).toBe(now)
    expect(migrateLevelV1('memoryGrid', 9)).toBe(9)
    expect(migrateLevelV1('sequence', 20)).toBe(14)
    expect(migrateLevelV1('sequence', 0.5)).toBe(1)
    expect(migrateLevelV1('quickEye', 7.25)).toBe(7.25)
    expect(migrateLevelV1('quickEye', 0)).toBe(0)
  })
})

describe('reading a v1 save', () => {
  it('progress: board-game levels on the v2 scale, their best scores cleared, Quick Eye and the rest kept, written as v2', () => {
    const p = parseProgress(V1_PROGRESS)
    expect(p.v).toBe(2)
    const raw = JSON.parse(V1_PROGRESS)
    for (const id of ['math', 'series', 'oddOneOut', 'schulte', 'stroop', 'pairs', 'memoryGrid', 'sequence'] as const) {
      expect(p.games[id]?.level, id).toBeCloseTo(migrateLevelV1(id, raw.games[id].level), 9)
      expect(p.games[id]?.bestLevel, id).toBeCloseTo(migrateLevelV1(id, raw.games[id].bestLevel), 9)
      expect(p.games[id]?.rounds, id).toBe(raw.games[id].rounds)
      expect(p.bestRuns[id], id).toBeUndefined()
    }
    expect(p.games.math?.level).toBeCloseTo(2.35)
    expect(p.games.oddOneOut?.level).toBeCloseTo(15)
    expect(p.games.pairs).toMatchObject({ level: 6, bestLevel: 11 })
    expect(p.games.sequence).toMatchObject({ level: 14, bestLevel: 14 })
    // Quick Eye (its own field change already handled) and Today's Training's best stay.
    expect(p.games.quickEye).toEqual(raw.games.quickEye)
    expect(p.bestRuns).toEqual({ quickEye: 100, mix: 1500 })
    expect(p.quickEye).toEqual(raw.quickEye)
    expect(p.sessions).toEqual(raw.sessions)
    expect([p.totalRounds, p.totalPoints, p.lastDay, p.practiced]).toEqual([400, 12345, '2026-11-10', ['math', 'stroop']])
  })

  it('meta: the rebuilt games re-open their estimate on the v2 scale (sd 9, n 0); span estimates stay, clamped; tiers stay', () => {
    const m = parseMeta(V1_META)
    expect(m.v).toBe(2)
    expect(m.sk.math).toEqual({ mu: migrateLevelV1('math', 3.4), sd: 9, n: 0, day: 1000 })
    expect(m.sk.oddOneOut).toEqual({ mu: 15, sd: 9, n: 0, day: 1001 })
    expect(m.sk.pairs).toEqual({ mu: 6, sd: 9, n: 0, day: 1002 })
    expect(m.sk.memoryGrid).toEqual({ mu: 6, sd: 1, n: 14, day: 1003 })
    expect(m.sk.sequence).toEqual({ mu: 14, sd: 1, n: 14, day: 1004 })
    expect(m.sk.quickEye).toEqual({ mu: 7, sd: 0.8, n: 60, day: 1005 })
    expect(m.tier).toEqual({ math: 2, oddOneOut: 4, sequence: 6 })
    expect(m.span2).toEqual({ sequence: 14, memoryGrid: 5 })
    expect(m.span1).toEqual({ sequence: 14 })
    expect([m.seen, m.ach, m.practice, m.rt]).toEqual(['ff', '3', { math: 4 }, { math: 2100 }])
  })

  it('history: entries move to the v2 scale (a history with no version is v1), once', () => {
    const v1 = JSON.stringify({ v: 1, rounds: { math: [[1000, 30, 80], [1001, 100, 90]], oddOneOut: [[1000, 260, 70]], quickEye: [[1000, 72, 75]] } })
    const h = parseHistory(v1)
    expect(h.v).toBe(2)
    expect(h.rounds.math).toEqual([[1000, 24, 80], [1001, 55, 90]])
    expect(h.rounds.oddOneOut).toEqual([[1000, 150, 70]])
    expect(h.rounds.quickEye).toEqual([[1000, 72, 75]])
    expect(parseHistory(JSON.stringify({ rounds: { math: [[1000, 30, 80]] } })).rounds.math).toEqual([[1000, 24, 80]])
    // A v2 history is read as written.
    expect(parseHistory(serializeHistory(h))).toEqual(h)
    expect(parseHistory(JSON.stringify({ v: 2, rounds: { math: [[1000, 30, 80]] } })).rounds.math).toEqual([[1000, 30, 80]])
  })

  it('reading the same v1 document twice gives the same v2 document, and reading that again changes nothing', () => {
    expect(parseProgress(V1_PROGRESS)).toEqual(parseProgress(V1_PROGRESS))
    expect(parseMeta(V1_META)).toEqual(parseMeta(V1_META))
    const p = parseProgress(V1_PROGRESS)
    const m = parseMeta(V1_META)
    expect(parseProgress(serializeProgress(p))).toEqual(p)
    expect(parseProgress(serializeProgress(parseProgress(serializeProgress(p))))).toEqual(p)
    expect(parseMeta(serializeMeta(m))).toEqual(m)
    // New records are v2 from the start.
    expect([emptyProgress().v, emptyMeta().v, emptyHistory().v]).toEqual([2, 2, 2])
    expect(parseProgress('{"v":3,"games":{}}')).toEqual(emptyProgress())
    expect(parseMeta('{"v":3}')).toEqual(emptyMeta())
  })
})

describe('the format lock', () => {
  it('this app writes v2; an app that only knows v1 sees every written document as newer and stops syncing', () => {
    expect([BRAIN_PROGRESS_FORMAT, BRAIN_HISTORY_FORMAT, BRAIN_META_FORMAT]).toEqual([2, 2, 2])
    const local = { progress: parseProgress(V1_PROGRESS), history: emptyHistory(), meta: parseMeta(V1_META) }
    const { encoded } = reconcile(local, null)
    // An old app's check (its formats were 1): every document is newer.
    for (const doc of [encoded.progress, encoded.history, encoded.meta]) expect(docVersion(doc)).toBeGreaterThan(1)
    // This app: a v1 copy is older, never "newer"; a v3 one is.
    expect(isNewerFormat({ progress: { v: 1 }, history: { v: 1 }, meta: { v: 1 } })).toBe(false)
    expect(isNewerFormat({ progress: { v: 2 }, history: { v: 2 }, meta: { v: 3 } })).toBe(true)
  })

  it('a v1 cloud copy is converted before it is merged — max(bestLevel) compares like with like — and written back as v2', () => {
    // This device already plays on the v2 scale: math best 5. The cloud holds an old app's copy at v1 math best 20 (= 10 on v2).
    const p = emptyProgress()
    const local = { progress: { ...p, games: { math: { level: 4, bestLevel: 5, rounds: 10, wins: 8 } } }, history: emptyHistory(), meta: emptyMeta() }
    const cloud = {
      progress: { ...JSON.parse(serializeProgress(p)), v: 1, games: { math: { level: 18, bestLevel: 20, rounds: 200, wins: 180 } } },
      history: { v: 1, rounds: { math: [[1000, 180, 90]] } },
      meta: { ...JSON.parse(serializeMeta(emptyMeta())), v: 1, sk: { math: { mu: 18, sd: 1, n: 200, day: 1000 } } },
    }
    const r = reconcile(local, cloud)
    // The cloud record has more trials: it wins, on the v2 scale; bestLevel is the max of like values.
    expect(r.merged.progress.games.math).toMatchObject({ level: migrateLevelV1('math', 18), bestLevel: migrateLevelV1('math', 20), rounds: 200 })
    expect(r.merged.meta.sk.math).toEqual({ mu: migrateLevelV1('math', 18), sd: 9, n: 0, day: 1000 })
    expect(r.merged.history.rounds.math).toEqual([[1000, Math.round(migrateLevelV1('math', 18) * 10), 90]])
    expect(r.push).toBe(true)
    expect([r.encoded.progress.v, r.encoded.history.v, r.encoded.meta.v]).toEqual([2, 2, 2])
    // Pushed and read back (as the next sync does): nothing changes, nothing to push.
    const again = reconcile(r.merged, JSON.parse(JSON.stringify(r.encoded)))
    expect(again.push).toBe(false)
    expect(again.merged).toEqual(r.merged)
  })
})
