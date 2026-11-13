import type { BrainGameId } from './types'
import { type BrainProgress, type GameProgress, type SessionLog, emptyProgress, parseProgress } from './progress'
import { type BrainHistory, type HistoryEntry, HISTORY_PER_GAME, parseHistory } from './history'
import { type BrainMeta, type SkillEstimate, emptyMeta, orMask, parseMeta } from './meta'
import { BRAIN_GAMES } from './catalog'

/**
 * Merging two copies of the brain record — this device's and the account's cloud copy (migration
 * 288). Pure: no network here (the Supabase adapter is stores/brain-cloud.ts).
 *
 * Every count takes the larger side, never the sum, so a sync can never invent a round, a session
 * or a weekly tick: the 3-a-week goal and the 10-session core course stay honest. Merging a record
 * with itself returns it unchanged, and merging with an empty record returns the other side — a
 * new phone simply takes the cloud copy.
 *
 * Accepted loss: if two devices play OFFLINE at the same time, counters keep the larger side and
 * each game keeps the side with more trials. Never a reset to level 1.
 */

/** The `v` this client writes and fully understands. A cloud copy with a higher `v` is read-only here. */
export const BRAIN_PROGRESS_FORMAT = 1
export const BRAIN_HISTORY_FORMAT = 1
export const BRAIN_META_FORMAT = 1
/** Mirrors the CHECKs in migration 288 (octet_length of the jsonb text). */
export const BRAIN_SAVE_MAX_BYTES = 16_384

/** The three values kept per account. */
export interface BrainSaveDocs {
  progress: BrainProgress
  history: BrainHistory
  meta: BrainMeta
}

/** What get_my_brain_save (or a save conflict) returns, before parsing. */
export interface RemoteBrainSave {
  userId: string
  progress: unknown
  history: unknown
  meta: unknown
  rev: number
  updatedAt: string
}

/** Top-level fields a newer client wrote that this one does not know — kept and written back. */
export interface SaveExtras {
  progress: Record<string, unknown>
  meta: Record<string, unknown>
}

/** The JSON objects sent to save_brain_progress. */
export interface EncodedSave {
  progress: Record<string, unknown>
  history: Record<string, unknown>
  meta: Record<string, unknown>
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The format a raw value declares; 0 when absent or garbled. */
export function docVersion(raw: unknown): number {
  return isObj(raw) && typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v > 0 ? raw.v : 0
}

/** Written by a newer client: never merge into it, never push over it (the server refuses too). */
export function isNewerFormat(save: Pick<RemoteBrainSave, 'progress' | 'history' | 'meta'>): boolean {
  return (
    docVersion(save.progress) > BRAIN_PROGRESS_FORMAT ||
    docVersion(save.history) > BRAIN_HISTORY_FORMAT ||
    docVersion(save.meta) > BRAIN_META_FORMAT
  )
}

/**
 * Additive top-level fields this client does not know (a newer client wrote them — mobile OTA
 * trails the web deploy). The known set is read from the empty record, so a field added to
 * BrainProgress / BrainMeta is known the moment it exists. Rule for future fields: additive => top
 * level (nested fields inside games[id] would be stripped by parseProgress); anything that changes
 * the meaning of an existing field => bump `v`.
 */
function unknownKeys(raw: unknown, known: readonly string[]): Record<string, unknown> {
  if (!isObj(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) if (!known.includes(k)) out[k] = v
  return out
}

export function decodeRemote(save: Pick<RemoteBrainSave, 'progress' | 'history' | 'meta'>): { docs: BrainSaveDocs; extras: SaveExtras } {
  return {
    docs: {
      progress: parseProgress(JSON.stringify(save.progress ?? null)),
      history: parseHistory(JSON.stringify(save.history ?? null)),
      meta: parseMeta(JSON.stringify(save.meta ?? null)),
    },
    extras: {
      progress: unknownKeys(save.progress, Object.keys(emptyProgress())),
      meta: unknownKeys(save.meta, Object.keys(emptyMeta())),
    },
  }
}

/** What is pushed: the merged record plus whatever newer fields the cloud copy carried. */
export function encodeSave(docs: BrainSaveDocs, extras: SaveExtras): EncodedSave {
  return {
    progress: { ...extras.progress, ...(docs.progress as unknown as Record<string, unknown>) },
    history: { ...(docs.history as unknown as Record<string, unknown>) },
    meta: { ...extras.meta, ...(docs.meta as unknown as Record<string, unknown>) },
  }
}

/** Key-order-insensitive JSON, so "did the merge change anything" is not fooled by key order. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (isObj(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export const sameDoc = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b)

function utf8Bytes(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/**
 * Bytes of the value as Postgres prints jsonb (`{"a": 1, "b": [1, 2]}` — a space after every colon
 * and comma), which is what migration 288's octet_length(...::text) limit measures. Compact JSON
 * is shorter, so checking JSON.stringify would let a value through that the server then refuses.
 */
export function jsonbTextBytes(v: unknown): number {
  if (v === null || v === undefined) return 4
  if (typeof v === 'string') return utf8Bytes(JSON.stringify(v))
  if (typeof v === 'number' || typeof v === 'boolean') return String(JSON.stringify(v)).length
  if (Array.isArray(v)) return 2 + v.reduce<number>((n, x) => n + jsonbTextBytes(x), 0) + Math.max(0, v.length - 1) * 2
  if (isObj(v)) {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined)
    return 2 + entries.reduce((n, [k, x]) => n + utf8Bytes(JSON.stringify(k)) + 2 + jsonbTextBytes(x), 0) + Math.max(0, entries.length - 1) * 2
  }
  return 4
}

/** True when every value fits migration 288's limit. */
export function fitsCloud(save: EncodedSave): boolean {
  return (
    jsonbTextBytes(save.progress) <= BRAIN_SAVE_MAX_BYTES &&
    jsonbTextBytes(save.history) <= BRAIN_SAVE_MAX_BYTES &&
    jsonbTextBytes(save.meta) <= BRAIN_SAVE_MAX_BYTES
  )
}

// ── progress ────────────────────────────────────────────────────────────────

type Side = 'local' | 'remote'
export type GameSides = Partial<Record<BrainGameId, Side>>

/**
 * A true tie, broken the same way on both devices (the side whose value prints smaller), so two
 * devices merging the same pair reach the same document — never "keep mine" on each, which would
 * have them rewrite the cloud row back and forth forever.
 */
function tieSide(a: unknown, b: unknown): Side {
  return stableJson(a) <= stableJson(b) ? 'local' : 'remote'
}

/** Which side's game record survives: more rounds (rounds counts judged trials), then higher level, then a stable tie-break. */
function gameWinner(a: GameProgress | undefined, b: GameProgress | undefined): Side {
  if (!b) return 'local'
  if (!a) return 'remote'
  if (a.rounds !== b.rounds) return a.rounds > b.rounds ? 'local' : 'remote'
  if (a.level !== b.level) return a.level > b.level ? 'local' : 'remote'
  return tieSide(a, b)
}

/**
 * Quick Eye's variant ladder and its game record travel together (opening a variant eases the level
 * back, so the pair must not be split). Higher variant first — picking by trials alone could drop a
 * player from variant 6 back to 5 — then more trials. Variants 1 and 2 rank together: 2 is where
 * every record starts (an empty one too) and 1 only where a slow first placement sends a player,
 * so a fresh device's untouched variant 2 must not undo that placement — the side that played decides.
 */
function quickEyeSide(local: BrainProgress, remote: BrainProgress): Side {
  const rank = (v: number) => Math.max(2, v)
  const [lv, rv] = [rank(local.quickEye.variant), rank(remote.quickEye.variant)]
  if (lv !== rv) return lv > rv ? 'local' : 'remote'
  const a = local.games.quickEye
  const b = remote.games.quickEye
  // Neither has played: the same answer on both devices, never "keep mine" on each.
  if (!a && !b && local.quickEye.variant !== remote.quickEye.variant) return local.quickEye.variant > remote.quickEye.variant ? 'local' : 'remote'
  if (a && b && a.rounds === b.rounds && a.level === b.level) return tieSide({ a, q: local.quickEye }, { a: b, q: remote.quickEye })
  return gameWinner(a, b)
}

/** Per game, the side whose record survives — its skill estimate and per-game counters go with it. */
export function gameSides(local: BrainProgress, remote: BrainProgress): GameSides {
  const sides: GameSides = {}
  for (const id of new Set([...Object.keys(local.games), ...Object.keys(remote.games)]) as Set<BrainGameId>) {
    sides[id] = id === 'quickEye' ? quickEyeSide(local, remote) : gameWinner(local.games[id], remote.games[id])
  }
  return sides
}

const GAME_ORDER = BRAIN_GAMES.map((g) => g.id as string)

/** Union in catalogue order (the same on every device). */
function unionGames(a: readonly BrainGameId[], b: readonly BrainGameId[]): BrainGameId[] {
  return [...new Set([...a, ...b])].sort((x, y) => GAME_ORDER.indexOf(x) - GAME_ORDER.indexOf(y))
}

/**
 * Union of the session days as a multiset (per day, the larger count): ['d1','d1'] ∪ ['d1','d2'] =
 * ['d1','d1','d2']. Two sessions on one day both count toward the week, so a plain set union would
 * lose one; a sum would invent one. Sorted, so the last 12 are the most recent.
 */
function dayUnion(a: readonly string[], b: readonly string[]): string[] {
  const count = (xs: readonly string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())
  const ca = count(a)
  const cb = count(b)
  const out: string[] = []
  for (const day of new Set([...ca.keys(), ...cb.keys()])) {
    for (let i = 0; i < Math.max(ca.get(day) ?? 0, cb.get(day) ?? 0); i++) out.push(day)
  }
  return out.sort()
}

function mergeSessions(a: SessionLog, b: SessionLog): SessionLog {
  const booster =
    a.booster.index !== b.booster.index
      ? a.booster.index > b.booster.index
        ? a.booster
        : b.booster
      : { index: a.booster.index, sessions: Math.max(a.booster.sessions, b.booster.sessions) }
  return {
    recentDays: dayUnion(a.recentDays, b.recentDays).slice(-12),
    total: Math.max(a.total, b.total),
    course: Math.max(a.course, b.course),
    minutes: Math.max(a.minutes, b.minutes),
    coreDoneOn: [a.coreDoneOn, b.coreDoneOn].filter((d): d is string => d !== null).sort()[0] ?? null,
    booster: { ...booster },
    // The rotation's memory: whichever side has seen more sessions knows the more recent line-ups.
    recentGames: [...(b.total !== a.total ? (b.total > a.total ? b.recentGames : a.recentGames) : tieSide(a.recentGames, b.recentGames) === 'local' ? a.recentGames : b.recentGames)],
  }
}

/**
 * Local vs cloud, field by field:
 * - games: per game the side with more rounds (trials), tie → higher level; bestLevel is the max.
 * - Quick Eye (games.quickEye + quickEye): higher variant first, then more rounds.
 * - totals: max · last day / streak / today: from the later day (same day: max) · bestRuns: max per mode
 * - practiced: union · sessions: see mergeSessions · settings: this device's (they are per device).
 * Fields this client does not merge yet keep the local value.
 */
export function mergeProgress(local: BrainProgress, remote: BrainProgress, sides: GameSides = gameSides(local, remote)): BrainProgress {
  const games: BrainProgress['games'] = {}
  const ids = new Set([...Object.keys(local.games), ...Object.keys(remote.games)]) as Set<BrainGameId>
  const qe = sides.quickEye ?? quickEyeSide(local, remote)
  for (const id of ids) {
    const a = local.games[id]
    const b = remote.games[id]
    const side = sides[id] ?? gameWinner(a, b)
    const win = (side === 'local' ? a : b) ?? a ?? b
    if (!win) continue
    games[id] = { ...win, bestLevel: Math.max(a?.bestLevel ?? win.bestLevel, b?.bestLevel ?? win.bestLevel) }
  }
  const quickEye = qe === 'local' ? local.quickEye : remote.quickEye

  const day = local.lastDay === remote.lastDay ? 'same' : (local.lastDay ?? '') > (remote.lastDay ?? '') ? 'local' : 'remote'
  const daySide = day === 'remote' ? remote : local

  const bestRuns: BrainProgress['bestRuns'] = { ...local.bestRuns }
  for (const [mode, v] of Object.entries(remote.bestRuns) as [BrainGameId | 'mix', number][]) {
    bestRuns[mode] = Math.max(bestRuns[mode] ?? 0, v)
  }

  return {
    ...local,
    v: 1,
    games,
    totalRounds: Math.max(local.totalRounds, remote.totalRounds),
    totalPoints: Math.max(local.totalPoints, remote.totalPoints),
    lastDay: daySide.lastDay,
    dayStreak: day === 'same' ? Math.max(local.dayStreak, remote.dayStreak) : daySide.dayStreak,
    todayRounds: day === 'same' ? Math.max(local.todayRounds, remote.todayRounds) : daySide.todayRounds,
    bestRuns,
    practiced: unionGames(local.practiced, remote.practiced),
    quickEye: { ...quickEye, recentMs: [...quickEye.recentMs] },
    sessions: mergeSessions(local.sessions, remote.sessions),
    settings: { ...local.settings },
  }
}

// ── history ─────────────────────────────────────────────────────────────────

/**
 * Trend lines: per game, the union of both sides' recent entries — an entry present on both sides
 * counts once (as many times as the side that has it more often) — ordered by day, remote first
 * within a day (local is the newer play), keeping the last HISTORY_PER_GAME.
 */
export function mergeHistory(local: BrainHistory, remote: BrainHistory): BrainHistory {
  const rounds: BrainHistory['rounds'] = {}
  const ids = new Set([...Object.keys(local.rounds), ...Object.keys(remote.rounds)]) as Set<BrainGameId>
  const key = (e: HistoryEntry) => e.join(',')
  for (const id of ids) {
    const r = remote.rounds[id] ?? []
    const l = local.rounds[id] ?? []
    const inRemote = new Map<string, number>()
    const merged: HistoryEntry[] = []
    for (const e of r) {
      inRemote.set(key(e), (inRemote.get(key(e)) ?? 0) + 1)
      merged.push([...e] as HistoryEntry)
    }
    const seen = new Map<string, number>()
    for (const e of l) {
      const n = (seen.get(key(e)) ?? 0) + 1
      seen.set(key(e), n)
      if (n > (inRemote.get(key(e)) ?? 0)) merged.push([...e] as HistoryEntry)
    }
    // By day, then by value: the same order on every device, whichever side is "local".
    merged.sort((x, y) => x[0] - y[0] || (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0))
    rounds[id] = merged.slice(-HISTORY_PER_GAME)
  }
  return { v: 1, rounds }
}

// ── meta ────────────────────────────────────────────────────────────────────

function maxPerGame(a: Partial<Record<BrainGameId, number>>, b: Partial<Record<BrainGameId, number>>): Partial<Record<BrainGameId, number>> {
  const out: Partial<Record<BrainGameId, number>> = { ...a }
  for (const [id, v] of Object.entries(b) as [BrainGameId, number][]) out[id] = Math.max(out[id] ?? v, v)
  return out
}

/** For a game neither side has a record of: the estimate backed by more trials, then the higher, then a stable tie-break. */
function skillWinner(a: SkillEstimate | undefined, b: SkillEstimate | undefined): Side {
  if (!b) return 'local'
  if (!a) return 'remote'
  if (a.n !== b.n) return a.n > b.n ? 'local' : 'remote'
  if (a.mu !== b.mu) return b.mu > a.mu ? 'remote' : 'local'
  return tieSide(a, b)
}

/**
 * - sk, rt, wipes, span1: from the side whose GAME RECORD survived (`sides`), so the estimate always
 *   describes the record it sits next to — a 200-round record never carries a 3-trial phone's
 *   estimate, nor an interrupted placement's (which would send that player back to placement). If
 *   the surviving side has no estimate (a record from before estimates), the game gets none.
 *   wipes and span1 are "latest" values, not records, so they are never max-merged either.
 * - tier, practice, span2: max per game (tiers are sticky; never lowered by a sync)
 * - seen, ach: bitwise OR (a rule introduced or an achievement earned on any device stays so)
 */
export function mergeMeta(local: BrainMeta, remote: BrainMeta, sides: GameSides = {}): BrainMeta {
  const sk: BrainMeta['sk'] = {}
  const rt: BrainMeta['rt'] = {}
  const wipes: BrainMeta['wipes'] = {}
  const span1: BrainMeta['span1'] = {}
  const ids = new Set([
    ...Object.keys(local.sk), ...Object.keys(remote.sk), ...Object.keys(local.rt), ...Object.keys(remote.rt),
    ...Object.keys(local.wipes), ...Object.keys(remote.wipes), ...Object.keys(local.span1), ...Object.keys(remote.span1),
    ...Object.keys(sides),
  ]) as Set<BrainGameId>
  for (const id of ids) {
    const side = sides[id] ?? (local.sk[id] || remote.sk[id] ? skillWinner(local.sk[id], remote.sk[id]) : null)
    // No record and no estimate on either side: whichever side has the value, a stable tie-break if both.
    const pick = <T>(a: T | undefined, b: T | undefined): T | undefined =>
      side === 'local' ? a : side === 'remote' ? b : a === undefined ? b : b === undefined ? a : tieSide(a, b) === 'local' ? a : b
    const est = pick(local.sk[id], remote.sk[id])
    if (est) sk[id] = { ...est }
    const r = pick(local.rt[id], remote.rt[id])
    if (r !== undefined) rt[id] = r
    const w = pick(local.wipes[id], remote.wipes[id])
    if (w !== undefined) wipes[id] = w
    const s1 = pick(local.span1[id], remote.span1[id])
    if (s1 !== undefined) span1[id] = s1
  }
  return {
    ...local,
    v: 1,
    sk,
    tier: maxPerGame(local.tier, remote.tier),
    seen: orMask(local.seen, remote.seen),
    ach: orMask(local.ach, remote.ach),
    practice: maxPerGame(local.practice, remote.practice),
    wipes,
    rt,
    span1,
    span2: maxPerGame(local.span2, remote.span2),
  }
}

// ── the whole save ──────────────────────────────────────────────────────────

export function mergeDocs(local: BrainSaveDocs, remote: BrainSaveDocs): BrainSaveDocs {
  // One decision per game, shared by the record and its estimate.
  const sides = gameSides(local.progress, remote.progress)
  return {
    progress: mergeProgress(local.progress, remote.progress, sides),
    history: mergeHistory(local.history, remote.history),
    meta: mergeMeta(local.meta, remote.meta, sides),
  }
}

function setOrDrop<T>(map: Partial<Record<BrainGameId, T>>, id: BrainGameId, value: T | undefined): Partial<Record<BrainGameId, T>> {
  const out = { ...map }
  if (value === undefined) delete out[id]
  else out[id] = value
  return out
}

/**
 * The merge with one game left exactly as this device has it — the game whose round is being played
 * right now. The round reads its level back from the store after every trial, so a cloud copy must
 * not move it mid-round; the cloud gets the full merge, and the game is merged at the round's end.
 */
export function pinGame(merged: BrainSaveDocs, local: BrainSaveDocs, id: BrainGameId): BrainSaveDocs {
  const progress: BrainProgress = { ...merged.progress, games: setOrDrop(merged.progress.games, id, local.progress.games[id]) }
  if (id === 'quickEye') progress.quickEye = local.progress.quickEye
  const meta: BrainMeta = {
    ...merged.meta,
    sk: setOrDrop(merged.meta.sk, id, local.meta.sk[id]),
    rt: setOrDrop(merged.meta.rt, id, local.meta.rt[id]),
    practice: setOrDrop(merged.meta.practice, id, local.meta.practice[id]),
    wipes: setOrDrop(merged.meta.wipes, id, local.meta.wipes[id]),
    span1: setOrDrop(merged.meta.span1, id, local.meta.span1[id]),
    span2: setOrDrop(merged.meta.span2, id, local.meta.span2[id]),
  }
  return { progress, history: merged.history, meta }
}

/** Nothing played or learned yet (settings alone do not count) — not worth creating a cloud row. */
export function isEmptySave(docs: BrainSaveDocs): boolean {
  const blank = emptyProgress()
  return (
    sameDoc({ ...docs.progress, settings: blank.settings }, blank) &&
    Object.values(docs.history.rounds).every((l) => !l || l.length === 0) &&
    sameDoc(docs.meta, emptyMeta())
  )
}

/** Same content as far as the cloud is concerned: settings are per device and never decide a push. */
function sameForCloud(a: EncodedSave, b: Pick<RemoteBrainSave, 'progress' | 'history' | 'meta'>): boolean {
  const bp = isObj(b.progress) ? b.progress : {}
  return (
    sameDoc({ ...a.progress, settings: null }, { ...bp, settings: null }) &&
    sameDoc(a.history, b.history) &&
    sameDoc(a.meta, b.meta)
  )
}

/**
 * One sync step: what the account's record should be, and whether the cloud copy lacks any of it.
 * `remote` null = the account has no cloud row yet.
 */
export function reconcile(
  local: BrainSaveDocs,
  remote: Pick<RemoteBrainSave, 'progress' | 'history' | 'meta'> | null,
): { merged: BrainSaveDocs; extras: SaveExtras; encoded: EncodedSave; push: boolean } {
  if (!remote) {
    const extras: SaveExtras = { progress: {}, meta: {} }
    return { merged: local, extras, encoded: encodeSave(local, extras), push: !isEmptySave(local) }
  }
  const { docs, extras } = decodeRemote(remote)
  const merged = mergeDocs(local, docs)
  const encoded = encodeSave(merged, extras)
  return { merged, extras, encoded, push: !sameForCloud(encoded, remote) }
}
