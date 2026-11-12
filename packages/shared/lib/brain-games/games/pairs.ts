import type { BrainGameDef, CellView } from '../types'

/**
 * Flip two cards at a time and find matching pictures — the classic matching game.
 *
 * Board sizes are fixed to ones that fill a rectangle (no empty slots). Past the largest board
 * the preview shrinks to nothing, the pictures come from one look-alike family, and the miss
 * budget tightens — so the level keeps meaning something.
 *
 * Turning over a card nobody has seen yet is exploring the board, not a mistake: a mismatch only
 * counts against the budget when it goes against what the player had already seen. A board is one trial —
 * finishing it within the budget is right, running out is one life.
 */
export interface PairsState {
  cols: number
  rows: number
  cards: string[]
  matched: boolean[]
  /** Cards that have been face up at least once (after the preview). */
  seen: boolean[]
  open: number[]
  phase: 'preview' | 'play' | 'mismatch' | 'done'
  previewMs: number
  misses: number
  maxMisses: number
  timedOut: boolean
}

const BOARDS: readonly { pairs: number; cols: number; rows: number }[] = [
  { pairs: 3, cols: 3, rows: 2 },
  { pairs: 4, cols: 4, rows: 2 },
  { pairs: 6, cols: 4, rows: 3 },
  { pairs: 8, cols: 4, rows: 4 },
  { pairs: 10, cols: 4, rows: 5 },
  { pairs: 12, cols: 4, rows: 6 },
]

const FAMILIES: readonly string[][] = [
  ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔'],
  ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🫐'],
  ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🥊', '⛳', '🎯', '🎳', '🛹', '🥌'],
  ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍', '🚲'],
  ['🌸', '🌼', '🌻', '🌺', '🌷', '🌹', '🥀', '💐', '🌿', '🍀', '🍁', '🍂', '🌵', '🌴', '🌲', '🌳'],
  ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😇', '😍', '😋', '😎', '🤓', '🥳'],
]

export const pairs: BrainGameDef<PairsState> = {
  id: 'pairs',
  create(level, rng, ctx) {
    const fits = BOARDS.filter((b) => b.cols <= Math.max(3, ctx.maxCols))
    const board = fits[Math.min(fits.length - 1, Math.floor((level - 1) / 3))]
    // Low levels mix families (easy to tell apart); high levels draw from a single one.
    const pool =
      level >= 10 ? rng.pick(FAMILIES) : rng.shuffle(FAMILIES.flat())
    const faces = rng.sample(pool, board.pairs)
    const cards = rng.shuffle([...faces, ...faces])
    const previewMs = level < 18 ? Math.max(0, 1500 + board.pairs * 250 - level * 90) : 0
    return {
      cols: board.cols,
      rows: board.rows,
      cards,
      matched: cards.map(() => false),
      seen: cards.map(() => previewMs > 0),
      open: [],
      phase: previewMs > 0 ? 'preview' : 'play',
      previewMs,
      misses: 0,
      maxMisses: Math.round(board.pairs * Math.max(0.8, 2.2 - level * 0.06)) + 2,
      timedOut: false,
    }
  },
  pendingMs(s) {
    if (s.phase === 'preview') return s.previewMs
    if (s.phase === 'mismatch') return 650
    return null
  },
  advance(s) {
    if (s.phase === 'preview') return { ...s, phase: 'play' }
    if (s.phase === 'mismatch') {
      if (s.misses > s.maxMisses) return { ...s, open: [], phase: 'done' }
      return { ...s, open: [], phase: 'play' }
    }
    return s
  },
  acceptsInput: (s) => s.phase === 'play' || s.phase === 'mismatch',
  tap(s, i) {
    if (s.phase !== 'play' || s.matched[i] || s.open.includes(i)) return s
    const open = [...s.open, i]
    if (open.length < 2) return { ...s, open }
    const [a, b] = open
    // A mistake is a choice made against what the player had seen: the second card was already
    // known (and is not the partner), or the first card's partner had been seen and was passed over.
    const partnerKnown = s.cards.some((c, j) => j !== a && c === s.cards[a] && s.seen[j] && !s.matched[j])
    const informed = s.seen[b] || partnerKnown
    const seen = s.seen.slice()
    seen[a] = seen[b] = true
    if (s.cards[a] === s.cards[b]) {
      const matched = s.matched.slice()
      matched[a] = matched[b] = true
      return { ...s, matched, seen, open: [], phase: matched.every(Boolean) ? 'done' : 'play' }
    }
    return { ...s, open, seen, misses: s.misses + (informed ? 1 : 0), phase: 'mismatch' }
  },
  timeout: (s) => (s.phase === 'done' ? s : { ...s, timedOut: true, open: [], phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    const found = s.matched.filter(Boolean).length
    return { correct: found === s.cards.length && !s.timedOut, accuracy: found / s.cards.length }
  },
  timeLimitMs: (s) => 6000 + (s.cards.length / 2) * 6000,
  view(s) {
    const cells: CellView[] = s.cards.map((face, i) => {
      if (s.matched[i]) return { label: face, tone: 'matched' }
      if (s.phase === 'preview' || s.phase === 'done' || s.open.includes(i)) {
        return { label: face, tone: s.phase === 'mismatch' && s.open.includes(i) ? 'wrong' : 'faceUp' }
      }
      return { tone: 'faceDown' }
    })
    return {
      kind: 'grid',
      cols: s.cols,
      rows: s.rows,
      cells,
      locked: s.phase !== 'play',
      prompt:
        s.phase === 'preview'
          ? { key: 'play.memorizePairs' }
          : { key: 'play.findPairs', params: { lives: Math.max(0, s.maxMisses - s.misses + 1) } },
    }
  },
  signature: (s) => `pr:${s.cards.join('')}`,
  solution(s) {
    if (s.phase !== 'play') return null
    const partner = (i: number) => s.cards.findIndex((c, j) => j !== i && c === s.cards[i] && !s.matched[j])
    if (s.open.length === 1) return [partner(s.open[0])]
    const first = s.matched.findIndex((m) => !m)
    return first < 0 ? null : [first, partner(first)]
  },
}
