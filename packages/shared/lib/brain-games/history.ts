import type { BrainGameId } from './types'
import { isBrainGameId } from './catalog'
import { migrateLevelV1 } from './scale'

/**
 * Recent rounds per game, for the trend lines on the results and records screens.
 *
 * Kept apart from progress because mobile stores each in one SecureStore value (~2KB): an entry is
 * three small integers, eight per game, so nine games stay near 1.2KB.
 */
export type HistoryEntry = [day: number, level10: number, accuracy: number]

export interface BrainHistory {
  /** 2 since the hard-content change (levels on the v2 scale); older entries are converted once on reading. */
  v: 2
  rounds: Partial<Record<BrainGameId, HistoryEntry[]>>
}

export const HISTORY_PER_GAME = 8
const EPOCH = Date.UTC(2024, 0, 1)

export function emptyHistory(): BrainHistory {
  return { v: 2, rounds: {} }
}

export function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86_400_000)
}

export function dayFromNumber(n: number): string {
  return new Date(EPOCH + n * 86_400_000).toISOString().slice(0, 10)
}

export function recordHistory(h: BrainHistory, id: BrainGameId, round: { day: string; level: number; accuracy: number }): BrainHistory {
  const entry: HistoryEntry = [dayNumber(round.day), Math.round(round.level * 10), Math.round(Math.max(0, Math.min(1, round.accuracy)) * 100)]
  const list = [...(h.rounds[id] ?? []), entry].slice(-HISTORY_PER_GAME)
  return { ...h, rounds: { ...h.rounds, [id]: list } }
}

export function gameHistory(h: BrainHistory, id: BrainGameId): { day: string; level: number; accuracy: number }[] {
  return (h.rounds[id] ?? []).map(([day, level10, accuracy]) => ({ day: dayFromNumber(day), level: level10 / 10, accuracy: accuracy / 100 }))
}

export function serializeHistory(h: BrainHistory): string {
  return JSON.stringify(h)
}

// Days from 2024 to about 2133, levels to 500, accuracy 0-100: anything else is corrupt (and a
// day far out of range would make the date conversion throw on every screen that draws a trend).
const isEntry = (e: unknown): e is HistoryEntry =>
  Array.isArray(e) &&
  e.length === 3 &&
  e.every((x) => typeof x === 'number' && Number.isInteger(x)) &&
  e[0] >= 0 && e[0] <= 40_000 &&
  e[1] >= 0 && e[1] <= 5_000 &&
  e[2] >= 0 && e[2] <= 100

/** A level ×10 from a v1 history on the v2 scale (scale.ts), kept inside the entry's range. */
function rescaleEntry(id: BrainGameId, [day, level10, accuracy]: HistoryEntry): HistoryEntry {
  return [day, Math.max(0, Math.min(5_000, Math.round(migrateLevelV1(id, level10 / 10) * 10))), accuracy]
}

/** Reads any version and returns v2: entries of a history older than v2 move to the v2 level scale, once. */
export function parseHistory(raw: string | null | undefined): BrainHistory {
  if (!raw) return emptyHistory()
  try {
    const data = JSON.parse(raw) as Partial<Omit<BrainHistory, 'v'>> & { v?: unknown }
    const oldScale = !(typeof data.v === 'number' && data.v >= 2)
    const rounds: BrainHistory['rounds'] = {}
    for (const [id, list] of Object.entries(data.rounds ?? {})) {
      if (!isBrainGameId(id) || !Array.isArray(list)) continue
      const entries = list.filter(isEntry).slice(-HISTORY_PER_GAME)
      rounds[id] = oldScale ? entries.map((e) => rescaleEntry(id, e)) : entries
    }
    return { v: 2, rounds }
  } catch {
    return emptyHistory()
  }
}
