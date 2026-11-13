import { range, type Rng } from '../rng'
import type { BrainGameDef, CellInk, CellView, CreateContext, GridView, RecentTrial } from '../types'

/**
 * Every cell is the same except one. Find it. Selective attention.
 *
 * A level is a content tier and a board size (owner, 2026-11-13: «난이도 올릴 때 전체 카드 갯수
 * 올리도록», «처음에는 4개 카드에서 찾기, 그 다음에 9개 16개 25개 36개»). Inside every tier the board
 * grows one size a level — 2×2, 3×3, 4×4, 5×5, 6×6, as far as the screen allows — and the next tier
 * starts again at 4 cards: a pop-out (L1-5), same-colour look-alikes (L6-10), confusable letters
 * (L11-15), the one mirror image among glyphs all turned at random (L16-20), mirror images and
 * near-identical CJK characters in colour noise (L21-25), and those again on boards that may have no
 * odd one at all (L26-31, «없음», with a 7×7 step where the screen allows). Past L31 only the clock
 * tightens, to a floor. No board asks for the one turned glyph: a turn alone is not the puzzle
 * (owner: «하나만 회전되어 있는거 찾기 빼자»; `oddOneOut.rotation` is retired).
 */
export type OddKind = 'pop' | 'lookalike' | 'glyph' | 'noise' | 'mirror' | 'twin'

export interface OddOneOutState {
  /** The level this board was built at (its tier's first level when it opens new content — see `arriving`). */
  level: number
  /** Content tier, 1-6. */
  tier: number
  cols: number
  rows: number
  kind: OddKind
  common: string
  /** The odd cell's label (the common one on an empty board, and on mirror boards). */
  odd: string
  /** Per cell, degrees; 0 is upright. Only mirror boards turn their cells. */
  rotations: number[]
  /** Per cell ink on colour-noise boards (tier 5 on); empty otherwise. */
  inks: CellInk[]
  /** Mirror boards: the odd one is drawn mirrored. */
  mirror: boolean
  /** No odd one on this board: «없음» is the answer, and `oddIndex` is the cell count. */
  absent: boolean
  /**
   * The «없음» button is on the board. Once that rule is in play it is on every board, so its
   * presence never gives an empty board away.
   */
  none: boolean
  /** The rules open on this board — 'm' mirror images, 'n' «없음» — carried in ctx.recent with the tier. */
  open: string
  oddIndex: number
  limitMs: number
  phase: 'find' | 'done'
  picked: number | null
  timedOut: boolean
}

const RULE = { mirror: 'oddOneOut.mirror', absent: 'oddOneOut.absent' } as const

/** Content tiers, five levels each (the last one open-ended); every tier starts again at 2×2. */
export const ODD_TIER_COUNT = 6
export const ODD_TIER_LEVELS = 5

/** The highest level on any screen: where a 7×7 desktop's clock reaches its floor (maxLevel). */
export const ODD_MAX_LEVEL = 39

/** Tier 1: the pair differs in shape AND colour — the only pop-out in the game (no colour-only pairs anywhere). */
export const POP_PAIRS: readonly (readonly [string, string])[] = [
  ['🍎', '🍌'], ['🌸', '🍀'], ['⚽', '🏀'], ['🍓', '🍇'],
  ['🐸', '🐷'], ['🍋', '🍆'], ['💧', '🔥'], ['🥕', '🥦'],
]

/** Tier 2: same colour, similar outline. The last emoji in the game (none from tier 3). */
export const LOOKALIKE_PAIRS: readonly (readonly [string, string])[] = [
  ['🍊', '🍑'], ['🐯', '🦁'], ['🐭', '🐹'], ['🍋', '🍈'], ['🐸', '🐢'], ['🍒', '🍓'],
]

/**
 * Tier 3: confusable letters — mirror images (b/d, p/q) and one stroke more or less (E/F, O/Q, C/G).
 * No turned pair (6/9 was one): a turn alone is not the puzzle.
 */
export const GLYPH_PAIRS: readonly (readonly [string, string])[] = [
  ['b', 'd'], ['p', 'q'], ['E', 'F'], ['O', 'Q'], ['C', 'G'],
]

/** Tier 5 on: characters that differ only in a stroke's length (system CJK fonts; no bundled font). */
export const TWIN_PAIRS: readonly (readonly [string, string])[] = [
  ['日', '曰'], ['土', '士'], ['未', '末'], ['人', '入'],
]

/** No mirror symmetry under any turn: a mirrored copy is never the same glyph turned. */
export const MIRROR_GLYPHS: readonly string[] = ['F', 'P', 'G', 'J']

const INKS: readonly CellInk[] = ['neutral', 'amber', 'cyan']

/** What each tier draws, by weight: one kind, or two (never the same one three times running). */
const TIER_KINDS: readonly Partial<Record<OddKind, number>>[] = [
  { pop: 1 },
  { lookalike: 1 },
  { glyph: 1 },
  { mirror: 1 },
  { mirror: 0.5, twin: 0.5 },
  { mirror: 0.5, twin: 0.5 },
]
/** The tier mirror boards start in, and the one from which every board is in colour noise. */
const MIRROR_TIER = 4
const INKED_TIER = 5

/** The content tier (1-6) a level is in. */
export function oddOneOutTier(level: number): number {
  const lv = Math.max(1, Math.floor(level))
  return Math.min(ODD_TIER_COUNT, Math.floor((lv - 1) / ODD_TIER_LEVELS) + 1)
}

/** A tier's first level — its 2×2 board. */
export function oddTierStart(tier: number): number {
  return 1 + (tier - 1) * ODD_TIER_LEVELS
}

/** The board side a level asks for before the screen caps it: 2 + its step in the tier (the last tier adds 7×7). */
export function oddOneOutSide(level: number): number {
  const tier = oddOneOutTier(level)
  const step = Math.max(1, Math.floor(level)) - oddTierStart(tier)
  return 2 + Math.min(step, tier === ODD_TIER_COUNT ? 5 : 4)
}

/** The kinds a level draws from, by weight, before rule gating and the no-three-in-a-row rule. */
export function oddKindWeights(level: number): Partial<Record<OddKind, number>> {
  return TIER_KINDS[oddOneOutTier(level) - 1]
}

/** Share of boards with no odd one, once the «없음» rule is in play: a quarter on its first three sizes, then a third. */
export function oddAbsentShare(level: number): number {
  const lv = Math.floor(level)
  const from = oddTierStart(ODD_TIER_COUNT)
  return lv < from ? 0 : lv < from + 3 ? 0.25 : 1 / 3
}

/** Search cost per card (ms) — the clock's slope; colour noise adds INK_MS. Modelled, to be recalibrated (EVIDENCE §4.5). */
const ITEM_MS: Record<OddKind, number> = { pop: 130, lookalike: 240, glyph: 270, noise: 270, twin: 300, mirror: 600 }
const INK_MS = 30

/**
 * The clock's shape: a base (orienting, the tap) of 4 s; each tier × 0.87 on the base and × 0.72 on
 * the per-card cost; each board step × 0.93; past the last tier's 7×7 step × 0.925 a level.
 */
const CLOCK = { base: 4000, tierBase: 0.87, tierItem: 0.72, step: 0.93, deep: 0.925 } as const

/**
 * The input clock: max(900 + 45·cells, (4000·0.87^(T−1) + cells·itemMs·0.72^(T−1)) × 0.93^step × 0.925^deep),
 * T the tier, `step` the level's place in it (fractions too, so a level's clock tightens toward the
 * next one), capped at 5, and `deep` the levels past the last tier's 7×7 step. A bigger board gets
 * more time in all but less per card, so each size is harder than the one before (a screen that caps
 * the board still gets a 7% tighter clock); a new tier starts on 4 cards with its harder content.
 *
 * An empty board has to be searched to the end, so the plan gives it 1.4× its kind's clock. But the
 * timer bar drains at 1/limit: a bar running 1.4× slower than that kind's usual one would say «this
 * board is empty» before the player has looked. So once the «없음» button is on the board (`none`),
 * every board — empty or not — gets the same 1 + 0.4·(empty share): 1.1× at L26-28, 1.13× from L29.
 * The average clock is the plan's (75% × 1 + 25% × 1.4 = 1.1), and the bar gives nothing away.
 */
export function oddOneOutLimitMs(kind: OddKind, level: number, cells: number, opts: { none?: boolean; inked?: boolean } = {}): number {
  const lv = Math.min(ODD_MAX_LEVEL, Math.max(1, level))
  const tier = oddOneOutTier(lv)
  const step = lv - oddTierStart(tier)
  const perCard = ITEM_MS[kind] + (opts.inked ? INK_MS : 0)
  const raw =
    (CLOCK.base * CLOCK.tierBase ** (tier - 1) + cells * perCard * CLOCK.tierItem ** (tier - 1)) *
    CLOCK.step ** Math.min(step, 5) *
    CLOCK.deep ** Math.max(0, step - 5)
  const ms = Math.max(900 + 45 * cells, raw)
  return Math.round(opts.none ? ms * (1 + 0.4 * oddAbsentShare(lv)) : ms)
}

/**
 * The board's side, as far as the screen allows (a phone stays at 5×5, and climbs by the next tier
 * instead). A screen known to be short (fewer than 7 rows) keeps a row free for the «없음» button.
 */
function gridSide(level: number, ctx: Pick<CreateContext, 'maxCols' | 'maxRows'>, none: boolean): number {
  const maxRows = ctx.maxRows ?? 7
  const rows = maxRows >= 7 ? 7 : maxRows - (none ? 1 : 0)
  return Math.max(2, Math.min(oddOneOutSide(level), ctx.maxCols, rows))
}

/**
 * Whether this board opens content the round has not shown, though the level is past its tier's
 * first board: none of the last trials (ctx.recent, each carrying its tier and open rules) was in
 * this tier or above with every rule open now. Climbing a level at a time never gets here — a tier
 * starts on 2×2 anyway — but a jump does: placement handing over mid-tier, or a rule (mirror,
 * «없음») opening on a tier the round was playing without it. A round's first trial has nothing to
 * compare with, and a trial the round built before this rule existed (no carry) counts as seen.
 */
function arriving(recent: readonly RecentTrial[], tier: number, open: string): boolean {
  const covers = (r: RecentTrial) => {
    const t = Number.parseInt(r.carry ?? '', 10)
    if (!Number.isFinite(t)) return true
    return t >= tier && [...open].every((rule) => r.carry!.includes(rule))
  }
  return recent.length > 0 && !recent.some(covers)
}

/**
 * The kind for this board. A blocked mirror's share goes to that tier's plain content (letters, in
 * colour noise from tier 5), and a kind the last two boards both had sits this one out while any
 * other remains. A mirror just opened is shown at once (`forceMirror`), on the smallest board.
 */
function pickKind(tier: number, rng: Rng, recent: readonly RecentTrial[], mirrorOpen: boolean, forceMirror: boolean): OddKind {
  if (forceMirror) return 'mirror'
  const w = new Map(Object.entries(TIER_KINDS[tier - 1]) as [OddKind, number][])
  const mirror = w.get('mirror')
  if (!mirrorOpen && mirror !== undefined) {
    const to: OddKind = tier >= INKED_TIER ? 'noise' : 'glyph'
    w.delete('mirror')
    w.set(to, (w.get(to) ?? 0) + mirror)
  }
  const [a, b] = recent.slice(-2)
  if (a && b && a.kind === b.kind && w.has(a.kind as OddKind) && w.size > 1) w.delete(a.kind as OddKind)
  const total = [...w.values()].reduce((s, x) => s + x, 0)
  let r = rng.next() * total
  for (const [kind, x] of w) {
    r -= x
    if (r < 0) return kind
  }
  return [...w.keys()][w.size - 1]
}

/** Colour noise: every cell a random ink, the others in at least two; the odd one takes one of theirs. */
function noiseInks(cells: number, oddIndex: number, rng: Rng): CellInk[] {
  const inks = range(cells).map(() => rng.pick(INKS))
  const others = range(cells).filter((i) => i !== oddIndex)
  const [a, b] = rng.sample(others, 2)
  const [ia, ib] = rng.sample(INKS, 2)
  inks[a] = ia
  inks[b] = ib
  if (oddIndex < cells) inks[oddIndex] = inks[rng.pick(others)]
  return inks
}

/**
 * A mirror board's turns: every cell at a random 45° step, the others always at two angles or more —
 * so there is no «upright» for the odd one to break, and only its mirroring tells it apart.
 */
function mirrorTurns(cells: number, oddIndex: number, rng: Rng): number[] {
  const turns = range(cells).map(() => rng.int(0, 7) * 45)
  const others = range(cells).filter((i) => i !== oddIndex)
  if (others.every((i) => turns[i] === turns[others[0]])) {
    const i = rng.pick(others)
    turns[i] = (turns[i] + 45 * rng.int(1, 7)) % 360
  }
  return turns
}

const pairOf = (pairs: readonly (readonly [string, string])[], rng: Rng): [string, string] => {
  const p = rng.pick(pairs)
  return rng.chance(0.5) ? [p[0], p[1]] : [p[1], p[0]]
}

export const oddOneOut: BrainGameDef<OddOneOutState> = {
  id: 'oddOneOut',
  create(level, rng, ctx) {
    const asked = Number.isFinite(level) ? Math.min(ODD_MAX_LEVEL, Math.max(1, level)) : 1
    const tier = oddOneOutTier(asked)
    const blocked = (tag: string) => (ctx.blockRules ?? []).includes(tag)
    const recent = ctx.recent ?? []
    const mirrorOpen = tier >= MIRROR_TIER && !blocked(RULE.mirror)
    const none = tier === ODD_TIER_COUNT && !blocked(RULE.absent)
    const open = `${mirrorOpen ? 'm' : ''}${none ? 'n' : ''}`
    // New content starts on its tier's first board; placement measures, and practice is level 1.
    const trial = ctx.trialKind ?? 'counted'
    const fresh = (trial === 'counted' || trial === 'intro') && arriving(recent, tier, open)
    const lv = fresh && Math.floor(asked) > oddTierStart(tier) ? oddTierStart(tier) : asked
    const kind = pickKind(tier, rng, recent, mirrorOpen, fresh && mirrorOpen && !recent.some((r) => r.carry?.includes('m')))
    const side = gridSide(lv, ctx, none)
    const cells = side * side
    const absent = none && rng.chance(oddAbsentShare(lv))
    const oddIndex = absent ? cells : rng.int(0, cells - 1)

    let common: string
    let odd: string
    let rotations = range(cells).map(() => 0)
    let mirror = false
    switch (kind) {
      case 'pop':
        ;[common, odd] = pairOf(POP_PAIRS, rng)
        break
      case 'lookalike':
        ;[common, odd] = pairOf(LOOKALIKE_PAIRS, rng)
        break
      case 'glyph':
      case 'noise':
        ;[common, odd] = pairOf(GLYPH_PAIRS, rng)
        break
      case 'twin':
        ;[common, odd] = pairOf(TWIN_PAIRS, rng)
        break
      case 'mirror':
        common = odd = rng.pick(MIRROR_GLYPHS)
        rotations = mirrorTurns(cells, oddIndex, rng)
        mirror = !absent
        break
    }
    const inks = tier >= INKED_TIER ? noiseInks(cells, oddIndex, rng) : []
    if (absent) odd = common
    return {
      level: lv,
      tier,
      cols: side,
      rows: side,
      kind,
      common,
      odd,
      rotations,
      inks,
      mirror,
      absent,
      none,
      open,
      oddIndex,
      limitMs: oddOneOutLimitMs(kind, lv, cells, { none, inked: inks.length > 0 }),
      phase: 'find',
      picked: null,
      timedOut: false,
    }
  },
  pendingMs: () => null,
  advance: (s) => s,
  acceptsInput: (s) => s.phase === 'find',
  tap(s, i) {
    const cells = s.cols * s.rows
    if (s.phase !== 'find' || i < 0 || i > cells || (i === cells && !s.none)) return s
    return { ...s, picked: i, phase: 'done' }
  },
  timeout: (s) => (s.phase === 'done' ? s : { ...s, timedOut: true, phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    const correct = s.picked === s.oddIndex && !s.timedOut
    return { correct, accuracy: correct ? 1 : 0 }
  },
  timeLimitMs: (s) => s.limitMs,
  // Where the slowest board (a mirror in colour noise) meets the clock's floor on this screen's
  // biggest last-tier board: L39 on a 7×7 desktop and a 5×5 phone, L38 on 4 or 3 columns — always
  // above the master tier (31).
  maxLevel(ctx) {
    const side = gridSide(ODD_MAX_LEVEL, ctx, true)
    const cells = side * side
    for (let lv = oddTierStart(ODD_TIER_COUNT) + 5; lv < ODD_MAX_LEVEL; lv++) {
      if (oddOneOutLimitMs('mirror', lv, cells, { inked: true }) <= 900 + 45 * cells) return Math.max(32, lv)
    }
    return ODD_MAX_LEVEL
  },
  view(s) {
    const count = s.cols * s.rows
    const done = s.phase === 'done'
    const cells: CellView[] = range(count).map((i) => {
      const isOdd = i === s.oddIndex
      let tone: CellView['tone'] = 'idle'
      if (done) {
        if (isOdd) tone = s.picked === i ? 'correct' : 'missed'
        else if (s.picked === i) tone = 'wrong'
      }
      const cell: CellView = { label: isOdd ? s.odd : s.common, tone }
      if (s.rotations[i]) cell.rotate = s.rotations[i]
      if (isOdd && s.mirror) cell.mirror = true
      if (s.inks.length) cell.ink = s.inks[i]
      return cell
    })
    const view: GridView = {
      kind: 'grid',
      cols: s.cols,
      rows: s.rows,
      cells,
      locked: s.phase !== 'find',
      prompt: { key: s.none ? 'play.findOddOrNone' : 'play.findOdd' },
    }
    if (s.none) {
      let tone: CellView['tone'] | undefined
      if (done) tone = s.absent ? (s.picked === count ? 'correct' : 'missed') : s.picked === count ? 'wrong' : undefined
      view.extra = { key: 'play.noneOdd', index: count, ...(tone ? { tone } : {}) }
    }
    // After a miss: the odd one beside a typical one, both upright (a mirror image stays mirrored).
    const missed = done && !(s.picked === s.oddIndex && !s.timedOut)
    if (missed && !s.absent) {
      view.missChip = { odd: { label: s.odd, tone: 'idle', ...(s.mirror ? { mirror: true } : {}) }, common: { label: s.common, tone: 'idle' } }
    }
    return view
  },
  signature: (s) => `oo:${s.kind}:${s.common}:${s.odd}:${s.oddIndex}`,
  solution: (s) => (s.phase === 'find' ? [s.oddIndex] : null),
  mechanics(s) {
    const tags: string[] = []
    for (let n = 4; n <= 7; n++) if (s.cols >= n) tags.push(`oddOneOut.grid${n}`)
    switch (s.kind) {
      case 'lookalike':
        tags.push('oddOneOut.lookalike')
        break
      case 'glyph':
      case 'noise':
        tags.push('oddOneOut.glyphs')
        break
      case 'mirror':
        tags.push(RULE.mirror)
        break
      case 'twin':
        tags.push('oddOneOut.glyphTwin')
        break
    }
    if (s.inks.length) tags.push('oddOneOut.colorNoise')
    if (s.none) tags.push(RULE.absent)
    return tags
  },
  trialInfo: (s) => ({ kind: s.kind, carry: `${s.tier}${s.open}` }),
}
