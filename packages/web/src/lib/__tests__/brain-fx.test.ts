import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { CellTone, CellView, GridView, RoundView } from '@reeeeecall/shared/lib/brain-games'
import type { BrainRound, TrialResult } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainFx, type BrainFx } from '@reeeeecall/shared/hooks/useBrainFx'

/**
 * The round events the new boards add (GAMES_DIFFICULTY_PLAN §5, WP-J): Flash Grid's waves, a right
 * «없음», Number Hunt's second series, and the run of hits starting over after a miss. Driven with
 * hand-made round states, since no game emits these views yet.
 */

type Fake = Pick<BrainRound, 'view' | 'trialId' | 'quiet' | 'result' | 'gameId' | 'lives' | 'practice' | 'placing' | 'stageUp' | 'over' | 'done'> & { stats: Partial<BrainRound['stats']> }

function fake(view: RoundView, over: Partial<Fake> = {}): Fake {
  return { view, trialId: 1, quiet: false, result: null, gameId: 'memoryGrid', lives: 3, practice: false, placing: false, stageUp: null, over: false, done: false, stats: { streak: 1, endedBy: null, isNewBest: false }, ...over }
}

function cells(tones: CellTone[], extra: Partial<CellView> = {}): CellView[] {
  return tones.map((tone) => ({ tone, ...extra }))
}

function gridView(tones: CellTone[], over: Partial<GridView> = {}): GridView {
  return { kind: 'grid', cols: 3, rows: 3, cells: cells(tones), prompt: { key: 'play.memorize' }, locked: true, ...over }
}

function run(first: Fake) {
  const log: BrainFx[] = []
  const hook = renderHook((r: Fake) => useBrainFx(r as unknown as BrainRound, (fx) => log.push(fx)), { initialProps: first })
  return { log, next: (r: Fake) => hook.rerender(r) }
}

const result = (over: Partial<TrialResult>): TrialResult => ({ correct: true, accuracy: 1, timedOut: false, void: false, practice: false, kind: 'counted', points: 10, livesLost: 0, levelBefore: 5, levelAfter: 5.1, ...over })

describe('useBrainFx — new board events', () => {
  it('a wave board sounds once per wave: no reveal, no per-cell flash, nothing in the blank', () => {
    const waves = (done: number) => ({ progress: { kind: 'waves' as const, done, total: 3 } })
    const i = 'idle' as const
    const l = 'lit' as const
    const { log, next } = run(fake(gridView([l, l, i, i, i, i, i, i, i], waves(1))))
    next(fake(gridView([i, i, i, i, i, i, i, i, i], waves(1))))
    next(fake(gridView([i, i, l, l, i, i, i, i, i], waves(2))))
    next(fake(gridView([i, i, i, i, i, i, i, i, i], waves(2))))
    next(fake(gridView([i, i, i, i, l, l, i, i, i], waves(3))))
    expect(log).toEqual([
      { kind: 'wave', index: 0, total: 3 },
      { kind: 'wave', index: 1, total: 3 },
      { kind: 'wave', index: 2, total: 3 },
    ])
  })

  it('a plain memorise board still sends its reveal', () => {
    const { log } = run(fake(gridView(['lit', 'lit', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle'])))
    expect(log).toEqual([{ kind: 'reveal' }])
  })

  it('a right «없음» sends its own event just before the correct', () => {
    const board = (tone?: CellTone) => gridView(Array(9).fill('idle'), { locked: false, prompt: { key: 'play.findOdd' }, extra: { key: 'play.noneOdd', index: 9, ...(tone ? { tone } : {}) } })
    const { log, next } = run(fake(board(), { gameId: 'oddOneOut' }))
    next(fake(board('correct'), { gameId: 'oddOneOut', result: result({}) }))
    expect(log.map((f) => f.kind)).toEqual(['noneCorrect', 'correct'])
  })

  it('a right find on a board with «없음» is a plain correct', () => {
    const tones: CellTone[] = Array(9).fill('idle')
    const board = (t: CellTone[]) => gridView(t, { locked: false, extra: { key: 'play.noneOdd', index: 9 } })
    const { log, next } = run(fake(board(tones), { gameId: 'oddOneOut' }))
    next(fake(board(tones.map((t, k) => (k === 4 ? 'correct' : t))), { gameId: 'oddOneOut', result: result({}) }))
    // (The cell's own 'hit' comes too, as on every board; the sound drops it under the verdict.)
    expect(log.map((f) => f.kind)).toContain('correct')
    expect(log.map((f) => f.kind)).not.toContain('noneCorrect')
  })

  it('Number Hunt: a boxed number is the second series; a wrong tap starts the run over', () => {
    const board = (tones: CellTone[], lives: number) => ({
      ...gridView(tones, { locked: false, prompt: { key: 'play.tapAlternate', params: { lives } } }),
      cells: tones.map((tone, k): CellView => ({ tone, label: String(k), ...(k % 2 ? { ink: 'amber', boxed: true } : {}) })),
    })
    const i = 'idle' as const
    const d = 'done' as const
    const w = 'wrong' as const
    const { log, next } = run(fake(board([i, i, i, i, i, i, i, i, i], 3), { gameId: 'schulte' }))
    next(fake(board([d, i, i, i, i, i, i, i, i], 3), { gameId: 'schulte' }))
    next(fake(board([d, d, i, i, i, i, i, i, i], 3), { gameId: 'schulte' }))
    next(fake(board([d, d, i, i, w, i, i, i, i], 2), { gameId: 'schulte' }))
    next(fake(board([d, d, d, i, i, i, i, i, i], 2), { gameId: 'schulte' }))
    const hits = log.filter((f): f is Extract<BrainFx, { kind: 'hit' }> => f.kind === 'hit')
    expect(hits.map((h) => [h.cell, h.step, h.alt === true])).toEqual([
      [0, 1, false],
      [1, 2, true],
      [2, 1, false],
    ])
  })
})
