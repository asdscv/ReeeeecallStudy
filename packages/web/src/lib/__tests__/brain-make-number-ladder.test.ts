import { describe, expect, it } from 'vitest'
import { createRng, DEFAULT_CONTEXT, type MakeNumberView } from '@reeeeecall/shared/lib/brain-games'
import { eachTree, evaluate, MAKE_NUMBER_MAX_LEVEL, makeNumber, makeNumberFractionPuzzles } from '@reeeeecall/shared/lib/brain-games/games/make-number'

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

describe('Make the Number: square operator', () => {
  it('squares a number once, before multiplication and division; it never consumes a second tile', () => {
    const n = (value: number, tile: number) => ({ kind: 'num' as const, value, tile })
    const o = (op: '²' | '+' | '×' | '(' | ')') => ({ kind: 'op' as const, op })
    expect(evaluate([n(2, 0), o('+'), n(3, 1), o('²'), o('×'), n(2, 2)])).toEqual({ n: 20, d: 1 })
    expect(evaluate([n(3, 0), o('²'), o('²')])).toBeNull()
    expect(evaluate([o('('), n(3, 0), o(')'), o('²')])).toBeNull()
    for (let seed = 1; seed <= 30; seed++) {
      let s = makeNumber.create(7, createRng(seed), DEFAULT_CONTEXT)
      expect(s.tiles).toHaveLength(2)
      expect(s.witness.some((t) => t.kind === 'op' && t.op === '²')).toBe(true)
      const square = (makeNumber.view(s) as MakeNumberView).ops.find((x) => x.op === '²')!
      s = makeNumber.tap(s, square.index)
      expect(s.expr.filter((t) => t.kind === 'num')).toHaveLength(1)
      expect(makeNumber.tap(s, square.index)).toBe(s)
      expect((makeNumber.view(s) as MakeNumberView).ops.find((x) => x.op === '²')!.disabled).toBe(true)
      s = makeNumber.tap(s, (makeNumber.view(s) as MakeNumberView).undo.index)
      expect(s.expr).toEqual([n(s.tiles[0], 0)])
      for (const tap of makeNumber.solution(s)!) s = makeNumber.tap(s, tap)
      expect(makeNumber.outcome(s)?.correct).toBe(true)
    }
  })

  it('never offers or requires an unseen blocked square rule', () => {
    for (let level = 7; level <= 21; level++) {
      const s = makeNumber.create(level, createRng(level), { ...DEFAULT_CONTEXT, blockRules: ['makeNumber.square'] })
      expect(s.ops).not.toContain('²')
      expect(s.witness.some((t) => t.kind === 'op' && t.op === '²')).toBe(false)
    }
  })
})


describe('Make the Number: mathematical difficulty', () => {
  it('square introduction targets cannot be solved with the old four operators alone', () => {
    const ops = ['+', '−', '×', '÷'] as const
    for (let level = 7; level <= 9; level++) for (let seed = 1; seed <= 15; seed++) {
      const s = makeNumber.create(level, createRng(seed), DEFAULT_CONTEXT)
      for (let choice = 0; choice < 4 ** (s.tiles.length - 1); choice++) {
        let code = choice
        const expr: typeof s.expr = []
        s.tiles.forEach((value, tile) => {
          if (tile > 0) { expr.push({ kind: 'op', op: ops[code % 4] }); code = Math.floor(code / 4) }
          expr.push({ kind: 'num', value, tile })
        })
        expect(evaluate(expr)).not.toEqual({ n: s.target, d: 1 })
      }
    }
  })

  it('every advanced puzzle still requires an intermediate fraction even when squares are available', () => {
    const puzzles = makeNumberFractionPuzzles(true)
    expect(puzzles.length).toBeGreaterThan(200)
    for (const p of puzzles) {
      let ways = 0, whole = false
      eachTree(p.tiles, { times: true, divide: true, square: true }, (t) => {
        if (t.d === 1 && t.n === p.target) { ways++; if (t.int) whole = true }
      })
      expect(ways).toBeGreaterThan(0)
      expect(whole, `${p.tiles} = ${p.target}`).toBe(false)
    }
  })
})
