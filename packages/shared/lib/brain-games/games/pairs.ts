import type { BrainGameDef, CellView, CreateContext, GridView } from '../types'

/**
 * Flip cards and find matching pictures — the classic matching game (GAMES_DIFFICULTY_PLAN §3.8).
 *
 * The level is a fixed table, looked up with floor(level): the board size, the family the pictures
 * come from (mixed, one distinct family, or one look-alike family), whether a preview is shown and
 * how many mistakes the board allows. From L14 matches are sets of three. Every integer level
 * changes one of these, so a level means the same puzzle on every screen that can hold it. Past
 * L18 the boards grow (owner 2026-11-13 «카드 갯수 더 늘리기»): 30 cards on five columns (L19–21),
 * 36 on a 6×6 screen (L22–24) and 42 on a 7×6 one (L25–26).
 *
 * Turning over a card nobody has seen yet is exploring the board, not a mistake (EVIDENCE #39): a
 * mismatch only counts against the budget when it goes against what had been seen — this card was
 * already seen, or a card that belongs with the open ones had been seen and was passed over. The
 * preview is a hint only: it never marks a card as seen. A board is one trial — finishing it within
 * the budget and the clock is right; one mistake past the budget, or the clock, fails it.
 */
export type PairsFamilyClass = 'mixed' | 'distinct' | 'lookalike'

export interface PairsState {
  level: number
  /** Cards in one match: 2, or 3 on triples boards. */
  size: 2 | 3
  cols: number
  rows: number
  cards: string[]
  family: PairsFamilyClass
  /** The family the faces came from ('mixed' when several). The next board avoids repeating it. */
  familyName: string
  matched: boolean[]
  /** Cards that have been face up at least once in play (the preview does not count). */
  seen: boolean[]
  open: number[]
  phase: 'preview' | 'play' | 'mismatch' | 'done'
  previewMs: number
  /** Mistakes made against what had been seen (informed misses). */
  misses: number
  /** Mistakes the board allows; the next one fails it. */
  budget: number
  /** The mismatch on the board cost nothing (cards never seen): «새 카드 — 괜찮아요». */
  freeMiss: boolean
  timedOut: boolean
}

/** One row of the level table (§3.8). `cols × rows` is the board on a four-column screen or wider. */
export interface PairsRung {
  size: 2 | 3
  sets: number
  cols: number
  rows: number
  family: PairsFamilyClass
  preview: boolean
  budget: number
}

/**
 * The level table, L1 first. The plan's own rows to L18; L19–21 need five columns, L22–24 a 6×6
 * screen and L25–26 a 7×6 one (either way round) — four columns stop at L16.
 */
export const PAIRS_LADDER: readonly PairsRung[] = [
  { size: 2, sets: 3, cols: 3, rows: 2, family: 'mixed', preview: true, budget: 2 },
  { size: 2, sets: 4, cols: 4, rows: 2, family: 'mixed', preview: true, budget: 2 },
  { size: 2, sets: 4, cols: 4, rows: 2, family: 'mixed', preview: false, budget: 2 },
  { size: 2, sets: 6, cols: 4, rows: 3, family: 'mixed', preview: false, budget: 3 },
  { size: 2, sets: 6, cols: 4, rows: 3, family: 'distinct', preview: false, budget: 3 },
  { size: 2, sets: 8, cols: 4, rows: 4, family: 'mixed', preview: false, budget: 3 },
  { size: 2, sets: 8, cols: 4, rows: 4, family: 'distinct', preview: false, budget: 3 },
  { size: 2, sets: 8, cols: 4, rows: 4, family: 'lookalike', preview: false, budget: 3 },
  { size: 2, sets: 10, cols: 4, rows: 5, family: 'distinct', preview: false, budget: 4 },
  { size: 2, sets: 10, cols: 4, rows: 5, family: 'lookalike', preview: false, budget: 4 },
  { size: 2, sets: 12, cols: 4, rows: 6, family: 'distinct', preview: false, budget: 4 },
  { size: 2, sets: 12, cols: 4, rows: 6, family: 'lookalike', preview: false, budget: 4 },
  { size: 2, sets: 12, cols: 4, rows: 6, family: 'lookalike', preview: false, budget: 3 },
  { size: 3, sets: 6, cols: 3, rows: 6, family: 'distinct', preview: false, budget: 4 },
  { size: 3, sets: 8, cols: 4, rows: 6, family: 'distinct', preview: false, budget: 4 },
  { size: 3, sets: 8, cols: 4, rows: 6, family: 'lookalike', preview: false, budget: 4 },
  { size: 3, sets: 10, cols: 5, rows: 6, family: 'distinct', preview: false, budget: 4 },
  { size: 3, sets: 10, cols: 5, rows: 6, family: 'lookalike', preview: false, budget: 4 },
  { size: 2, sets: 15, cols: 5, rows: 6, family: 'distinct', preview: false, budget: 5 },
  { size: 2, sets: 15, cols: 5, rows: 6, family: 'lookalike', preview: false, budget: 5 },
  { size: 3, sets: 10, cols: 5, rows: 6, family: 'lookalike', preview: false, budget: 3 },
  { size: 2, sets: 18, cols: 6, rows: 6, family: 'distinct', preview: false, budget: 5 },
  { size: 2, sets: 18, cols: 6, rows: 6, family: 'lookalike', preview: false, budget: 5 },
  { size: 3, sets: 12, cols: 6, rows: 6, family: 'lookalike', preview: false, budget: 4 },
  { size: 2, sets: 21, cols: 7, rows: 6, family: 'lookalike', preview: false, budget: 5 },
  { size: 3, sets: 14, cols: 7, rows: 6, family: 'lookalike', preview: false, budget: 4 },
]

/** From this level a board must fit the screen as it is (no taller board): the 6×6 and 7×6 rows. */
const FIT_FROM = 22

/** The L1-2 preview: a 2-second look, a hint only. */
export const PAIRS_PREVIEW_MS = 2000
/** A mismatched pair (or set) stays up this long, unless the next tap turns it back sooner. */
export const PAIRS_MISMATCH_MS = 650

/**
 * Picture families: single code points drawn as emoji by default, Unicode 11 or earlier (no 🫐 or
 * 🛻, which older phones draw as boxes), no faces. Distinct families are told apart at a glance —
 * no near twins inside one (no wolf beside the dog, boar beside the pig, tomato beside the apple,
 * brown lumps beside the coconut, two hockey sticks or two oval balls); look-alike ones are not. Each holds at least 21 — the
 * 42-card boards' pairs.
 */
export const PAIRS_FAMILIES = {
  animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐌', '🦋', '🐴', '🐢', '🐙', '🐧', '🐦', '🐝'],
  fruit: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍈', '🥑', '🍆', '🌽', '🥕', '🥒', '🥦', '🧀', '🥚', '🍩'],
  sports: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🏸', '🥊', '⛳', '🎯', '🎳', '🛹', '🥌', '🏆', '🏒', '🛷', '🏏', '🥅', '🎿', '🏹', '🎣', '🥋'],
  vehicles: ['🚗', '🚕', '🚙', '🚌', '🚎', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🚜', '🚘', '🚖', '🚔', '🚍', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚆', '🚈'],
  plants: ['🌸', '🌼', '🌻', '🌺', '🌷', '🌹', '🥀', '💐', '🌿', '🍀', '🍁', '🍂', '🌵', '🌴', '🌲', '🌳', '🌱', '🌾', '🍃', '🍄', '🎋', '🎍', '💮'],
} as const satisfies Record<string, readonly string[]>

export type PairsFamilyName = keyof typeof PAIRS_FAMILIES

export const PAIRS_FAMILY_CLASS: Record<PairsFamilyName, Exclude<PairsFamilyClass, 'mixed'>> = {
  animals: 'distinct',
  fruit: 'distinct',
  sports: 'distinct',
  vehicles: 'lookalike',
  plants: 'lookalike',
}

const NAMES = Object.keys(PAIRS_FAMILIES) as PairsFamilyName[]
const OF_CLASS = (c: Exclude<PairsFamilyClass, 'mixed'>) => NAMES.filter((n) => PAIRS_FAMILY_CLASS[n] === c)

function columns(ctx: CreateContext): number {
  return Math.max(3, Math.min(7, Math.floor(ctx.maxCols)))
}

function screenRows(ctx: CreateContext): number {
  return Math.max(3, Math.min(7, Math.floor(ctx.maxRows)))
}

/**
 * The last level whose board this screen holds: L17–21 (30 cards, 5 wide) need five columns; from
 * L22 a board must fit as it is or turned (6×6, then 7×6).
 */
export function pairsMaxLevel(ctx: CreateContext): number {
  const cols = columns(ctx)
  const rows = screenRows(ctx)
  if (cols < 5) return 16
  let cap = FIT_FROM - 1
  while (cap < PAIRS_LADDER.length) {
    const r = PAIRS_LADDER[cap]
    if (!((r.cols <= cols && r.rows <= rows) || (r.rows <= cols && r.cols <= rows))) break
    cap++
  }
  return cap
}

/**
 * Where a board's cards go on this screen. The table's shape, or turned on its side when that is
 * what fits (a wide, short desktop takes 4×6 as 6×4); taller than the screen only when nothing else
 * fits the columns. Three columns take the nearest board three wide, never with fewer cards (4×4 →
 * 3×6, 4×5 → 3×8): the level means slightly more there, a rare screen.
 */
function layout(cols: number, rows: number, size: 2 | 3, ctx: CreateContext): { cols: number; rows: number } {
  const maxC = columns(ctx)
  const maxR = screenRows(ctx)
  const shapes = [
    [cols, rows],
    [rows, cols],
  ].filter(([c]) => c <= maxC)
  if (shapes.length) {
    const [c, r] = shapes.find(([, rr]) => rr <= maxR) ?? shapes.reduce((a, b) => (b[1] < a[1] ? b : a))
    return { cols: c, rows: r }
  }
  let r = Math.ceil((cols * rows) / 3)
  while ((3 * r) % size !== 0) r++
  return { cols: 3, rows: r }
}

/**
 * The board a level builds on this screen. A blocked rule swaps in that level's other content:
 * no-preview keeps the 2-second preview; triples become pairs with as many cards (6 sets → 9 pairs),
 * which also keeps the clock (6000 + 9000·6 = 6000 + 6000·9).
 */
export function pairsBoard(level: number, ctx: CreateContext): PairsRung {
  const lv = Math.max(1, Math.min(pairsMaxLevel(ctx), Math.floor(Number.isFinite(level) ? level : 1)))
  const rung = PAIRS_LADDER[lv - 1]
  const blocked = (tag: string) => ctx.blockRules.includes(tag)
  const size: 2 | 3 = rung.size === 3 && blocked('pairs.triples') ? 2 : rung.size
  const { cols, rows } = layout(rung.cols, rung.rows, size, ctx)
  return {
    size,
    sets: (cols * rows) / size,
    cols,
    rows,
    family: rung.family,
    preview: rung.preview || blocked('pairs.noPreview'),
    budget: rung.budget,
  }
}

/** The board's clock: 6000 + 6000 per pair, or 6000 + 9000 per set of three. */
export function pairsLimitMs(size: 2 | 3, sets: number): number {
  return 6000 + (size === 3 ? 9000 : 6000) * sets
}

/** A board still taking taps: in play, or during a mismatch that has not used up the budget. */
function live(s: PairsState): boolean {
  return s.phase === 'play' || (s.phase === 'mismatch' && s.misses <= s.budget)
}

/** Turns card `i` face up in play and settles what that means. */
function flip(s: PairsState, i: number): PairsState {
  if (s.matched[i] || s.open.includes(i)) return s
  const open = [...s.open, i]
  if (open.length === 1) return { ...s, open }
  const face = s.cards[open[0]]
  const seen = s.seen.slice()
  for (const j of open) seen[j] = true
  if (s.cards[i] === face) {
    if (open.length < s.size) return { ...s, open, seen }
    const matched = s.matched.slice()
    for (const j of open) matched[j] = true
    return { ...s, matched, seen, open: [], phase: matched.every(Boolean) ? 'done' : 'play' }
  }
  // A mistake is a choice made against what had been seen: this card was already known, or a card
  // that belongs with the open ones had been seen and was passed over. On a triples board this is
  // the same rule for the second and the third card: a third card never seen is free.
  const passedOver = s.cards.some((c, j) => c === face && !open.includes(j) && !s.matched[j] && s.seen[j])
  const informed = s.seen[i] || passedOver
  return { ...s, open, seen, misses: s.misses + (informed ? 1 : 0), freeMiss: !informed, phase: 'mismatch' }
}

export const pairs: BrainGameDef<PairsState> = {
  id: 'pairs',
  create(level, rng, ctx) {
    const board = pairsBoard(level, ctx)
    let familyName = 'mixed'
    let pool: readonly string[]
    if (board.family === 'mixed') {
      pool = OF_CLASS('distinct').flatMap((n) => PAIRS_FAMILIES[n])
    } else {
      // Never the same family as the board before, while the class has another.
      const last = ctx.recent[ctx.recent.length - 1]?.carry
      const names = OF_CLASS(board.family)
      const fresh = names.filter((n) => n !== last)
      const name = rng.pick(fresh.length ? fresh : names)
      familyName = name
      pool = PAIRS_FAMILIES[name]
    }
    const faces = rng.sample(pool, board.sets)
    const cards = rng.shuffle(faces.flatMap((f) => Array.from({ length: board.size }, () => f)))
    const previewMs = board.preview ? PAIRS_PREVIEW_MS : 0
    return {
      level,
      size: board.size,
      cols: board.cols,
      rows: board.rows,
      cards,
      family: board.family,
      familyName,
      matched: cards.map(() => false),
      seen: cards.map(() => false),
      open: [],
      phase: previewMs > 0 ? 'preview' : 'play',
      previewMs,
      misses: 0,
      budget: board.budget,
      freeMiss: false,
      timedOut: false,
    }
  },
  pendingMs(s) {
    if (s.phase === 'preview') return s.previewMs
    if (s.phase === 'mismatch') return PAIRS_MISMATCH_MS
    return null
  },
  advance(s) {
    if (s.phase === 'preview') return { ...s, phase: 'play' }
    if (s.phase === 'mismatch') {
      if (s.misses > s.budget) return { ...s, open: [], freeMiss: false, phase: 'done' }
      return { ...s, open: [], freeMiss: false, phase: 'play' }
    }
    return s
  },
  acceptsInput: live,
  tap(s, i) {
    if (s.phase === 'mismatch') {
      // The next tap does not wait out the mismatch: the open cards turn back at once and the tapped
      // card opens. The mismatch was counted when it happened, never again here.
      if (!live(s) || s.matched[i]) return s
      return flip({ ...s, open: [], freeMiss: false, phase: 'play' }, i)
    }
    if (s.phase !== 'play') return s
    return flip(s, i)
  },
  timeout: (s) => (s.phase === 'done' ? s : { ...s, timedOut: true, open: [], freeMiss: false, phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    const found = s.matched.filter(Boolean).length
    return { correct: found === s.cards.length && !s.timedOut, accuracy: found / s.cards.length, informedMisses: s.misses }
  },
  timeLimitMs: (s) => pairsLimitMs(s.size, s.cards.length / s.size),
  maxLevel: pairsMaxLevel,
  view(s) {
    const cells: CellView[] = s.cards.map((face, i) => {
      if (s.matched[i]) return { label: face, tone: 'matched' }
      // A board that ends unfinished shows every card face up, calmly — no red.
      if (s.phase === 'preview' || s.phase === 'done' || s.open.includes(i)) {
        return { label: face, tone: s.phase === 'mismatch' && s.open.includes(i) ? 'wrong' : 'faceUp' }
      }
      return { tone: 'faceDown' }
    })
    const left = Math.max(0, s.budget - s.misses)
    const view: GridView = {
      kind: 'grid',
      cols: s.cols,
      rows: s.rows,
      cells,
      locked: !live(s),
      prompt:
        s.phase === 'preview'
          ? { key: 'play.memorizePairs' }
          : { key: s.size === 3 ? 'play.findTriples' : 'play.findPairs', params: { lives: left } },
      // Dots and «실수 N번까지» — never hearts: the budget is the board's, not the round's chances.
      budget: { left, total: s.budget },
    }
    if (s.phase === 'preview') view.showBar = { ms: s.previewMs }
    if (s.family === 'lookalike') view.badge = { key: 'play.lookalikeBadge' }
    if (s.size === 3 && s.phase !== 'preview') view.progress = { kind: 'set', open: s.open.length, size: 3 }
    if (s.phase === 'mismatch' && s.freeMiss) view.chip = { key: 'play.newCardFree' }
    return view
  },
  signature: (s) => `pr${s.size}:${s.cards.join('')}`,
  mechanics(s) {
    const tags = [4, 6, 8, 10, 12, 15, 18, 21].filter((n) => s.cards.length >= 2 * n).map((n) => `pairs.board${n}`)
    if (s.family !== 'mixed') tags.push('pairs.oneFamily')
    if (s.family === 'lookalike') tags.push('pairs.lookalike')
    if (s.previewMs === 0) tags.push('pairs.noPreview')
    if (s.size === 3) tags.push('pairs.triples')
    return tags
  },
  trialInfo: (s) => ({ kind: `${s.size}x${s.cards.length / s.size}`, carry: s.familyName }),
  solution(s) {
    if (!live(s)) return null
    // During a mismatch the next tap turns the open cards back first, so nothing counts as open.
    const open = s.phase === 'mismatch' ? [] : s.open
    const rest = (face: string, not: readonly number[]) => s.cards.flatMap((c, j) => (c === face && !s.matched[j] && !not.includes(j) ? [j] : []))
    if (open.length) return rest(s.cards[open[0]], open)
    const first = s.matched.findIndex((m) => !m)
    return first < 0 ? null : [first, ...rest(s.cards[first], [first])]
  },
}
