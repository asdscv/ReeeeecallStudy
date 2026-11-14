import { describe, expect, it } from 'vitest'
import { BRAIN_GAMES, DEFAULT_CONTEXT, EXTREME_LEVELS, brainGame, createRng, type RoundView } from '@reeeeecall/shared/lib/brain-games'
import type { MemoryGridState } from '@reeeeecall/shared/lib/brain-games/games/memory-grid'
import type { SequenceState } from '@reeeeecall/shared/lib/brain-games/games/sequence'
import type { SchulteState } from '@reeeeecall/shared/lib/brain-games/games/schulte'
import type { MakeNumberState } from '@reeeeecall/shared/lib/brain-games/games/make-number'
import { evaluate } from '@reeeeecall/shared/lib/brain-games/games/make-number'

const screens = [{ maxCols: 3, maxRows: 4 }, { maxCols: 5, maxRows: 7 }, { maxCols: 7, maxRows: 7 }]

for (const game of BRAIN_GAMES) {
  describe(`${game.id}: foundation and extreme range`, () => {
    it('has an untimed foundation and twenty progressively timed extreme levels on each screen', () => {
      for (const screen of screens) {
        const ctx = { ...DEFAULT_CONTEXT, ...screen }
        const max = game.def.maxLevel!(ctx)
        const low = game.def.create(1, createRng(1), ctx)
        const first = game.def.create(max - EXTREME_LEVELS + 1, createRng(2), ctx)
        const high = game.def.create(max, createRng(3), ctx)
        expect(game.def.timeLimitMs(low)).toBeNull()
        expect(game.def.view(low).difficulty).toBe('foundation')
        expect(game.def.view(first).difficulty).toBe('extreme')
        expect(game.def.view(high).difficulty).toBe('extreme')
        expect(game.def.timeLimitMs(high)).toBeGreaterThanOrEqual(200)
        expect(game.def.timeLimitMs(high)).toBeLessThan(game.def.timeLimitMs(first)!)
        expect(game.def.timeLimitMs(JSON.parse(JSON.stringify(high)))).toBe(game.def.timeLimitMs(high))
      }
    })

    it('keeps a valid, playable answer at both extremes, using the real public controls', () => {
      for (const screen of screens) {
        const ctx = { ...DEFAULT_CONTEXT, ...screen }
        for (const level of [1, game.def.maxLevel!(ctx)! - EXTREME_LEVELS + 1, game.def.maxLevel!(ctx)!]) {
          for (let seed = 1; seed <= 3; seed++) {
            let s = game.def.create(level, createRng(seed * 7919), ctx)
            const limit = game.def.timeLimitMs(s)
            const view: RoundView = game.def.view(s)
            if (view.kind === 'grid') expect(view.cells).toHaveLength(view.cols * view.rows)
            for (let guard = 0; guard < 3000 && !game.def.outcome(s); guard++) {
              if (game.def.pendingMs(s) !== null) s = game.def.advance(s)
              else {
                const next = game.def.solution(s)
                expect(next?.length, `${game.id} L${level}`).toBeGreaterThan(0)
                s = game.def.tap(s, next![0])
              }
              expect(game.def.timeLimitMs(s)).toBe(limit)
            }
            expect(game.def.outcome(s), `${game.id} L${level} seed ${seed}`).toMatchObject({ correct: true })
          }
        }
      }
    })
  })
}

it('grows memory and arithmetic load while preserving flash-onset safety and a mathematical witness', () => {
  const ctx = { ...DEFAULT_CONTEXT, maxCols: 5, maxRows: 7 }
  const top = (id: 'sequence' | 'memoryGrid' | 'schulte' | 'makeNumber') => {
    const def = brainGame(id).def
    return def.create(def.maxLevel!(ctx), createRng(17), ctx)
  }
  const seq = top('sequence') as SequenceState
  expect(seq.seq).toHaveLength(64)
  expect(seq.flashMs + seq.gapMs).toBeGreaterThanOrEqual(340)
  expect(seq.seq.every((x) => x >= 0 && x < seq.n * seq.n)).toBe(true)
  expect(seq.seq.every((x, i) => i === 0 || x !== seq.seq[i - 1])).toBe(true)
  const grid = top('memoryGrid') as MemoryGridState
  expect(grid.targets.length).toBeGreaterThanOrEqual(17)
  expect(grid.showMs + grid.gapMs).toBeGreaterThanOrEqual(340)
  const hunt = top('schulte') as SchulteState
  expect(hunt.mode).toBe('memory')
  expect(hunt.values).toHaveLength(35)
  expect(hunt.previewMs).toBe(400)
  const number = top('makeNumber') as MakeNumberState
  expect(number.tiles).toHaveLength(6)
  expect(evaluate(number.witness)).toEqual({ n: number.target, d: 1 })
  expect(number.witness.flatMap((t) => t.kind === 'num' ? [t.tile] : []).sort()).toEqual([0, 1, 2, 3, 4, 5])
})

it('an extreme cannot silently enable a blocked rule', () => {
  const ctx = { ...DEFAULT_CONTEXT, blockRules: ['schulte.memory', 'codeBreak.repeats', 'sequence.reverse', 'makeNumber.square', 'mazeRun.hidden', 'mazeRun.keys', 'setMatch.color', 'setMatch.fill', 'setMatch.none'] }
  for (const id of ['schulte', 'codeBreak', 'sequence', 'makeNumber', 'mazeRun', 'setMatch'] as const) {
    const def = brainGame(id).def
    const s = def.create(def.maxLevel!(ctx), createRng(12), ctx)
    expect(def.mechanics(s).filter((tag) => ctx.blockRules.includes(tag)), id).toEqual([])
  }
})

it('the gentle span steps really show one, two, three, then four items without a gap', () => {
  const ctx = { ...DEFAULT_CONTEXT, maxCols: 5, maxRows: 7 }
  for (const id of ['memoryGrid', 'sequence'] as const) {
    const def = brainGame(id).def
    const counts = [1, 4 / 3, 5 / 3, 2].map((lv) => {
      const state = def.create(lv, createRng(4), ctx)
      return id === 'sequence' ? (state as SequenceState).seq.length : (state as MemoryGridState).targets.length
    })
    expect(counts).toEqual([1, 2, 3, 4])
    expect([1, 4 / 3, 5 / 3, 2].map((lv) => def.spanLength!(lv, ctx))).toEqual(counts)
  }
})
