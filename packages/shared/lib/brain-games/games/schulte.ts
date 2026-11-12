import { range } from '../rng'
import type { BrainGameDef, CellView } from '../types'

/**
 * Numbers scattered on a grid; tap them in order. Visual search and sustained attention.
 *
 * One grid is one trial, but lives are spent per wrong TAP inside it (a tap on a number that is
 * not the next one), not per grid: a slow, clean grid costs nothing, and the grid stops as soon as
 * the round's remaining lives are gone.
 */
export interface SchulteState {
  n: number
  /** cell index → number shown */
  values: number[]
  order: 'asc' | 'desc'
  /** The board reshuffles after every correct tap. */
  shuffleEach: boolean
  found: number
  mistakes: number
  /** Wrong taps this grid can absorb — the round's lives left when it was made. */
  maxMistakes: number
  flashWrong: number | null
  timedOut: boolean
  seed: number
}


function nextValue(s: SchulteState): number {
  return s.order === 'asc' ? s.found + 1 : s.n * s.n - s.found
}

function isFound(s: SchulteState, value: number): boolean {
  return s.order === 'asc' ? value <= s.found : value > s.n * s.n - s.found
}

/** Deterministic reshuffle so `tap` stays a pure function of the state. */
function reshuffle(values: number[], seed: number): number[] {
  const out = values.slice()
  let a = seed >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9e3779b9) >>> 0
    const j = a % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export const schulte: BrainGameDef<SchulteState> = {
  id: 'schulte',
  create(level, rng, ctx) {
    let n = Math.min(level < 4 ? 3 : level < 9 ? 4 : level < 16 ? 5 : 6, Math.max(3, ctx.maxCols))
    const shuffleEach = level >= 12 && rng.chance(0.25)
    if (shuffleEach) n = Math.max(3, n - 1)
    return {
      n,
      values: rng.shuffle(range(n * n).map((i) => i + 1)),
      order: level >= 5 && rng.chance(0.35) ? 'desc' : 'asc',
      shuffleEach,
      found: 0,
      mistakes: 0,
      maxMistakes: Math.max(1, ctx.livesLeft),
      flashWrong: null,
      timedOut: false,
      seed: rng.int(1, 0x7ffffff),
    }
  },
  pendingMs: () => null,
  advance: (s) => s,
  acceptsInput: (s) => schulte.outcome(s) === null,
  tap(s, i) {
    if (schulte.outcome(s) !== null) return s
    const value = s.values[i]
    if (isFound(s, value)) return s
    if (value !== nextValue(s)) return { ...s, mistakes: s.mistakes + 1, flashWrong: i }
    const found = s.found + 1
    const values = s.shuffleEach ? reshuffle(s.values, s.seed + found) : s.values
    return { ...s, found, values, flashWrong: null }
  },
  timeout: (s) => ({ ...s, timedOut: true }),
  outcome(s) {
    const total = s.n * s.n
    if (s.found === total) return { correct: true, accuracy: 1, livesSpent: s.mistakes }
    if (s.mistakes >= s.maxMistakes || s.timedOut) return { correct: false, accuracy: s.found / total, livesSpent: s.mistakes }
    return null
  },
  timeLimitMs: (s) => 2000 + s.n * s.n * (s.shuffleEach ? 2200 : 1500),
  view(s) {
    const cells: CellView[] = s.values.map((value, i) => ({
      label: String(value),
      tone: isFound(s, value) ? 'done' : i === s.flashWrong ? 'wrong' : 'idle',
    }))
    const total = s.n * s.n
    return {
      kind: 'grid',
      cols: s.n,
      rows: s.n,
      cells,
      locked: false,
      prompt: {
        key: s.order === 'asc' ? 'play.tapAscending' : 'play.tapDescending',
        params: {
          next: s.found < total ? nextValue(s) : total,
          max: total,
          lives: s.maxMistakes - s.mistakes,
        },
      },
    }
  },
  signature: (s) => `sc:${s.order}:${s.values.join(',')}`,
  solution: (s) => (schulte.outcome(s) === null ? [s.values.indexOf(nextValue(s))] : null),
}
