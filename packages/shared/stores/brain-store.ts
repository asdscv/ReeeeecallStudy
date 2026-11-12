import { create } from 'zustand'
import {
  type BrainGameId,
  type BrainProgress,
  emptyProgress,
  localDayKey,
  parseProgress,
  recordRound,
  serializeProgress,
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
}

interface BrainStore {
  progress: BrainProgress
  storageKey: string | null
  hydrate(storage: BrainStorage): void
  record(id: BrainGameId, round: { level: number; correct: boolean; points: number }): void
}

let storage: BrainStorage | null = null

export const useBrainStore = create<BrainStore>((set, get) => ({
  progress: emptyProgress(),
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
    set({ progress: parseProgress(raw), storageKey: next.key })
  },
  record(id, round) {
    const progress = recordRound(get().progress, id, round, localDayKey())
    set({ progress })
    try {
      storage?.save(serializeProgress(progress))
    } catch {
      // A failed write loses this round's progress on the next launch, never the session.
    }
  },
}))
