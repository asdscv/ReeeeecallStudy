/**
 * Cloud save (migration 288): the pure merge in shared/lib/brain-games/sync.ts, and the store that
 * drives it against a fake server with the RPC's rules (rev compare-and-swap, p_user_id assertion,
 * format-version refusal). The point of the feature is that a new phone, a reinstall or the
 * web↔app switch opens at the levels the player reached — and that no sync can lose a round, invent
 * one, or move another account's record.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  emptyHistory,
  emptyMeta,
  emptyProgress,
  gameProgress,
  isNewerFormat,
  jsonbTextBytes,
  mergeDocs,
  mergeHistory,
  mergeMeta,
  mergeProgress,
  reconcile,
  recordHistory,
  recordRound,
  recordRun,
  recordSession,
  markPracticed,
  migrateLevelV1,
  sameDoc,
  serializeProgress,
  stableJson,
  updateSettings,
  weekProgress,
  type BrainGameId,
  type BrainMeta,
  type BrainProgress,
} from '@reeeeecall/shared/lib/brain-games'
import type { BrainCloud, CloudFetch, CloudPush } from '@reeeeecall/shared/stores/brain-cloud'
import type { BrainStorage } from '@reeeeecall/shared/stores/brain-store'

const D = (n: number) => `2026-11-${String(n).padStart(2, '0')}`
/**
 * Quick Eye, removed by the owner (2026-11-13): no longer a BrainGameId, but an old save (or an app
 * version that still has the game) can carry its record, which must keep merging exactly as before.
 */
const QE = 'quickEye' as unknown as BrainGameId

function play(p: BrainProgress, id: BrainGameId, trials: number, from: number, day = D(3)): BrainProgress {
  for (let i = 0; i < trials; i++) p = recordRound(p, id, { level: from + i * 0.1, correct: true, points: 10 }, day)
  return p
}

// ── the pure merge ──────────────────────────────────────────────────────────

describe('mergeProgress', () => {
  it('two devices: each game keeps the side with more trials, never a sum', () => {
    let shared = play(emptyProgress(), 'schulte', 10, 3, D(2))
    shared = recordSession(shared, 22, D(2), null, [QE, 'schulte', 'sequence', 'pairs'])
    let a = play(shared, 'schulte', 5, 4)
    a = recordSession(a, 22, D(3), null, [QE, 'schulte', 'memoryGrid', 'pairs'])
    let b = play(shared, 'sequence', 4, 2)
    b = recordSession(b, 22, D(3), null, [QE, 'oddOneOut', 'sequence', 'stroop'])
    b = recordSession(b, 22, D(3), null, [QE, 'schulte', 'series', 'math'])

    const m = mergeProgress(a, b)
    expect(gameProgress(m, 'schulte').rounds).toBe(15)
    expect(gameProgress(m, 'schulte').level).toBeCloseTo(4.4)
    expect(gameProgress(m, 'sequence').rounds).toBe(4)
    // Two sessions on the 3rd on one device, one on the other: two that day, not three, not one.
    expect(m.sessions.recentDays).toEqual([D(2), D(3), D(3)])
    expect(m.sessions.total).toBe(3)
    expect(weekProgress(m, D(3)).done).toBe(3)
    expect(m.sessions.recentGames).toEqual(b.sessions.recentGames) // the side with more sessions
    expect(m.totalRounds).toBe(Math.max(a.totalRounds, b.totalRounds))
    expect(mergeProgress(b, a).sessions).toEqual(m.sessions)
  })

  it('a tie on trials goes to the higher level; bestLevel is the best of both whoever wins', () => {
    const t1 = recordRound(emptyProgress(), 'math', { level: 7, correct: true, points: 1 }, D(4))
    const t2 = recordRound(emptyProgress(), 'math', { level: 9, correct: true, points: 1 }, D(4))
    expect(gameProgress(mergeProgress(t1, t2), 'math').level).toBe(9)
    expect(gameProgress(mergeProgress(t2, t1), 'math').level).toBe(9)
    const hi = recordRound(emptyProgress(), 'pairs', { level: 12, correct: true, points: 1 }, D(4))
    const lo = play(emptyProgress(), 'pairs', 3, 4)
    expect(gameProgress(mergeProgress(lo, hi), 'pairs').level).toBeCloseTo(4.2)
    expect(gameProgress(mergeProgress(lo, hi), 'pairs').bestLevel).toBe(12)
  })

  it("an old save's Quick Eye: a newer variant wins even with fewer trials, and its level travels with it", () => {
    const older = { ...play(emptyProgress(), QE, 40, 6), quickEye: { variant: 5, recentMs: [50], recentOk: '1', thresholdMs: 60 } }
    const newer = { ...play(emptyProgress(), QE, 12, 2), quickEye: { variant: 6, recentMs: [], recentOk: '', thresholdMs: 45 } }
    for (const m of [mergeProgress(older, newer), mergeProgress(newer, older)]) {
      expect(m.quickEye.variant).toBe(6)
      expect(gameProgress(m, QE).rounds).toBe(12)
      expect(gameProgress(m, QE).level).toBeCloseTo(newer.games[QE]!.level)
      expect(m.quickEye.thresholdMs).toBe(45)
    }
    // Same variant: more trials.
    const more = { ...older, quickEye: { ...older.quickEye, variant: 6 } }
    expect(mergeProgress(newer, more).quickEye.recentMs).toEqual([50])
    expect(gameProgress(mergeProgress(newer, more), QE).rounds).toBe(40)
  })

  it("an old save's Quick Eye: variants 1 and 2 rank together — a slow start placed at 1 is not undone by an untouched or behind variant 2", () => {
    const placed = { ...play(emptyProgress(), QE, 9, 0), quickEye: { variant: 1, recentMs: [100], recentOk: '1', thresholdMs: null } }
    // A fresh device (every record starts at variant 2) and the copy pushed mid-placement (fewer trials).
    const fresh = emptyProgress()
    const midPlacement = play(emptyProgress(), QE, 6, 0)
    for (const other of [fresh, midPlacement]) {
      expect(mergeProgress(placed, other).quickEye.variant).toBe(1)
      expect(mergeProgress(other, placed).quickEye.variant).toBe(1)
    }
    // Played on past it at variant 2 elsewhere (more trials): that side wins; and 3 still beats 1.
    const passed = { ...play(emptyProgress(), QE, 30, 2), quickEye: { variant: 2, recentMs: [], recentOk: '', thresholdMs: null } }
    expect(mergeProgress(placed, passed).quickEye.variant).toBe(2)
    const v3 = { ...play(emptyProgress(), QE, 2, 2), quickEye: { variant: 3, recentMs: [], recentOk: '', thresholdMs: null } }
    expect(mergeProgress(placed, v3).quickEye.variant).toBe(3)
    // Neither played: the same answer from both sides.
    const centreOnly = { ...emptyProgress(), quickEye: { ...emptyProgress().quickEye, variant: 1 } }
    expect(mergeProgress(centreOnly, fresh).quickEye.variant).toBe(mergeProgress(fresh, centreOnly).quickEye.variant)
  })

  it('bests are maxed, practice is a union, settings stay this device’s, the course is honest', () => {
    const r1 = markPracticed(recordRun(emptyProgress(), 'stroop', 50).progress, 'stroop')
    const r2 = updateSettings(markPracticed(recordRun(emptyProgress(), 'stroop', 80).progress, 'math'), { sound: false, timing: 2 })
    const m = mergeProgress(r1, r2)
    expect(m.bestRuns.stroop).toBe(80)
    expect(m.practiced).toEqual(['stroop', 'math'])
    expect(m.settings).toEqual(r1.settings)
    expect(mergeProgress(r2, r1).settings).toEqual(r2.settings)

    const a = { ...emptyProgress(), sessions: { ...emptyProgress().sessions, total: 12, minutes: 260, coreDoneOn: D(9), booster: { index: 1, sessions: 2 } } }
    const b = { ...emptyProgress(), sessions: { ...emptyProgress().sessions, total: 11, minutes: 300, coreDoneOn: D(7), booster: { index: 1, sessions: 3 } } }
    const s = mergeProgress(a, b).sessions
    expect(s).toMatchObject({ total: 12, minutes: 300, coreDoneOn: D(7), booster: { index: 1, sessions: 3 } })
    const c = { ...b, sessions: { ...b.sessions, booster: { index: 2, sessions: 1 } } }
    expect(mergeProgress(a, c).sessions.booster).toEqual({ index: 2, sessions: 1 })
  })

  it('is idempotent, and a never-played device takes the cloud copy whole', () => {
    let p = play(emptyProgress(), 'schulte', 6, 3)
    p = recordSession(p, 20, D(3), null, ['schulte'])
    expect(sameDoc(mergeProgress(p, p), p)).toBe(true)
    expect(sameDoc(mergeProgress(emptyProgress(), p), { ...p, settings: emptyProgress().settings })).toBe(true)
  })
})

describe('mergeHistory', () => {
  it('unions per game, counts a round seen on both sides once, keeps the latest 8 by day', () => {
    let a = recordHistory(emptyHistory(), 'schulte', { day: D(2), level: 3, accuracy: 1 })
    let b = recordHistory(emptyHistory(), 'schulte', { day: D(2), level: 3, accuracy: 1 })
    a = recordHistory(a, 'schulte', { day: D(4), level: 4, accuracy: 0.9 })
    b = recordHistory(b, 'schulte', { day: D(3), level: 3.5, accuracy: 0.8 })
    b = recordHistory(b, 'sequence', { day: D(3), level: 5, accuracy: 1 })
    const m = mergeHistory(a, b)
    expect(m.rounds.schulte!.map((e) => e[1])).toEqual([30, 35, 40])
    expect(m.rounds.sequence!.length).toBe(1)
    for (let i = 0; i < 20; i++) a = recordHistory(a, 'math', { day: D(1 + i), level: i, accuracy: 0.5 })
    const days = mergeHistory(a, b).rounds.math!.map((e) => e[0])
    expect(days.length).toBe(8)
    expect(days).toEqual([...days].sort((x, y) => x - y))
    expect(sameDoc(mergeHistory(m, m), m)).toBe(true)
  })
})

describe('mergeMeta', () => {
  const meta = (patch: Partial<BrainMeta>): BrainMeta => ({ ...emptyMeta(), ...patch })
  it('estimate and its per-game values from one side (more trials, tie → higher), tiers sticky, masks OR-ed', () => {
    const a = meta({
      sk: { schulte: { mu: 9, sd: 1, n: 40, day: 700 }, math: { mu: 5, sd: 2, n: 10, day: 700 } },
      tier: { schulte: 3, math: 1 },
      seen: '5',
      ach: '1',
      practice: { stroop: 2 },
      wipes: { pairs: 1 },
      rt: { schulte: 700, math: 1200 },
      span1: { sequence: 5 },
      span2: { sequence: 4 },
    })
    const b = meta({
      sk: { schulte: { mu: 11, sd: 1, n: 20, day: 701 }, math: { mu: 6, sd: 2, n: 10, day: 701 } },
      tier: { schulte: 2, math: 2 },
      seen: 'a',
      ach: '10',
      practice: { stroop: 4 },
      wipes: { pairs: 2 },
      rt: { schulte: 900, math: 1100, stroop: 800 },
      span1: { sequence: 4 },
      span2: { sequence: 6 },
    })
    for (const m of [mergeMeta(a, b), mergeMeta(b, a)]) {
      expect(m.sk.schulte).toEqual({ mu: 9, sd: 1, n: 40, day: 700 })
      expect(m.sk.math!.mu).toBe(6)
      expect(m.tier).toEqual({ schulte: 3, math: 2 })
      expect(m.seen).toBe('f')
      expect(m.ach).toBe('11')
      expect(m.practice.stroop).toBe(4)
      // No estimate on either side: a stable pick (the same on both devices), never a max.
      expect(m.wipes.pairs).toBe(1)
      expect(m.rt.schulte).toBe(700) // the side whose estimate has more trials, even though slower is larger
      expect(m.rt.math).toBe(1100) // goes with the estimate that won (tie on trials → higher mu)
      expect(m.rt.stroop).toBe(800)
      expect(m.span1.sequence).toBe(4)
      expect(m.span2.sequence).toBe(6)
    }
    expect(sameDoc(mergeMeta(a, a), a)).toBe(true)
  })
})

describe('mergeDocs', () => {
  const docs = (progress = emptyProgress(), m: BrainMeta = emptyMeta()) => ({ progress, history: emptyHistory(), meta: m })
  it('keeps a game record and its estimate together — a 200-round record never takes a 3-trial placement estimate', () => {
    const legacy = docs({ ...emptyProgress(), games: { stroop: { level: 20, bestLevel: 20, rounds: 200, wins: 150 } } })
    const phone = docs(
      { ...emptyProgress(), games: { stroop: { level: 5, bestLevel: 6, rounds: 3, wins: 2 } } },
      { ...emptyMeta(), sk: { stroop: { mu: 5, sd: 9, n: 0, day: 700 } }, wipes: { stroop: 1 } },
    )
    for (const m of [mergeDocs(legacy, phone), mergeDocs(phone, legacy)]) {
      expect(m.progress.games.stroop!.level).toBe(20)
      // The surviving record has no estimate: none is attached (the round takes the record's level).
      expect(m.meta.sk.stroop).toBeUndefined()
      expect(m.meta.wipes.stroop).toBeUndefined()
    }
  })

  it('two devices reach the same document, so they stop rewriting the cloud', () => {
    const a = docs({ ...markPracticed(markPracticed(emptyProgress(), 'stroop'), 'schulte'), games: { math: { level: 4, bestLevel: 4, rounds: 10, wins: 7 } } })
    const b = docs({ ...markPracticed(markPracticed(emptyProgress(), 'math'), 'schulte'), games: { math: { level: 4, bestLevel: 5, rounds: 10, wins: 6 } } })
    const ab = mergeDocs(a, b)
    const ba = mergeDocs(b, a)
    expect(stableJson({ ...ab.progress, settings: null })).toBe(stableJson({ ...ba.progress, settings: null }))
    expect(stableJson(ab.meta)).toBe(stableJson(ba.meta))
  })
})

describe('reconcile and formats', () => {
  const docs = (progress = emptyProgress()) => ({ progress, history: emptyHistory(), meta: emptyMeta() })

  it('creates no cloud row for an empty record, uploads a played one, and is quiet when equal', () => {
    expect(reconcile(docs(), null).push).toBe(false)
    expect(reconcile(docs(updateSettings(emptyProgress(), { sound: false })), null).push).toBe(false)
    expect(reconcile(docs(markPracticed(emptyProgress(), 'math')), null).push).toBe(true)
    const local = docs(play(emptyProgress(), 'schulte', 3, 2))
    const first = reconcile(local, null)
    expect(first.push).toBe(true)
    const echoed = JSON.parse(JSON.stringify(first.encoded))
    expect(reconcile(local, echoed).push).toBe(false)
    // Another device's settings are not a reason to write.
    const other = { ...echoed, progress: { ...echoed.progress, settings: { timing: 2, centerOnly: true, sound: false } } }
    expect(reconcile(local, other).push).toBe(false)
  })

  it('keeps top-level fields a newer app wrote, and refuses to merge a newer format', () => {
    const local = docs(play(emptyProgress(), 'schulte', 3, 2))
    const cloud = JSON.parse(JSON.stringify(reconcile(local, null).encoded))
    cloud.progress.placement = { schulte: 4 }
    cloud.meta.streakShield = 2
    const r = reconcile(local, cloud)
    expect(r.push).toBe(false)
    expect(r.encoded.progress.placement).toEqual({ schulte: 4 })
    expect(r.encoded.meta.streakShield).toBe(2)
    expect(isNewerFormat({ progress: { v: 4 }, history: { v: 3 }, meta: { v: 3 } })).toBe(true)
    expect(isNewerFormat({ progress: { v: 3 }, history: { v: 3 }, meta: { v: 4 } })).toBe(true)
    expect(isNewerFormat({ progress: { v: 3 }, history: null, meta: undefined })).toBe(false)
    // This app writes v3: a v1 copy (before the hard-content change) or a v2 one (before the thinking
    // games) is older, not newer.
    expect(isNewerFormat({ progress: { v: 1 }, history: { v: 1 }, meta: { v: 1 } })).toBe(false)
    expect(isNewerFormat({ progress: { v: 2 }, history: { v: 2 }, meta: { v: 2 } })).toBe(false)
  })

  it('measures size the way Postgres prints jsonb, and a worst-case record is far under 16KB', () => {
    expect(jsonbTextBytes({ a: 1, b: [1, 2] })).toBe('{"a": 1, "b": [1, 2]}'.length)
    expect(jsonbTextBytes({ s: '가' })).toBe(new TextEncoder().encode('{"s": "가"}').length)
    let p = emptyProgress()
    const ids: BrainGameId[] = [QE, 'schulte', 'stroop', 'oddOneOut', 'pairs', 'math', 'series', 'memoryGrid', 'sequence']
    for (const id of ids) p = play(p, id, 60, 5)
    for (let i = 0; i < 12; i++) p = recordSession(p, 22, D(1 + i), null, ids.slice(0, 4))
    expect(jsonbTextBytes(p)).toBeLessThan(4_000)
  })
})

// ── the store against a fake server ─────────────────────────────────────────

type Row = { progress: unknown; history: unknown; meta: unknown; rev: number }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const ver = (x: unknown) => ((x as { v?: number } | null)?.v ?? 0)

function fakeServer() {
  const db = new Map<string, Row>()
  const state = { missing: false, outdated: false, pushes: 0, fetches: 0 }
  function connect(session: { uid: string | null }) {
    const listeners = new Set<(event: string, uid: string | null) => void>()
    const cloud: BrainCloud = {
      async fetch(): Promise<CloudFetch> {
        state.fetches++
        if (state.missing) return { ok: false, reason: 'missing' }
        if (!session.uid) return { ok: false, reason: 'auth' }
        const row = db.get(session.uid)
        return { ok: true, save: row ? { userId: session.uid, ...clone(row), updatedAt: '' } : null }
      },
      async push({ userId, baseRev, progress, history, meta }): Promise<CloudPush> {
        state.pushes++
        if (state.missing) return { ok: false, reason: 'missing' }
        if (!session.uid) return { ok: false, reason: 'auth' }
        if (userId !== session.uid) return { ok: false, reason: 'account' } // the p_user_id assertion
        const row = db.get(session.uid)
        if (row && row.rev !== baseRev) return { ok: true, status: 'conflict', save: { userId: session.uid, ...clone(row), updatedAt: '' } }
        if (state.outdated) return { ok: true, status: 'client_outdated', rev: row?.rev ?? 0 }
        if (row && (ver(progress) < ver(row.progress) || ver(history) < ver(row.history) || ver(meta) < ver(row.meta))) {
          return { ok: true, status: 'client_outdated', rev: row.rev }
        }
        const next = { progress: clone(progress), history: clone(history), meta: clone(meta), rev: (row?.rev ?? 0) + 1 }
        db.set(session.uid, next)
        return { ok: true, status: 'saved', rev: next.rev, updatedAt: '' }
      },
      async currentUserId() {
        return session.uid
      },
      onAuthChange(cb) {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    }
    return { cloud, emit: (event: string, uid: string | null) => listeners.forEach((l) => l(event, uid)) }
  }
  return { db, state, connect }
}

/** A device = a fresh copy of the store module (its own module state) + its own disk. */
async function device(server: ReturnType<typeof fakeServer>, uid: string | null = 'u1') {
  vi.resetModules()
  const mod = await import('@reeeeecall/shared/stores/brain-store')
  const session = { uid }
  const { cloud, emit } = server.connect(session)
  mod.configureBrainCloud(cloud)
  const disk = new Map<string, string>()
  const storageFor = (u: string): BrainStorage => ({
    key: `k.${u}`,
    userId: u,
    load: () => disk.get(`p.${u}`) ?? null,
    save: (raw) => void disk.set(`p.${u}`, raw),
    loadHistory: () => disk.get(`h.${u}`) ?? null,
    saveHistory: (raw) => void disk.set(`h.${u}`, raw),
    loadMeta: () => disk.get(`m.${u}`) ?? null,
    saveMeta: (raw) => void disk.set(`m.${u}`, raw),
  })
  const store = mod.useBrainStore
  /** A round of play the way useBrainRound drives the store: a record per trial, then finishRun. */
  const round = (id: BrainGameId, trials: number, from: number) => {
    for (let i = 0; i < trials; i++) store.getState().record(id, { level: from + i * 0.1, correct: true, points: 10 })
    store.getState().finishRun(id, trials * 10, undefined, { level: from, accuracy: 1 })
  }
  return { store, flush: mod.flushBrainCloud, configure: mod.configureBrainCloud, session, emit, storageFor, disk, round }
}

/** Let every pending promise (fake server calls) run, without moving the clock. */
const idle = async () => {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0)
}
const level = (p: BrainProgress, id: BrainGameId) => gameProgress(p, id).level
const cloudGames = (row: Row | undefined) => Object.keys((row?.progress as { games?: object } | undefined)?.games ?? {}).sort()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-13T10:00:00'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('brain store cloud sync', () => {
  it('a new device opens at the level the account reached, and adopting the cloud writes nothing', async () => {
    const server = fakeServer()
    const A = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    await idle()
    A.round('schulte', 10, 6)
    await idle()
    expect(server.db.get('u1')?.rev).toBe(1)

    const B = await device(server)
    B.store.getState().hydrate(B.storageFor('u1'))
    expect(B.store.getState().cloudReady).toBe(false) // a round screen may wait for this
    expect(gameProgress(B.store.getState().progress, 'schulte').rounds).toBe(0)
    await idle()
    expect(B.store.getState().cloudReady).toBe(true)
    expect(gameProgress(B.store.getState().progress, 'schulte').rounds).toBe(10)
    expect(level(B.store.getState().progress, 'schulte')).toBeCloseTo(level(A.store.getState().progress, 'schulte'))
    expect(B.disk.get('p.u1')).toContain('schulte') // and it is on this device's disk too
    expect(server.db.get('u1')?.rev).toBe(1)
    expect(B.store.getState().cloudStatus).toBe('synced')
  })

  it('two devices playing different games: the conflict retry keeps both', async () => {
    const server = fakeServer()
    const A = await device(server)
    const B = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    B.store.getState().hydrate(B.storageFor('u1'))
    await idle()
    A.round('sequence', 3, 4)
    B.round('math', 2, 9)
    await idle()
    await A.store.getState().syncNow()
    await B.store.getState().syncNow()
    expect(cloudGames(server.db.get('u1'))).toEqual(['math', 'sequence'])
    expect(Object.keys(A.store.getState().progress.games).sort()).toEqual(['math', 'sequence'])
    expect(Object.keys(B.store.getState().progress.games).sort()).toEqual(['math', 'sequence'])
    expect(A.store.getState().cloudStatus).toBe('synced')
  })

  it('writes are debounced; flushBrainCloud (tab hidden, app backgrounded) sends at once', async () => {
    const server = fakeServer()
    const A = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    await idle()
    A.store.getState().record('stroop', { level: 3, correct: true, points: 1 })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(server.db.get('u1')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(cloudGames(server.db.get('u1'))).toEqual(['stroop'])

    A.store.getState().record('stroop', { level: 3.1, correct: true, points: 1 })
    await A.flush()
    expect(gameProgress(server.db.get('u1')!.progress as BrainProgress, 'stroop').rounds).toBe(2)
    const pushes = server.state.pushes
    await A.flush() // nothing new: no request
    expect(server.state.pushes).toBe(pushes)
  })

  it('a cloud copy arriving mid-round never moves the game being played; it merges at the round end', async () => {
    const server = fakeServer()
    const A = await device(server)
    const B = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    B.store.getState().hydrate(B.storageFor('u1'))
    await idle()
    // The phone played pairs a lot more, and stroop.
    A.round('pairs', 30, 10)
    A.round('stroop', 4, 5)
    await idle()

    // Mid-round on the web: two pairs trials at level 2.x, then the cloud copy arrives.
    B.store.getState().record('pairs', { level: 2, correct: true, points: 1 })
    B.store.getState().record('pairs', { level: 2.1, correct: true, points: 1 })
    await B.store.getState().syncNow()
    expect(level(B.store.getState().progress, 'pairs')).toBeCloseTo(2.1) // the round reads this after every trial
    expect(gameProgress(B.store.getState().progress, 'pairs').rounds).toBe(2)
    expect(B.store.getState().progress.games.stroop).toBeDefined() // other games merge right away
    // The cloud still holds the better pairs record — the pinned copy was not pushed over it.
    expect(gameProgress(server.db.get('u1')!.progress as BrainProgress, 'pairs').rounds).toBe(30)

    B.store.getState().record('pairs', { level: 2.2, correct: true, points: 1 })
    B.store.getState().finishRun('pairs', 3, undefined, { level: 2, accuracy: 1 })
    await idle()
    expect(gameProgress(B.store.getState().progress, 'pairs').rounds).toBe(30) // round over: more trials wins
    expect(cloudGames(server.db.get('u1'))).toEqual(['pairs', 'stroop'])
  })

  it('a round that opened on the old device record before the cloud copy arrived does not drag the account back down', async () => {
    const server = fakeServer()
    const A = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    await idle()
    A.round('math', 40, 12)
    await idle()
    const reached = level(A.store.getState().progress, 'math')

    // A new phone on a slow network: the round starts (at level 1) before the cloud answers.
    const B = await device(server)
    B.store.getState().hydrate(B.storageFor('u1'))
    await idle()
    B.store.getState().record('math', { level: 1.15, correct: true, points: 1 })
    expect(level(B.store.getState().progress, 'math')).toBeCloseTo(reached)
    expect(gameProgress(B.store.getState().progress, 'math').rounds).toBe(41)
    // A round that starts at the cloud level moves normally.
    B.store.getState().record('math', { level: reached - 0.85, correct: false, points: 0 })
    expect(level(B.store.getState().progress, 'math')).toBeCloseTo(reached - 0.85)
  })

  it('a round (here a first-time placement) open when the cloud copy lands never overwrites the account: the account wins at its end', async () => {
    const server = fakeServer()
    server.db.set('u1', {
      progress: play(emptyProgress(), 'stroop', 60, 18),
      history: emptyHistory(),
      meta: { ...emptyMeta(), sk: { stroop: { mu: 18.5, sd: 1, n: 60, day: 700 } } },
      rev: 3,
    })
    const account = level(server.db.get('u1')!.progress as BrainProgress, 'stroop')
    const B = await device(server)
    const real = server.connect(B.session).cloud
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    B.configure({ ...real, fetch: async () => { await gate; return real.fetch() } })
    B.store.getState().hydrate(B.storageFor('u1'))
    // The slow network: the round opens on the empty device record (placement), then the cloud answers.
    B.store.getState().beginRound('stroop')
    release()
    await idle()
    expect(B.store.getState().progress.games.stroop).toBeUndefined() // held still while the round is open
    B.store.getState().record('stroop', { level: 4, correct: true, points: 40 })
    B.store.getState().record('stroop', { level: 7, correct: false, points: 0 })
    // The round stops part-way: the hook saves an interrupted placement's estimate (n 0), no next start.
    B.store.getState().updateMeta((m) => ({ ...m, sk: { ...m.sk, stroop: { mu: 6, sd: 9, n: 0, day: 701 } } }))
    B.store.getState().finishRun('stroop', 40, undefined, { level: 7, accuracy: 0.5 })
    await idle()
    const after = B.store.getState()
    expect(level(after.progress, 'stroop')).toBe(account)
    expect(after.meta.sk.stroop).toEqual({ mu: 18.5, sd: 1, n: 60, day: 700 })
    const row = server.db.get('u1')!
    expect(level(row.progress as BrainProgress, 'stroop')).toBe(account)
    expect((row.meta as BrainMeta).sk.stroop!.mu).toBe(18.5)
  })

  it('account switch: a change still pending for one account never lands in another account’s row', async () => {
    const server = fakeServer()
    const C = await device(server)
    C.store.getState().hydrate(C.storageFor('u1'))
    await idle()
    C.store.getState().record('series', { level: 8, correct: true, points: 1 }) // debounced, not sent yet
    C.session.uid = 'u2'
    C.store.getState().hydrate(C.storageFor('u2'))
    await vi.advanceTimersByTimeAsync(10_000) // well past the debounce
    expect(server.db.get('u2')).toBeUndefined()
    expect(C.store.getState().progress.games.series).toBeUndefined()
    // u1's change is still on the device and goes up the next time u1 is here.
    expect(C.disk.get('p.u1')).toContain('series')
  })

  it('an answer that arrives after the account switched is dropped, not merged into the new account', async () => {
    const server = fakeServer()
    server.db.set('u1', { progress: play(emptyProgress(), 'stroop', 9, 7), history: emptyHistory(), meta: emptyMeta(), rev: 5 })
    const G = await device(server, 'u1')
    const real = server.connect(G.session).cloud
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    // The request goes out as u1; its answer is held until after the switch.
    G.configure({ ...real, push: async (input) => { const answer = await real.push(input); await gate; return answer } })
    G.store.getState().hydrate(G.storageFor('u1'))
    await idle()
    // Another u1 device saves meanwhile, so u1's push comes back as a conflict carrying u1's record.
    server.db.set('u1', { ...server.db.get('u1')!, progress: play(emptyProgress(), 'math', 20, 9), rev: 6 })
    G.store.getState().record('series', { level: 4, correct: true, points: 1 })
    void G.flush()
    await idle()
    G.session.uid = 'u2'
    G.store.getState().hydrate(G.storageFor('u2'))
    release()
    await idle()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(Object.keys(G.store.getState().progress.games)).toEqual([])
    expect(G.disk.get('p.u2') ?? '').not.toMatch(/math|stroop|series/)
    expect(server.db.get('u2')).toBeUndefined()
  })

  it('drops a cloud answer for a different account than the one on screen', async () => {
    const server = fakeServer()
    server.db.set('u2', { progress: play(emptyProgress(), 'stroop', 9, 7), history: emptyHistory(), meta: emptyMeta(), rev: 4 })
    const E = await device(server, 'u2') // the session already belongs to u2 …
    E.store.getState().hydrate(E.storageFor('u1')) // … while the screen still shows u1
    await idle()
    expect(E.store.getState().progress.games.stroop).toBeUndefined()
    expect(server.db.get('u1')).toBeUndefined()
    expect(E.store.getState().cloudReady).toBe(true)

    // The session switches while the read is in flight: the answer is u2's row — dropped.
    const F = await device(server, 'u1')
    const real = server.connect(F.session).cloud
    F.configure({ ...real, fetch: async () => { F.session.uid = 'u2'; return real.fetch() } })
    F.store.getState().hydrate(F.storageFor('u1'))
    await idle()
    expect(F.store.getState().progress.games.stroop).toBeUndefined()
    expect(F.disk.get('p.u1')).toBeUndefined()
    expect(server.db.get('u2')!.rev).toBe(4)
  })

  it('sign-out clears the record in memory and keeps the device copy', async () => {
    const server = fakeServer()
    const A = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    await idle()
    A.round('schulte', 3, 4)
    await idle()
    A.session.uid = null
    A.emit('SIGNED_OUT', null)
    expect(A.store.getState().storageKey).toBeNull()
    expect(A.store.getState().progress.games).toEqual({})
    expect(A.disk.get('p.u1')).toContain('schulte')
  })

  it('a newer-format cloud copy (an updated app on another device) is never merged or overwritten', async () => {
    const server = fakeServer()
    const newer = { progress: { v: 4, games: {}, something: 'new' }, history: { v: 3, rounds: {} }, meta: { v: 3 }, rev: 7 }
    server.db.set('u1', clone(newer))
    const A = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    await idle()
    expect(A.store.getState().cloudStatus).toBe('outdated')
    A.round('stroop', 3, 4) // still playable here
    await vi.advanceTimersByTimeAsync(10_000)
    expect(gameProgress(A.store.getState().progress, 'stroop').rounds).toBe(3)
    expect(server.db.get('u1')).toEqual(newer)
    expect(server.state.pushes).toBe(0)
  })

  it('a newer format written between read and write, or refused by the server: stops pushing', async () => {
    const server = fakeServer()
    const A = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    await idle()
    // Between this device's read and its write, a newer app writes meta v4: the conflict shows it.
    server.db.set('u1', { progress: { v: 3 }, history: { v: 3, rounds: {} }, meta: { v: 4 }, rev: 1 })
    A.store.getState().record('stroop', { level: 3, correct: true, points: 1 })
    await A.flush()
    expect(A.store.getState().cloudStatus).toBe('outdated')
    const pushes = server.state.pushes
    A.store.getState().record('stroop', { level: 3.1, correct: true, points: 1 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(server.state.pushes).toBe(pushes)
    expect((server.db.get('u1')!.meta as { v: number }).v).toBe(4)

    // The server's own refusal (client_outdated) stops it the same way.
    const other = fakeServer()
    other.state.outdated = true
    const B = await device(other)
    B.store.getState().hydrate(B.storageFor('u1'))
    await idle()
    B.store.getState().record('stroop', { level: 3, correct: true, points: 1 })
    await B.flush()
    expect(B.store.getState().cloudStatus).toBe('outdated')
    const sent = other.state.pushes
    B.store.getState().record('stroop', { level: 3.1, correct: true, points: 1 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(other.state.pushes).toBe(sent)
  })

  it('a v1 save (an app from before the hard-content change) is converted once and goes up as v3; an older write is then refused', async () => {
    const server = fakeServer()
    // The same old-app record on this device and in the cloud: Quick Math on the v1 scale.
    const v1Progress = { ...JSON.parse(serializeProgress(play(emptyProgress(), 'math', 20, 9))), v: 1 }
    const v1History = { v: 1, rounds: { math: [[1000, 109, 90]] } }
    const v1Meta = { ...emptyMeta(), v: 1, sk: { math: { mu: 10.5, sd: 1, n: 20, day: 1000 } } }
    server.db.set('u1', { progress: clone(v1Progress), history: clone(v1History), meta: clone(v1Meta), rev: 2 })
    const A = await device(server)
    A.disk.set('p.u1', JSON.stringify(v1Progress))
    A.disk.set('h.u1', JSON.stringify(v1History))
    A.disk.set('m.u1', JSON.stringify(v1Meta))
    A.store.getState().hydrate(A.storageFor('u1'))
    await idle()
    const once = migrateLevelV1('math', 10.9)
    expect(level(A.store.getState().progress, 'math')).toBeCloseTo(once)
    expect(A.store.getState().meta.sk.math).toEqual({ mu: migrateLevelV1('math', 10.5), sd: 9, n: 0, day: 1000 })
    expect(A.store.getState().cloudStatus).toBe('synced')
    const row = server.db.get('u1')!
    expect([ver(row.progress), ver(row.history), ver(row.meta)]).toEqual([3, 3, 3])
    // Converted exactly once: the cloud holds the same v2 levels as the device.
    expect(level(row.progress as BrainProgress, 'math')).toBeCloseTo(once)
    expect((row.meta as BrainMeta).sk.math?.mu).toBeCloseTo(migrateLevelV1('math', 10.5))
    expect((row.history as { rounds: { math: number[][] } }).rounds.math).toEqual([[1000, Math.round(migrateLevelV1('math', 10.9) * 10), 90]])
    // A second device reading it takes it as written.
    const B = await device(server)
    B.store.getState().hydrate(B.storageFor('u1'))
    await idle()
    expect(level(B.store.getState().progress, 'math')).toBeCloseTo(once)
    expect(server.db.get('u1')!.rev).toBe(row.rev)
    // An old app pushing its v1 copy now is refused (migration 288: a lower `v` than stored).
    const old = await server.connect({ uid: 'u1' }).cloud.push({ userId: 'u1', baseRev: row.rev, progress: clone(v1Progress), history: clone(v1History), meta: clone(v1Meta) })
    expect(old).toMatchObject({ ok: true, status: 'client_outdated' })
    expect(server.db.get('u1')!.rev).toBe(row.rev)
    // So is the production app's v2 copy — its parseMeta and parseHistory drop the thinking games.
    const v2 = (doc: object) => ({ ...clone(doc), v: 2 })
    const older = await server.connect({ uid: 'u1' }).cloud.push({ userId: 'u1', baseRev: row.rev, progress: v2(row.progress as object), history: v2(row.history as object), meta: v2(row.meta as object) })
    expect(older).toMatchObject({ ok: true, status: 'client_outdated' })
    expect(server.db.get('u1')!.rev).toBe(row.rev)
  })

  it('not deployed yet, or nobody signed in: quiet, device-only, the game plays on', async () => {
    const server = fakeServer()
    server.state.missing = true
    const A = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    await idle()
    expect(A.store.getState().cloudStatus).toBe('unavailable')
    expect(A.store.getState().cloudReady).toBe(true)
    A.round('math', 3, 2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(gameProgress(A.store.getState().progress, 'math').rounds).toBe(3)
    expect(server.state.pushes).toBe(0) // backed off, not hammering
    expect(server.state.fetches).toBe(1)

    const S = await device(fakeServer(), null)
    S.store.getState().hydrate(S.storageFor('u9'))
    await idle()
    expect(S.store.getState().cloudReady).toBe(true)
    expect(S.store.getState().cloudStatus).toBe('off')
  })

  it('meta is kept on the device, synced, and merged with the cloud’s', async () => {
    const server = fakeServer()
    const A = await device(server)
    A.store.getState().hydrate(A.storageFor('u1'))
    await idle()
    A.store.getState().updateMeta((m) => ({ ...m, tier: { ...m.tier, schulte: 2 }, seen: '3' }))
    expect(A.disk.get('m.u1')).toContain('"schulte":2')
    await A.flush()
    expect((server.db.get('u1')!.meta as BrainMeta).tier.schulte).toBe(2)

    const B = await device(server)
    B.disk.set('m.u1', JSON.stringify({ ...emptyMeta(), tier: { stroop: 1 }, seen: '4' }))
    B.store.getState().hydrate(B.storageFor('u1'))
    await idle()
    expect(B.store.getState().meta.tier).toEqual({ stroop: 1, schulte: 2 })
    expect(B.store.getState().meta.seen).toBe('7')
    expect((server.db.get('u1')!.meta as BrainMeta).seen).toBe('7')
  })
})
