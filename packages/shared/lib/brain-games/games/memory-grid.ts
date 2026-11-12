import { clamp, range } from '../rng'
import type { BrainGameDef, CellView } from '../types'

/**
 * Cells light up for a moment; tap the ones that were lit. Spatial memory span practice.
 *
 * A span task: the level IS the length (level 1 = 3 cells) and moves by the Corsi rule in
 * rules.ts. The grid grows only up to the widest one that keeps cells ≥ 56dp on this screen —
 * difficulty never comes from shrinking cells, so past that the show time shortens instead.
 */
export interface MemoryGridState {
  n: number
  targets: number[]
  showMs: number
  phase: 'show' | 'recall' | 'done'
  picked: number[]
  wrong: number | null
  timedOut: boolean
}

export const memoryGrid: BrainGameDef<MemoryGridState> = {
  id: 'memoryGrid',
  create(level, rng, ctx) {
    const wanted = 2 + Math.max(1, Math.round(level))
    const n = clamp(Math.ceil(Math.sqrt(wanted * 2.6)), 3, Math.max(3, Math.min(7, ctx.maxCols)))
    const k = Math.min(wanted, Math.floor(n * n * 0.45))
    // Past the largest grid the only lever left is time, so it keeps shrinking with the level.
    const overflow = Math.max(0, wanted - k)
    const showMs = Math.max(1000, 1200 + k * 250 - overflow * 120)
    return {
      n,
      targets: rng.sample(range(n * n), k).sort((a, b) => a - b),
      showMs,
      phase: 'show',
      picked: [],
      wrong: null,
      timedOut: false,
    }
  },
  pendingMs: (s) => (s.phase === 'show' ? s.showMs : null),
  advance: (s) => (s.phase === 'show' ? { ...s, phase: 'recall' } : s),
  acceptsInput: (s) => s.phase === 'recall',
  tap(s, i) {
    if (s.phase !== 'recall' || s.picked.includes(i)) return s
    if (!s.targets.includes(i)) return { ...s, wrong: i, phase: 'done' }
    const picked = [...s.picked, i]
    return { ...s, picked, phase: picked.length === s.targets.length ? 'done' : 'recall' }
  },
  timeout: (s) => (s.phase === 'done' ? s : { ...s, timedOut: true, phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    return {
      correct: s.wrong === null && !s.timedOut && s.picked.length === s.targets.length,
      accuracy: s.picked.length / s.targets.length,
    }
  },
  timeLimitMs: (s) => 3000 + s.targets.length * 900,
  view(s) {
    const cells: CellView[] = range(s.n * s.n).map((i) => {
      const target = s.targets.includes(i)
      if (s.phase === 'show') return { tone: target ? 'lit' : 'idle' }
      if (s.picked.includes(i)) return { tone: 'correct' }
      if (s.phase === 'done') {
        if (i === s.wrong) return { tone: 'wrong' }
        if (target) return { tone: 'missed' }
      }
      return { tone: 'idle' }
    })
    return {
      kind: 'grid',
      cols: s.n,
      rows: s.n,
      cells,
      locked: s.phase !== 'recall',
      prompt:
        s.phase === 'show'
          ? { key: 'play.memorize' }
          : { key: 'play.tapLit', params: { left: s.targets.length - s.picked.length } },
    }
  },
  signature: (s) => `mg:${s.n}:${s.targets.join(',')}`,
}
