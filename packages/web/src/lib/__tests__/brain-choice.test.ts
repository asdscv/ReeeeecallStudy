/**
 * The shared pieces the pick-one-answer games build on: near-miss numeric options (answer position
 * drawn first, distractors fitted round it), the choice state machine's pass-throughs, its lead
 * phase and late reveal, and the band mix for banded games (Quick Math, Number Pattern).
 */
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_CONTEXT, createRng, type ChoiceView, type CreateContext, type RecentTrial } from '@reeeeecall/shared/lib/brain-games'
import { choiceGame, nearMissOptions, type ChoiceState } from '@reeeeecall/shared/lib/brain-games/games/choice'
import { pickBand } from '@reeeeecall/shared/lib/brain-games/games/bands'

// Thousands of sampled trials per test: a second or three here, several times that on a CI runner,
// where the 5s default would time out.
vi.setConfig({ testTimeout: 30_000 })

const within = (answer: number) => Math.max(answer * 0.2, 20)

function checkOptions(answer: number, options: number[], correctIndex: number, traps: number[] = []) {
  expect(options[correctIndex]).toBe(answer)
  expect(new Set(options).size).toBe(options.length)
  for (let i = 1; i < options.length; i++) expect(options[i]).toBeGreaterThan(options[i - 1])
  for (const v of options) {
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
    if (!traps.includes(v)) expect(Math.abs(v - answer), `${v} for ${answer}`).toBeLessThanOrEqual(within(answer))
  }
}

describe('nearMissOptions', () => {
  it('four distinct non-negative integers, ascending, the answer marked, all within ±max(20%, 20)', () => {
    const rng = createRng(1)
    for (const answer of [0, 1, 2, 3, 5, 9, 10, 17, 34, 56, 99, 100, 346, 1203, 9876, 54321]) {
      for (let i = 0; i < 200; i++) {
        const errors = [{ v: answer + 10 }, { v: answer - 1 }, { v: answer * 3 }]
        const { options, correctIndex } = nearMissOptions(answer, errors, rng)
        expect(options).toHaveLength(4)
        checkOptions(answer, options, correctIndex)
      }
    }
  })

  it("the answer's position is uniform where every position is possible, and only feasible ones otherwise", () => {
    for (const answer of [7, 15, 48, 85, 403, 2750]) {
      const rng = createRng(answer)
      const at = [0, 0, 0, 0]
      const N = 4000
      for (let i = 0; i < N; i++) at[nearMissOptions(answer, [{ v: answer + 1 }, { v: answer - 10 }], rng).correctIndex]++
      for (const n of at) expect(Math.abs(n / N - 0.25), `${answer}: ${at}`).toBeLessThan(0.03)
    }
    // 0 has nothing below it; 1 has one value; 2 has two.
    const rng = createRng(2)
    const seen = (answer: number) => new Set(Array.from({ length: 400 }, () => nearMissOptions(answer, [], rng).correctIndex))
    expect([...seen(0)]).toEqual([0])
    expect([...seen(1)].sort()).toEqual([0, 1])
    expect([...seen(2)].sort()).toEqual([0, 1, 2])
    expect([...seen(3)].sort()).toEqual([0, 1, 2, 3])
  })

  it('uses the given errors first, drops ones out of range, and always offers a trap however far off', () => {
    const rng = createRng(3)
    for (let i = 0; i < 500; i++) {
      // 6 + 4 × 7 = 34: left to right gives 70 (a trap, far above), a slipped carry 44.
      const { options, correctIndex } = nearMissOptions(34, [{ v: 70, trap: true }, { v: 44 }, { v: 340 }], rng)
      checkOptions(34, options, correctIndex, [70])
      expect(options).toContain(70)
      expect(options).not.toContain(340)
      // The trap takes one place above; the slipped carry fits whenever there are two.
      if (correctIndex <= 1) expect(options).toContain(44)
    }
    // A trap below a small answer still fits (it takes a place below).
    for (let i = 0; i < 200; i++) {
      const { options, correctIndex } = nearMissOptions(12, [{ v: 2, trap: true }], rng)
      checkOptions(12, options, correctIndex, [2])
      expect(options).toContain(2)
      expect(correctIndex).toBeGreaterThanOrEqual(1)
    }
  })

  it('sameUnits: at least two distractors end in the answer’s units digit', () => {
    const rng = createRng(4)
    for (const answer of [50, 57, 85, 123, 346, 999, 1203, 50317]) {
      for (let i = 0; i < 300; i++) {
        // Errors that all end in another digit: the fill is swapped, and errors too if need be.
        const { options, correctIndex } = nearMissOptions(answer, [{ v: answer + 1 }, { v: answer - 1 }, { v: answer + 3 }], rng, { sameUnits: true })
        checkOptions(answer, options, correctIndex)
        const same = options.filter((v, j) => j !== correctIndex && v % 10 === answer % 10)
        expect(same.length, `${answer}: ${options}`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('another option count works, and corrupt answers fall back without hanging', () => {
    const rng = createRng(5)
    const three = nearMissOptions(40, [], rng, { count: 3 })
    expect(three.options).toHaveLength(3)
    checkOptions(40, three.options, three.correctIndex)
    for (const bad of [Number.NaN, -5, 2.5, Infinity]) {
      const { options, correctIndex } = nearMissOptions(bad, [{ v: 3 }], rng)
      expect(options.length).toBeGreaterThanOrEqual(2)
      expect(Object.is(options[correctIndex], bad)).toBe(true)
    }
  })
})

describe('choiceGame', () => {
  const base = (over: Partial<ChoiceState> = {}): ChoiceState => ({
    prompt: { key: 'play.solve' },
    stimulus: { tokens: [6, '+', 4, '×', 7], terms: [1, 2, null, 4], cue: 'word', frame: 'blue', reveal: { lines: ['6 + 28 = 34'], highlight: [2, 4] } },
    options: [{ value: 28, text: '28' }, { value: 34, text: '34' }, { value: 44, text: '44', color: 'orange' }, { value: 70, text: '70' }],
    correctIndex: 1,
    limitMs: 9000,
    picked: null,
    timedOut: false,
    sig: 'x',
    info: { kind: 'b13', carry: 'orange' },
    ...over,
  })
  const game = (over: Partial<ChoiceState> = {}) => choiceGame('math', () => base(over), { maxLevel: 41 })

  it('passes tokens, terms, cue, frame and option value/colour through; the reveal only once answered', () => {
    const def = game()
    const s = def.create(13, createRng(1), DEFAULT_CONTEXT)
    const before = def.view(s) as ChoiceView
    expect(before.stimulus).toMatchObject({ tokens: [6, '+', 4, '×', 7], terms: [1, 2, null, 4], cue: 'word', frame: 'blue' })
    expect(before.stimulus.reveal).toBeUndefined()
    expect(before.stimulus.hidden).toBeUndefined()
    expect(before.options[2]).toEqual({ value: 44, text: '44', color: 'orange' })
    expect(def.trialInfo?.(s)).toEqual({ kind: 'b13', carry: 'orange' })
    expect(def.maxLevel?.(DEFAULT_CONTEXT)).toBe(41)
    const after = def.view(def.tap(s, 0)) as ChoiceView
    expect(after.stimulus.reveal).toEqual({ lines: ['6 + 28 = 34'], highlight: [2, 4] })
    expect(after).toMatchObject({ picked: 0, correctIndex: 1 })
    // The reveal may also ride on the state; a timeout shows it too.
    const own = game({ stimulus: { text: '1 + 1' }, reveal: { gaps: ['+1'] } })
    const t = own.timeout(own.create(1, createRng(1), DEFAULT_CONTEXT))
    expect((own.view(t) as ChoiceView).stimulus.reveal).toEqual({ gaps: ['+1'] })
    expect(own.outcome(t)).toEqual({ correct: false, accuracy: 0 })
  })

  it('leadMs: the cue first (word hidden, no input, nothing asked), then the answer phase', () => {
    const def = game({ leadMs: 600 })
    let s = def.create(16, createRng(1), DEFAULT_CONTEXT)
    expect(def.pendingMs(s)).toBe(600)
    expect(def.acceptsInput(s)).toBe(false)
    expect(def.solution(s)).toBeNull()
    expect((def.view(s) as ChoiceView).stimulus).toMatchObject({ hidden: true, cue: 'word' })
    expect(def.tap(s, 1)).toEqual(s)
    s = def.advance(s)
    expect(def.pendingMs(s)).toBeNull()
    expect(def.acceptsInput(s)).toBe(true)
    expect((def.view(s) as ChoiceView).stimulus.hidden).toBeUndefined()
    expect(def.solution(s)).toEqual([1])
    expect(def.outcome(def.tap(s, 1))).toEqual({ correct: true, accuracy: 1 })
    // No lead: straight to the answer, as before.
    const plain = game({ leadMs: 0 })
    const p = plain.create(1, createRng(1), DEFAULT_CONTEXT)
    expect(plain.pendingMs(p)).toBeNull()
    expect(plain.acceptsInput(p)).toBe(true)
  })
})

describe('pickBand', () => {
  const ctx = (over: Partial<CreateContext> = {}) => ({ ...DEFAULT_CONTEXT, ...over })
  const rec = (level: number, band: number): RecentTrial => ({ level, kind: `b${band}` })

  /** A round's worth of trials at one level, each seeing the two before it. */
  function chain(level: number, n: number, seed: number, opts: Parameters<typeof pickBand>[3] = { bands: 41 }) {
    const rng = createRng(seed)
    const out: number[] = []
    let recent: RecentTrial[] = []
    for (let i = 0; i < n; i++) {
      const band = pickBand(level, rng, ctx({ recent }), opts)
      out.push(band)
      recent = [...recent, rec(level, band)].slice(-2)
    }
    return out
  }
  const shares = (xs: number[], bands: number[]) => bands.map((b) => xs.filter((x) => x === b).length / xs.length)

  it('55/25/12/8 over the current band and three below, renormalised near the bottom, never older', () => {
    for (const level of [1, 2, 3, 4, 7.6, 13, 25, 41, 60]) {
      const drawn = chain(level, 20000, Math.round(level * 10))
      const cur = Math.min(41, Math.floor(level))
      for (const b of drawn) {
        expect(b).toBeLessThanOrEqual(cur)
        expect(b).toBeGreaterThanOrEqual(Math.max(1, cur - 3))
      }
      const s = shares(drawn, [cur, cur - 1, cur - 2, cur - 3])
      if (cur === 1) expect(s[0]).toBe(1)
      // L2 at most two in three (never three in a row), L3 its renormalised weights.
      if (cur === 2) expect(s[0]).toBeCloseTo(0.67, 1)
      if (cur === 3) [0.598, 0.272, 0.13].forEach((w, i) => expect(Math.abs(s[i] - w), `L3 ${s}`).toBeLessThan(0.02))
      if (cur >= 4) [0.55, 0.25, 0.12, 0.08].forEach((w, i) => expect(Math.abs(s[i] - w), `L${level} ${s}`).toBeLessThan(0.02))
    }
  })

  it('never the same band three times in a row', () => {
    for (const level of [2, 3, 5, 18, 33]) {
      const drawn = chain(level, 5000, level)
      for (let i = 2; i < drawn.length; i++) expect(drawn[i] === drawn[i - 1] && drawn[i] === drawn[i - 2], `L${level} at ${i}`).toBe(false)
    }
  })

  it('a trial on its own (no recent trials) draws the plain weights', () => {
    const rng = createRng(7)
    const drawn = Array.from({ length: 20000 }, () => pickBand(10, rng, ctx(), { bands: 41 }))
    ;[0.55, 0.25, 0.12, 0.08].forEach((w, i) => expect(Math.abs(shares(drawn, [10, 9, 8, 7])[i] - w)).toBeLessThan(0.02))
  })

  it('placement, and the first trial after crossing into a new level, use the current band', () => {
    const rng = createRng(8)
    for (let i = 0; i < 500; i++) {
      expect(pickBand(12.4, rng, ctx({ trialKind: 'placement', recent: [rec(12, 12), rec(12, 12)] }), { bands: 41 })).toBe(12)
      expect(pickBand(12.1, rng, ctx({ recent: [rec(11.2, 10), rec(11.9, 11)] }), { bands: 41 })).toBe(12)
    }
    // Moving within a level, or down, mixes as usual.
    const mixed = new Set(Array.from({ length: 300 }, () => pickBand(12.6, rng, ctx({ recent: [rec(12.1, 11), rec(12.3, 9)] }), { bands: 41 })))
    expect(mixed.size).toBeGreaterThan(1)
  })

  it('a blocked band falls to the nearest unblocked band below', () => {
    const rng = createRng(9)
    const blocked = (b: number) => b === 11 || b === 13
    for (let i = 0; i < 2000; i++) {
      const b = pickBand(13.5, rng, ctx(), { bands: 41, isBlocked: blocked })
      expect([12, 10]).toContain(b)
      expect(pickBand(11, rng, ctx({ trialKind: 'placement' }), { bands: 41, isBlocked: blocked })).toBe(10)
    }
    // Falling never makes three in a row either.
    const drawn = chain(13.5, 3000, 10, { bands: 41, isBlocked: blocked })
    for (let i = 2; i < drawn.length; i++) expect(drawn[i] === drawn[i - 1] && drawn[i] === drawn[i - 2]).toBe(false)
  })

  it('bands given as start levels: a level belongs to the last band starting at or below it', () => {
    // Number Pattern: one band a level to 21, then 22–23, 24–25, 26–28.
    const starts = [...Array.from({ length: 21 }, (_, i) => i + 1), 22, 24, 26]
    const rng = createRng(11)
    expect(pickBand(23.9, rng, ctx({ trialKind: 'placement' }), { bands: starts })).toBe(22)
    expect(pickBand(28, rng, ctx({ trialKind: 'placement' }), { bands: starts })).toBe(26)
    expect(pickBand(99, rng, ctx({ trialKind: 'placement' }), { bands: starts })).toBe(26)
    const seen = new Set(Array.from({ length: 2000 }, () => pickBand(27, rng, ctx(), { bands: starts })))
    expect([...seen].sort((a, b) => a - b)).toEqual([21, 22, 24, 26])
    // Corrupt levels still give a band.
    expect(pickBand(Number.NaN, rng, ctx(), { bands: 41 })).toBe(1)
    expect(pickBand(0, rng, ctx(), { bands: 41 })).toBe(1)
  })
})
