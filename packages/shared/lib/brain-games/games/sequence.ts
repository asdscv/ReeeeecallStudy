import { range } from '../rng'
import type { BrainGameDef, CellView } from '../types'

/** Tiles flash one after another; repeat the order (or reverse it). Sequential memory span. */
export interface SequenceState {
  n: number
  seq: number[]
  reverse: boolean
  flashMs: number
  gapMs: number
  phase: 'watch' | 'input' | 'done'
  /** -1 is the lead-in pause before the first flash. */
  step: number
  flashOn: boolean
  inputs: number[]
  wrong: number | null
  timedOut: boolean
}

function expected(s: SequenceState): number {
  return s.reverse ? s.seq[s.seq.length - 1 - s.inputs.length] : s.seq[s.inputs.length]
}

export const sequence: BrainGameDef<SequenceState> = {
  id: 'sequence',
  create(level, rng) {
    const length = 3 + Math.floor((level - 1) * 0.45)
    const n = length >= 7 ? 4 : 3
    const seq: number[] = []
    for (let i = 0; i < length; i++) {
      let cell = rng.int(0, n * n - 1)
      // The same tile twice in a row reads as one long flash.
      while (cell === seq[i - 1]) cell = rng.int(0, n * n - 1)
      seq.push(cell)
    }
    return {
      n,
      seq,
      reverse: level >= 6 && rng.chance(Math.min(0.5, 0.2 + (level - 6) * 0.03)),
      flashMs: Math.max(360, 750 - level * 14),
      gapMs: Math.max(140, 300 - level * 5),
      phase: 'watch',
      step: -1,
      flashOn: false,
      inputs: [],
      wrong: null,
      timedOut: false,
    }
  },
  pendingMs(s) {
    if (s.phase !== 'watch') return null
    if (s.step === -1) return 700
    return s.flashOn ? s.flashMs : s.gapMs
  },
  advance(s) {
    if (s.phase !== 'watch') return s
    if (s.step === -1) return { ...s, step: 0, flashOn: true }
    if (s.flashOn) return { ...s, flashOn: false }
    const step = s.step + 1
    if (step >= s.seq.length) return { ...s, step, phase: 'input' }
    return { ...s, step, flashOn: true }
  },
  acceptsInput: (s) => s.phase === 'input',
  tap(s, i) {
    if (s.phase !== 'input') return s
    if (i !== expected(s)) return { ...s, wrong: i, phase: 'done' }
    const inputs = [...s.inputs, i]
    return { ...s, inputs, phase: inputs.length === s.seq.length ? 'done' : 'input' }
  },
  timeout: (s) => (s.phase === 'done' ? s : { ...s, timedOut: true, phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    return {
      correct: s.wrong === null && !s.timedOut && s.inputs.length === s.seq.length,
      accuracy: s.inputs.length / s.seq.length,
    }
  },
  timeLimitMs: (s) => 3000 + s.seq.length * 1200,
  view(s) {
    const last = s.inputs[s.inputs.length - 1]
    const missedCell = s.phase === 'done' && s.wrong !== null ? expected(s) : null
    const cells: CellView[] = range(s.n * s.n).map((i) => {
      if (s.phase === 'watch') return { tone: s.flashOn && s.seq[s.step] === i ? 'lit' : 'idle' }
      if (s.phase === 'done' && i === s.wrong) return { tone: 'wrong' }
      if (i === missedCell) return { tone: 'missed' }
      if (i === last) return { tone: 'correct' }
      return { tone: 'idle' }
    })
    return {
      kind: 'grid',
      cols: s.n,
      rows: s.n,
      cells,
      locked: s.phase !== 'input',
      prompt:
        s.phase === 'watch'
          ? { key: s.reverse ? 'play.watchReverse' : 'play.watch' }
          : {
              key: s.reverse ? 'play.repeatReverse' : 'play.repeat',
              params: { done: s.inputs.length, total: s.seq.length },
            },
    }
  },
  signature: (s) => `sq:${s.reverse ? 'r' : 'f'}:${s.seq.join(',')}`,
}
