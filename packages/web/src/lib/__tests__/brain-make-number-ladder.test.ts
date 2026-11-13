import { describe, expect, it } from 'vitest'
import { createRng, DEFAULT_CONTEXT, type MakeNumberView } from '@reeeeecall/shared/lib/brain-games'
import { evaluate, MAKE_NUMBER_MAX_LEVEL, makeNumber } from '@reeeeecall/shared/lib/brain-games/games/make-number'

describe('Make the Number: editing and recovery', () => {
  it('an unfinished or wrong expression can be undone, cleared and solved at every level', () => {
    for (let level = 1; level <= MAKE_NUMBER_MAX_LEVEL; level++) {
      for (let seed = 1; seed <= 8; seed++) {
        let s = makeNumber.create(level, createRng(level * 7919 + seed), DEFAULT_CONTEXT)
        const first = makeNumber.view(s) as MakeNumberView
        const tile = first.tiles.find((t) => !t.disabled)
        if (tile) s = makeNumber.tap(s, tile.index)
        let view = makeNumber.view(s) as MakeNumberView
        const op = view.ops.find((o) => !o.disabled && o.op !== ')')
        if (op) s = makeNumber.tap(s, op.index)
        view = makeNumber.view(s) as MakeNumberView
        // Incomplete input cannot be judged, and editing spends no tries.
        if (view.submit.disabled) expect(makeNumber.tap(s, view.submit.index)).toBe(s)
        expect(s.triesLeft).toBe(first.tries.total)
        if (!view.undo.disabled) s = makeNumber.tap(s, view.undo.index)
        for (let guard = 0; guard < 100 && !makeNumber.outcome(s); guard++) {
          const next = makeNumber.solution(s)
          expect(next?.length, `L${level}`).toBeGreaterThan(0)
          s = makeNumber.tap(s, next![0])
        }
        expect(makeNumber.outcome(s), `L${level} seed ${seed}`).toMatchObject({ correct: true, mistakes: 0 })
        expect(makeNumber.tap(s, 0)).toBe(s)
      }
    }
  })

  it('no tile can be reused or placed out of order, including equal-valued tiles', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = makeNumber.create(10, createRng(seed), DEFAULT_CONTEXT)
      s = makeNumber.tap(s, 0)
      expect(makeNumber.tap(s, 1)).toBe(s)
      const v = makeNumber.view(s) as MakeNumberView
      s = makeNumber.tap(s, v.ops.find((o) => o.op === '+')!.index)
      expect(makeNumber.tap(s, 0)).toBe(s)
      s = makeNumber.tap(s, 1)
      expect(s.expr.filter((t) => t.kind === 'num')).toHaveLength(2)
    }
  })

  it('an answer built through the public buttons retains exact rational values until submission', () => {
    let fractions = 0
    for (let seed = 1; seed <= 80; seed++) {
      let s = makeNumber.create(21, createRng(seed), DEFAULT_CONTEXT)
      for (const tap of makeNumber.solution(s)!.slice(0, -1)) s = makeNumber.tap(s, tap)
      expect(evaluate(s.expr)).toEqual({ n: s.target, d: 1 })
      if (s.kind === 'fraction') fractions++
      s = makeNumber.tap(s, (makeNumber.view(s) as MakeNumberView).submit.index)
      expect(makeNumber.outcome(s)?.correct).toBe(true)
    }
    expect(fractions).toBe(80)
  })
})
