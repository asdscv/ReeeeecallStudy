import { create } from 'zustand'
import {
  type BrainGameId,
  type BrainHistory,
  type BrainProgress,
  type BrainSettings,
  emptyHistory,
  emptyProgress,
  localDayKey,
  markPracticed,
  openBooster,
  parseHistory,
  parseProgress,
  recordHistory,
  recordRound,
  recordRun,
  recordSession,
  serializeHistory,
  serializeProgress,
  setStartLevel,
  updateSettings,
} from '../lib/brain-games'

/**
 * Where brain-game progress is kept. Web hands in localStorage, mobile SecureStore (via
 * local-prefs) — both synchronous, both keyed per user so two accounts on one device do not
 * share levels. Progress is local for now; nothing here talks to the server.
 */
export interface BrainStorage {
  key: string
  load(): string | null
  save(raw: string): void
  /** Recent rounds per game (history.ts), kept in a value of its own. */
  loadHistory?(): string | null
  saveHistory?(raw: string): void
}

interface BrainStore {
  progress: BrainProgress
  history: BrainHistory
  storageKey: string | null
  hydrate(storage: BrainStorage): void
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
  setSettings(patch: Partial<BrainSettings>): void
  /** A completed Today's Training session, with the games it used (for the rotation). */
  completeSession(minutes: number, games?: BrainGameId[]): void
}

let storage: BrainStorage | null = null

export const useBrainStore = create<BrainStore>((set, get) => {
  /** Every write goes through here. A failed save loses this change on the next launch, never the session. */
  const commit = (progress: BrainProgress) => {
    set({ progress })
    try {
      storage?.save(serializeProgress(progress))
    } catch {
      // Private mode, full storage, a locked keychain: the session still plays.
    }
  }
  return {
    progress: emptyProgress(),
    history: emptyHistory(),
    storageKey: null,
    hydrate(next) {
      if (get().storageKey === next.key) return
      storage = next
      let raw: string | null = null
      try {
        raw = next.load()
      } catch {
        raw = null
      }
      let rawHistory: string | null = null
      try {
        rawHistory = next.loadHistory?.() ?? null
      } catch {
        rawHistory = null
      }
      set({ progress: parseProgress(raw), history: parseHistory(rawHistory), storageKey: next.key })
    },
    record(id, round) {
      commit(recordRound(get().progress, id, round, localDayKey()))
    },
    finishRun(mode, points, nextStartLevel, round) {
      let { progress, isNewBest, best } = recordRun(get().progress, mode, points)
      if (nextStartLevel) progress = setStartLevel(progress, nextStartLevel.id, nextStartLevel.level)
      commit(progress)
      if (round && mode !== 'mix') {
        const history = recordHistory(get().history, mode, { day: localDayKey(), ...round })
        set({ history })
        try {
          storage?.saveHistory?.(serializeHistory(history))
        } catch {
          // As with progress: the session plays on, the trend just misses this round.
        }
      }
      return { isNewBest, best }
    },
    practiced(id) {
      commit(markPracticed(get().progress, id))
    },
    setSettings(patch) {
      commit(updateSettings(get().progress, patch))
    },
    completeSession(minutes, games = []) {
      const today = localDayKey()
      const p = get().progress
      commit(recordSession(p, minutes, today, openBooster(p, today), games))
    },
  }
})
