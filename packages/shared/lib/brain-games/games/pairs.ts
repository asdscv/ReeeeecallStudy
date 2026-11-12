import type { BrainGameDef, CellView } from '../types'

/**
 * Flip two cards at a time and find matching pictures — the classic matching game.
 *
 * Board sizes are fixed to ones that fill a rectangle (no empty slots). Past the largest board
 * the preview shrinks to nothing, the pictures come from one look-alike family, and the miss
 * budget tightens — so the level keeps meaning something.
 */
export interface PairsState {
  cols: number
  rows: number
  cards: string[]
  matched: boolean[]
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
  create(level, rng) {
    const board = BOARDS[Math.min(BOARDS.length - 1, Math.floor((level - 1) / 3))]
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
    if (s.cards[a] === s.cards[b]) {
      const matched = s.matched.slice()
      matched[a] = matched[b] = true
      return { ...s, matched, open: [], phase: matched.every(Boolean) ? 'done' : 'play' }
    }
    return { ...s, open, misses: s.misses + 1, phase: 'mismatch' }
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
}
