import { create } from 'zustand'
import {
  type BrainGameId,
  type BrainHistory,
  type BrainMeta,
  type BrainProgress,
  type BrainSaveDocs,
  type BrainSettings,
  type RemoteBrainSave,
  QUICK_EYE_MAX_VARIANT,
  emptyHistory,
  emptyMeta,
  emptyProgress,
  fitsCloud,
  isNewerFormat,
  localDayKey,
  markPracticed,
  openBooster,
  parseHistory,
  parseMeta,
  parseProgress,
  pinGame,
  reconcile,
  recordHistory,
  recordRound,
  recordRun,
  recordSession,
  sameDoc,
  serializeHistory,
  serializeMeta,
  serializeProgress,
  setStartLevel,
  updateSettings,
} from '../lib/brain-games'
import { supabaseBrainCloud, type BrainCloud, type CloudFailure } from './brain-cloud'

/**
 * Where brain-game progress is kept on this device. Web hands in localStorage, mobile SecureStore
 * (via local-prefs) — both synchronous, both keyed per user so two accounts on one device do not
 * share levels.
 *
 * The device copy is written first, always; the account's cloud copy (migration 288) is brought
 * level with it whenever the network allows — so a new phone, a reinstall or the web↔app switch
 * opens at the levels the player reached, not at level 1.
 */
export interface BrainStorage {
  key: string
  /** The account this storage belongs to. The cloud save is fetched and pushed for it only. */
  userId?: string
  load(): string | null
  save(raw: string): void
  /** Recent rounds per game (history.ts), kept in a value of its own. */
  loadHistory?(): string | null
  saveHistory?(raw: string): void
  /** Skill estimates, tiers, seen rules, achievements (meta.ts), kept in a value of its own. */
  loadMeta?(): string | null
  saveMeta?(raw: string): void
}

/** What a records screen may show as a quiet note. Never a blocking dialog, never an error screen. */
export type BrainCloudStatus = 'off' | 'loading' | 'synced' | 'pending' | 'offline' | 'unavailable' | 'outdated'

interface BrainStore {
  progress: BrainProgress
  history: BrainHistory
  meta: BrainMeta
  storageKey: string | null
  /**
   * The cloud's first answer for this account is in and merged (whatever it was — a copy, no copy,
   * offline, not deployed), or there is no cloud. A new phone shows level 1 until then, so a screen
   * that starts a round may wait for this — briefly (about 2s), then play on the device copy.
   */
  cloudReady: boolean
  cloudStatus: BrainCloudStatus
  hydrate(storage: BrainStorage): void
  /**
   * A round of this game is open (from its first screen, practice and placement included): a cloud
   * copy arriving now never moves this game until the round ends — the round reads its level back
   * from the store, and a round that opened on an older record must not overwrite the account's.
   */
  beginRound(id: BrainGameId): void
  /** One judged trial; `level` is the level after it. */
  record(id: BrainGameId, round: { level: number; correct: boolean; points: number; shownMs?: number }): void
  /** A round of play ended: keep its score if best, and set where the next round starts. */
  finishRun(
    mode: BrainGameId | 'mix',
    points: number,
    nextStartLevel?: { id: BrainGameId; level: number },
    round?: { level: number; accuracy: number },
  ): { isNewBest: boolean; best: number }
  practiced(id: BrainGameId): void
  /**
   * Quick Eye's placement sent a slow first start to variant 1 (the centre alone): set the variant
   * and empty its trial window. Never a promotion — those come from the window (recordRound).
   */
  setQuickEyeVariant(variant: number): void
  setSettings(patch: Partial<BrainSettings>): void
  /** A completed Today's Training session, with the games it used (for the rotation). */
  completeSession(minutes: number, games?: BrainGameId[]): void
  /** Change the game meta (skill estimates, tiers, seen rules …): kept on the device and synced. */
  updateMeta(fn: (m: BrainMeta) => BrainMeta): void
  /** Pull the cloud copy, merge, save both sides. Safe to call often. */
  syncNow(): Promise<void>
  /** Signed out: drop the in-memory record and everything in flight. The device copy stays. */
  resetForSignOut(): void
}

/** A write is sent this long after the last one (a round writes after every trial). */
const PUSH_DEBOUNCE_MS = 5_000
/** A screen opening, or the tab coming back, re-reads the cloud at most this often. */
const REFRESH_THROTTLE_MS = 30_000
/** A round with no judged trial for this long is treated as over (closed without finishing). */
const RUN_IDLE_MS = 3 * 60_000
const RETRY_MS = [5_000, 15_000, 60_000, 300_000] as const
/** Not deployed yet / payload refused: stay device-only this long before asking again. */
const UNAVAILABLE_BACKOFF_MS = 30 * 60_000
const MAX_CONFLICT_RETRIES = 3
/**
 * A trial whose level is this far below a level just taken from the cloud came from a round that
 * opened before the cloud copy arrived (on this device's older, lower record). No step of any game
 * moves this far in one trial.
 */
const ADOPTED_LEVEL_GAP = 4

// ── module state (one store per app) ────────────────────────────────────────

let storage: BrainStorage | null = null
/** The account the in-memory record belongs to (storage.userId, or the session's at the first sync). */
let owner: string | null = null
let cloud: BrainCloud | null = null
let cloudConfigured = false
let authUnsub: (() => void) | null = null
let visibilityHooked = false
/** Bumped on every account change and sign-out; async work started under an older value is dropped. */
let gen = 0
/** The cloud copy this device last merged with or wrote, and its rev. null = not read yet for this account. */
let base: { rev: number; save: Pick<RemoteBrainSave, 'progress' | 'history' | 'meta'> | null } | null = null
/** Local writes, and how many of them the cloud already has. */
let seq = 0
let pushedSeq = 0
/** The cloud copy is a newer format (or the server said so): read-only until the next launch. */
let stopped = false
let disabledUntil = 0
let lastFetchAt = 0
/** The game whose round is being played: a cloud copy never moves it mid-round. */
let activeGame: BrainGameId | null = null
let lastRecordAt = 0
/** Levels taken from the cloud for games not yet played since (see record). */
let adopted: Partial<Record<BrainGameId, number>> = {}
let running = false
let queued: { fetch: boolean; promise: Promise<void>; resolve: () => void } | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryStep = 0
let flushImpl: () => Promise<void> = () => Promise.resolve()

/** Test seam / kill switch: hand in a fake server, or null to keep progress device-only. */
export function configureBrainCloud(next: BrainCloud | null): void {
  authUnsub?.()
  authUnsub = null
  cloud = next
  cloudConfigured = true
}

/**
 * Send any unsent change now — the tab is being hidden, the app is going to the background, a brain
 * screen is closing. The web wires its own visibilitychange inside the store; mobile calls this from
 * its AppState flush.
 */
export function flushBrainCloud(): Promise<void> {
  return flushImpl()
}

type DomLike = { visibilityState?: string; addEventListener?: (type: string, cb: () => void) => void }

export const useBrainStore = create<BrainStore>((set, get) => {
  const docs = (): BrainSaveDocs => {
    const s = get()
    return { progress: s.progress, history: s.history, meta: s.meta }
  }
  const setStatus = (cloudStatus: BrainCloudStatus) => {
    if (get().cloudStatus !== cloudStatus) set({ cloudStatus })
  }
  const markReady = () => {
    if (!get().cloudReady) set({ cloudReady: true })
  }
  const clearTimers = () => {
    if (pushTimer) clearTimeout(pushTimer)
    if (retryTimer) clearTimeout(retryTimer)
    pushTimer = retryTimer = null
  }
  const resetSync = () => {
    gen++
    clearTimers()
    base = null
    seq = pushedSeq = 0
    stopped = false
    disabledUntil = 0
    lastFetchAt = 0
    activeGame = null
    lastRecordAt = 0
    adopted = {}
    retryStep = 0
  }

  /** To the device. A failed save loses this change on the next launch, never the session. */
  const persist = (d: Partial<BrainSaveDocs>) => {
    try {
      if (d.progress) storage?.save(serializeProgress(d.progress))
    } catch {
      // Private mode, full storage, a locked keychain: the session still plays.
    }
    try {
      if (d.history) storage?.saveHistory?.(serializeHistory(d.history))
    } catch {
      // As with progress: the trend just misses this round.
    }
    try {
      if (d.meta) storage?.saveMeta?.(serializeMeta(d.meta))
    } catch {
      // As with progress.
    }
  }

  const schedulePush = (ms: number) => {
    if (!cloud || !storage || stopped) return
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      pushTimer = null
      void runSync(false)
    }, ms)
  }

  /** A local write happened: the cloud lacks it until the next push. */
  const changed = (pushInMs = PUSH_DEBOUNCE_MS) => {
    seq++
    if (!cloud || !storage || stopped) return
    if (get().cloudStatus === 'synced') setStatus('pending')
    schedulePush(pushInMs)
  }

  const commitProgress = (progress: BrainProgress, pushInMs?: number) => {
    set({ progress })
    persist({ progress })
    changed(pushInMs)
  }

  const scheduleRetry = () => {
    if (retryTimer || !cloud || !storage) return
    const ms = RETRY_MS[Math.min(retryStep, RETRY_MS.length - 1)]
    retryStep++
    retryTimer = setTimeout(() => {
      retryTimer = null
      void runSync(base === null)
    }, ms)
  }

  const fail = (reason: CloudFailure) => {
    switch (reason) {
      case 'missing': // not deployed yet: device-only, ask again much later — never an error screen
      case 'invalid': // the server refused the payload: a bug, do not hammer
        disabledUntil = Date.now() + UNAVAILABLE_BACKOFF_MS
        setStatus('unavailable')
        return
      case 'account': // ran as another account / account deleted: the auth listener resets us
        return
      default: // offline | auth | error — the device copy has it; try again later
        setStatus('offline')
        scheduleRetry()
    }
  }

  const synced = () => {
    retryStep = 0
    setStatus('synced')
  }

  const runLive = () => activeGame !== null && Date.now() - lastRecordAt < RUN_IDLE_MS

  /**
   * Put a merge result in memory and on the device. Called synchronously right after the merge was
   * computed from the in-memory record, so nothing a round wrote in between can be lost — the store
   * merges, it never replaces. The game being played keeps this device's record until its round ends.
   */
  const applyMerged = (merged: BrainSaveDocs, local: BrainSaveDocs) => {
    const next = activeGame && runLive() ? pinGame(merged, local, activeGame) : merged
    for (const [id, g] of Object.entries(next.progress.games) as [BrainGameId, BrainProgress['games'][BrainGameId]][]) {
      const before = local.progress.games[id]
      if (g && (!before || before.rounds !== g.rounds || before.level !== g.level)) adopted[id] = g.level
    }
    const patch: Partial<BrainSaveDocs> = {}
    if (!sameDoc(next.progress, local.progress)) patch.progress = next.progress
    if (!sameDoc(next.history, local.history)) patch.history = next.history
    if (!sameDoc(next.meta, local.meta)) patch.meta = next.meta
    if (patch.progress || patch.history || patch.meta) {
      set(patch)
      persist(patch)
    }
  }

  /** Read (when asked or never read), merge, write the merge back if the cloud lacks any of it. */
  async function syncOnce(wantFetch: boolean): Promise<void> {
    const g = gen
    const c = cloud
    if (!storage || !c) return
    if (stopped || Date.now() < disabledUntil) return markReady()

    const uid = await c.currentUserId()
    if (g !== gen) return
    if (!uid) {
      // Not signed in to the server (or the session is gone): device-only, quietly.
      setStatus('off')
      return markReady()
    }
    if (owner === null) owner = uid
    // The session belongs to another account now; the auth listener resets this store.
    if (uid !== owner) return markReady()
    const who = owner

    let remote: RemoteBrainSave | null | undefined
    if (wantFetch || base === null) {
      const res = await c.fetch()
      if (g !== gen) return
      lastFetchAt = Date.now()
      if (!res.ok) {
        markReady()
        return fail(res.reason)
      }
      // A response that crossed an account switch: never merge someone else's record.
      if (res.save && res.save.userId !== who) return markReady()
      remote = res.save
    }

    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      if (remote !== undefined) {
        if (remote && isNewerFormat(remote)) {
          // Written by a newer app: never merge into it, never push over it. Update the app to sync.
          stopped = true
          setStatus('outdated')
          return markReady()
        }
        base = { rev: remote?.rev ?? 0, save: remote }
        remote = undefined
      }
      if (!base) return
      const local = docs()
      const r = reconcile(local, base.save)
      applyMerged(r.merged, local)
      markReady()
      if (!r.push) {
        pushedSeq = seq
        return synced()
      }
      if (!fitsCloud(r.encoded)) return fail('invalid')

      const snapshot = seq
      setStatus('pending')
      const res = await c.push({ userId: who, baseRev: base.rev, ...r.encoded })
      if (g !== gen) return
      if (!res.ok) return fail(res.reason)
      if (res.status === 'client_outdated') {
        stopped = true
        return setStatus('outdated')
      }
      if (res.status === 'saved') {
        base = { rev: res.rev, save: r.encoded }
        pushedSeq = snapshot
        if (seq !== snapshot) schedulePush(PUSH_DEBOUNCE_MS) // written to while the save was in flight
        return synced()
      }
      // Another device saved first: merge with its copy and try again.
      if (res.save.userId !== who) return
      remote = res.save
    }
    scheduleRetry() // still conflicting: back off
  }

  /** One sync at a time; requests made meanwhile collapse into one more run after it. */
  function runSync(wantFetch: boolean): Promise<void> {
    if (running) {
      if (queued) {
        queued.fetch = queued.fetch || wantFetch
        return queued.promise
      }
      let resolve: () => void = () => {}
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      queued = { fetch: wantFetch, promise, resolve }
      return promise
    }
    running = true
    return syncOnce(wantFetch)
      .catch(() => {
        // A bug in the sync must never stop play: the device copy has everything.
        setStatus('offline')
      })
      .finally(() => {
        running = false
        const next = queued
        queued = null
        if (next) void runSync(next.fetch).then(next.resolve)
      })
  }

  const refresh = () => {
    if (!cloud || !storage || Date.now() - lastFetchAt < REFRESH_THROTTLE_MS) return Promise.resolve()
    return runSync(true)
  }

  flushImpl = () => {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = null
    if (!cloud || !storage || stopped) return Promise.resolve()
    if (base !== null && seq === pushedSeq) return Promise.resolve()
    return runSync(false)
  }

  const onAuth = (event: string, userId: string | null) => {
    if (!storage) return
    if (event === 'SIGNED_OUT') return get().resetForSignOut()
    if (userId !== null && owner !== null && userId !== owner) return get().resetForSignOut()
    // Back online with a fresh session. Deferred: supabase-js holds its auth lock while it runs this
    // callback, and the sync's first step (getSession) would wait on that same lock.
    if (userId !== null && userId === owner && get().cloudStatus === 'offline') setTimeout(() => void runSync(base === null), 0)
  }

  /** The Supabase adapter (unless a test configured one), the auth listener and the tab listener — once. */
  const ensureCloud = () => {
    if (!cloudConfigured && !cloud) cloud = supabaseBrainCloud()
    if (cloud && !authUnsub) {
      try {
        authUnsub = cloud.onAuthChange(onAuth)
      } catch {
        // Supabase not initialised (unit tests, storybook): device-only.
        if (!cloudConfigured) cloud = null
      }
    }
    const doc = (globalThis as { document?: DomLike }).document
    if (cloud && !visibilityHooked && typeof doc?.addEventListener === 'function') {
      visibilityHooked = true
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') void flushImpl()
        else void refresh()
      })
    }
  }

  return {
    progress: emptyProgress(),
    history: emptyHistory(),
    meta: emptyMeta(),
    storageKey: null,
    cloudReady: false,
    cloudStatus: 'off',
    hydrate(next) {
      if (get().storageKey === next.key) {
        void refresh()
        return
      }
      resetSync() // a different account (or the first one): nothing in flight survives
      storage = next
      owner = next.userId ?? null
      const read = (load: () => string | null | undefined): string | null => {
        try {
          return load() ?? null
        } catch {
          return null
        }
      }
      const raw = read(() => next.load())
      const rawHistory = read(() => next.loadHistory?.())
      const rawMeta = read(() => next.loadMeta?.())
      ensureCloud()
      set({
        progress: parseProgress(raw),
        history: parseHistory(rawHistory),
        meta: parseMeta(rawMeta),
        storageKey: next.key,
        cloudReady: !cloud,
        cloudStatus: cloud ? 'loading' : 'off',
      })
      if (cloud) void runSync(true)
    },
    beginRound(id) {
      activeGame = id
      lastRecordAt = Date.now()
    },
    record(id, round) {
      activeGame = id
      lastRecordAt = Date.now()
      const before = get().progress
      let progress = recordRound(before, id, round, localDayKey())
      const taken = adopted[id]
      if (taken !== undefined) {
        delete adopted[id]
        if (round.level < taken - ADOPTED_LEVEL_GAP) {
          // This round opened before the cloud copy arrived, on this device's older, lower record.
          // Count the trial, but keep the level the account had reached — or the next save would
          // put the account back near level 1, the very thing the cloud copy is for.
          const g = progress.games[id]
          if (g) progress = { ...progress, games: { ...progress.games, [id]: { ...g, level: taken, bestLevel: Math.max(g.bestLevel, taken) } } }
          if (id === 'quickEye') progress = { ...progress, quickEye: before.quickEye }
        }
      }
      commitProgress(progress)
    },
    finishRun(mode, points, nextStartLevel, round) {
      let { progress, isNewBest, best } = recordRun(get().progress, mode, points)
      if (nextStartLevel) progress = setStartLevel(progress, nextStartLevel.id, nextStartLevel.level)
      set({ progress })
      persist({ progress })
      if (round && mode !== 'mix') {
        const history = recordHistory(get().history, mode, { day: localDayKey(), ...round })
        set({ history })
        persist({ history })
      }
      // The round is over: its game merges freely again, and the round goes to the cloud now.
      activeGame = null
      changed(0)
      return { isNewBest, best }
    },
    practiced(id) {
      const progress = markPracticed(get().progress, id)
      if (progress !== get().progress) commitProgress(progress)
    },
    setQuickEyeVariant(variant) {
      const p = get().progress
      const v = Math.max(1, Math.min(QUICK_EYE_MAX_VARIANT, Math.round(variant)))
      commitProgress({ ...p, quickEye: { ...p.quickEye, variant: v, recentMs: [], recentOk: '', thresholdMs: null } })
    },
    setSettings(patch) {
      commitProgress(updateSettings(get().progress, patch))
    },
    completeSession(minutes, games = []) {
      const today = localDayKey()
      const p = get().progress
      // A finished session is the unit the evidence counts — send it at once.
      commitProgress(recordSession(p, minutes, today, openBooster(p, today), games), 0)
    },
    updateMeta(fn) {
      const current = get().meta
      const meta = fn(current)
      if (meta === current) return
      set({ meta })
      persist({ meta })
      changed()
    },
    syncNow() {
      return runSync(true)
    },
    resetForSignOut() {
      resetSync()
      storage = null
      owner = null
      set({
        progress: emptyProgress(),
        history: emptyHistory(),
        meta: emptyMeta(),
        storageKey: null,
        cloudReady: false,
        cloudStatus: 'off',
      })
    },
  }
})
