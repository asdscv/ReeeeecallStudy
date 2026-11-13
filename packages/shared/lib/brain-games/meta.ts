import type { BrainGameId } from './types'
import { isBrainGameId } from './catalog'
import { SPAN_LEVEL_CAP, V2_REPLACED, migrateLevelV1 } from './scale'

/**
 * The game-logic state that sits beside progress: each game's skill estimate with its uncertainty,
 * the tier reached, the rules already introduced, achievements, practice done.
 *
 * Kept in a value of its own — mobile stores each value in SecureStore (~2KB), and progress is
 * already near 1.8KB — so everything here is compact: integers, hex bitmasks, no dates as strings.
 */
export interface SkillEstimate {
  /** The level the player is estimated to hold at the game's target accuracy. */
  mu: number
  /** How unsure that estimate is, in level units. Shrinks with play, grows with days away. */
  sd: number
  /** Counted trials behind the estimate. */
  n: number
  /** Day number (history.dayNumber) of the last counted trial; 0 = never. */
  day: number
}

export interface BrainMeta {
  /** 2 since the hard-content change (estimates on the v2 level scale); v1 is converted once on reading. */
  v: 2
  /** Per game skill estimate. */
  sk: Partial<Record<BrainGameId, SkillEstimate>>
  /** Per game best tier reached, 0 (none) to 6 (master). Sticky: never lowered. */
  tier: Partial<Record<BrainGameId, number>>
  /** Rules already introduced — a hex bitmask over MECHANICS (bit = index). */
  seen: string
  /** Achievements earned — a hex bitmask over ACHIEVEMENTS (bit = index). */
  ach: string
  /** Practice trials done per game, so a practice left half-way resumes rather than restarts. */
  practice: Partial<Record<BrainGameId, number>>
  /** Rounds in a row that ended early on chances, per game (the mercy rule). */
  wipes: Partial<Record<BrainGameId, number>>
  /** The player's own median correct reaction time per game, ms — the speed bonus's yardstick. */
  rt: Partial<Record<BrainGameId, number>>
  /** Span games: lengths passed in two separate rounds, for the tier rule. Per game, best such length. */
  span2: Partial<Record<BrainGameId, number>>
  /** Span games: the best length passed in the latest round (to confirm in a second round). */
  span1: Partial<Record<BrainGameId, number>>
}

export function emptyMeta(): BrainMeta {
  return { v: 2, sk: {}, tier: {}, seen: '', ach: '', practice: {}, wipes: {}, rt: {}, span2: {}, span1: {} }
}

// ── hex bitmasks ────────────────────────────────────────────────────────────

export function hasBit(mask: string, bit: number): boolean {
  const nibble = Math.floor(bit / 4)
  const ch = mask.length - 1 - nibble
  if (ch < 0) return false
  const value = parseInt(mask[ch], 16)
  return Number.isFinite(value) && (value & (1 << (bit % 4))) !== 0
}

export function setBit(mask: string, bit: number): string {
  const nibble = Math.floor(bit / 4)
  const padded = mask.padStart(nibble + 1, '0')
  const ch = padded.length - 1 - nibble
  const value = (parseInt(padded[ch], 16) || 0) | (1 << (bit % 4))
  return (padded.slice(0, ch) + value.toString(16) + padded.slice(ch + 1)).replace(/^0+(?=.)/, '')
}

/** Union of two masks (for merging devices). */
export function orMask(a: string, b: string): string {
  const len = Math.max(a.length, b.length)
  const pa = a.padStart(len, '0')
  const pb = b.padStart(len, '0')
  let out = ''
  for (let i = 0; i < len; i++) out += ((parseInt(pa[i], 16) || 0) | (parseInt(pb[i], 16) || 0)).toString(16)
  return out.replace(/^0+(?=.)/, '') === '0' ? '' : out.replace(/^0+(?=.)/, '')
}

// ── storage ─────────────────────────────────────────────────────────────────

export function serializeMeta(m: BrainMeta): string {
  return JSON.stringify(m)
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isHex = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{0,64}$/.test(x)

function perGame<T>(raw: unknown, read: (v: unknown) => T | undefined): Partial<Record<BrainGameId, T>> {
  const out: Partial<Record<BrainGameId, T>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, v] of Object.entries(raw)) {
    if (!isBrainGameId(id)) continue
    const value = read(v)
    if (value !== undefined) out[id] = value
  }
  return out
}

const intIn = (lo: number, hi: number) => (v: unknown) => (isNum(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined)

/**
 * Anything unreadable becomes an empty record rather than a crash; values are clamped to sane ranges.
 *
 * Reads v1 or v2 and always returns v2. On v1 the board games whose content was rebuilt get their
 * estimate moved to the v2 scale and re-opened (sd 9, n 0 — the next round places or probes once);
 * the span games keep theirs, clamped to the new cap. Tiers are sticky and stay as they are.
 */
export function parseMeta(raw: string | null | undefined): BrainMeta {
  if (!raw) return emptyMeta()
  try {
    const d = JSON.parse(raw) as Partial<Omit<BrainMeta, 'v'>> & { v?: unknown }
    if (!d || (d.v !== 1 && d.v !== 2)) return emptyMeta()
    const oldScale = d.v === 1
    const spanCap = (id: BrainGameId, v: number) => (oldScale && (id === 'memoryGrid' || id === 'sequence') ? Math.min(SPAN_LEVEL_CAP, v) : v)
    const sk = perGame(d.sk, (v) => {
      const s = v as Partial<SkillEstimate>
      if (!s || !isNum(s.mu) || !isNum(s.sd)) return undefined
      return {
        mu: Math.max(0, Math.min(500, s.mu)),
        sd: Math.max(0.1, Math.min(20, s.sd)),
        n: isNum(s.n) ? Math.max(0, Math.round(s.n)) : 0,
        day: isNum(s.day) ? Math.max(0, Math.min(40_000, Math.round(s.day))) : 0,
      }
    })
    const span1 = perGame(d.span1, intIn(0, 99))
    const span2 = perGame(d.span2, intIn(0, 99))
    if (oldScale) {
      for (const [id, est] of Object.entries(sk) as [BrainGameId, SkillEstimate][]) {
        if (V2_REPLACED.includes(id)) sk[id] = { mu: migrateLevelV1(id, est.mu), sd: 9, n: 0, day: est.day }
        else sk[id] = { ...est, mu: spanCap(id, est.mu) }
      }
      for (const map of [span1, span2]) for (const [id, v] of Object.entries(map) as [BrainGameId, number][]) map[id] = spanCap(id, v)
    }
    return {
      v: 2,
      sk,
      tier: perGame(d.tier, intIn(0, 6)),
      seen: isHex(d.seen) ? d.seen : '',
      ach: isHex(d.ach) ? d.ach : '',
      practice: perGame(d.practice, intIn(0, 99)),
      wipes: perGame(d.wipes, intIn(0, 99)),
      rt: perGame(d.rt, intIn(0, 60_000)),
      span2,
      span1,
    }
  } catch {
    return emptyMeta()
  }
}
