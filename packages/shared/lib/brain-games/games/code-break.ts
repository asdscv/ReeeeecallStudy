import type { BrainGameDef, CodeBreakGuess, CodeBreakView } from '../types'
import { createRng, type Rng } from '../rng'

/**
 * Code Break (숫자 야구) — deduce a secret code from strike/ball feedback: a strike is a right digit
 * in the right place, a ball a right digit in the wrong place. Untimed (a thinking game for older
 * players); the budget is guesses. A trial is one whole code, so a round is short (catalog
 * `roundCap`: five codes) and the staircase takes doubled steps (catalog `steps`).
 *
 * The ladder — more digits, a bigger pool, fewer guesses; repeats start small again with a card:
 *   L1-3   2 digits from 1-4 / 1-5 / 1-6, 8 / 7 / 6 guesses (12 / 20 / 30 codes)
 *   L4-7   3 digits from 1-5 … 1-9 (the classic 숫자 야구 at L7), 8 → 7 guesses
 *   L8-12  4 digits from 1-6 … 0-9 (classic Bulls & Cows at L12), 8 guesses
 *   L13-16 digits may repeat (rule): 3 from 1-5, 3 from 1-6, 4 from 1-6, 4 from 1-8 in 7 guesses
 *   L17-18 4 from 0-9 in 7 then 6 guesses (6 is below the best possible worst case, 7: even a
 *          perfect player sometimes runs out — the top is meant to be lost sometimes)
 *   L19-21 5 digits from 0-9 in 8 / 7 / 6 guesses
 *
 * What a trial keeps besides the code: every code still possible after the answers so far (`fits`,
 * packed as decimal numbers — at most 30 240 of them, for five digits from 0-9). It drives the
 * demo player (solution()) and how close a miss came (outcome().accuracy).
 */

export interface CodeBreakBand {
  length: number
  pool: readonly number[]
  maxGuesses: number
  repeats: boolean
}

const digits = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const row = (length: number, from: number, to: number, maxGuesses: number, repeats = false): CodeBreakBand => ({ length, pool: digits(from, to), maxGuesses, repeats })

/** Band b is CODE_BREAK_LADDER[b − 1]. */
export const CODE_BREAK_LADDER: readonly CodeBreakBand[] = [
  row(2, 1, 4, 8),
  row(2, 1, 5, 7),
  row(2, 1, 6, 6),
  row(3, 1, 5, 8),
  row(3, 1, 6, 7),
  row(3, 1, 7, 7),
  row(3, 1, 9, 7),
  row(4, 1, 6, 8),
  row(4, 1, 7, 8),
  row(4, 1, 8, 8),
  row(4, 1, 9, 8),
  row(4, 0, 9, 8),
  row(3, 1, 5, 8, true),
  row(3, 1, 6, 7, true),
  row(4, 1, 6, 8, true),
  row(4, 1, 8, 7, true),
  row(4, 0, 9, 7),
  row(4, 0, 9, 6),
  row(5, 0, 9, 8),
  row(5, 0, 9, 7),
  row(5, 0, 9, 6),
]

export const CODE_BREAK_MAX_LEVEL = CODE_BREAK_LADDER.length

/** Codes in a round (catalog `roundCap`): a code is a minute or more, so five make a round. */
export const CODE_BREAK_ROUND_CAP = 5

/**
 * The ladder's band for a level. While the repeats rule is blocked (placement, or a round that may
 * not show its card yet), a repeats band plays distinct digits from 0-9 at the same length and
 * guesses — near that band's own difficulty (3 of 0-9 in 8 guesses is 720 codes), where distinct
 * digits from its own small pool (3 of 1-5: 60 codes) would be L4's puzzle and tell placement
 * nothing about L13.
 */
export function codeBreakBand(level: number, blockRules: readonly string[] = []): CodeBreakBand & { band: number } {
  const lv = Number.isFinite(level) ? Math.min(CODE_BREAK_MAX_LEVEL, Math.max(1, level)) : 1
  const b = Math.min(CODE_BREAK_MAX_LEVEL, Math.floor(lv))
  const r = CODE_BREAK_LADDER[b - 1]
  if (r.repeats && blockRules.includes('codeBreak.repeats')) return { ...r, pool: digits(0, 9), repeats: false, band: b }
  return { ...r, band: b }
}

/** Strikes and balls for a guess against the code (repeats scored as Mastermind: each digit matched once). */
export function scoreGuess(code: readonly number[], guess: readonly number[]): { strikes: number; balls: number } {
  let strikes = 0
  const left = new Map<number, number>()
  const want = new Map<number, number>()
  for (let i = 0; i < code.length; i++) {
    if (guess[i] === code[i]) strikes++
    else {
      left.set(code[i], (left.get(code[i]) ?? 0) + 1)
      want.set(guess[i], (want.get(guess[i]) ?? 0) + 1)
    }
  }
  let balls = 0
  for (const [d, n] of want) balls += Math.min(n, left.get(d) ?? 0)
  return { strikes, balls }
}

type Shape = Pick<CodeBreakBand, 'length' | 'pool' | 'repeats'>

/** The number of possible codes. */
export function codeSpace(b: Shape): number {
  if (b.repeats) return b.pool.length ** b.length
  let n = 1
  for (let i = 0; i < b.length; i++) n *= b.pool.length - i
  return n
}

/** A code as one decimal number, digits in order (the length is known, so a leading 0 is kept). */
export function packCode(code: readonly number[]): number {
  let n = 0
  for (const d of code) n = n * 10 + d
  return n
}

export function unpackCode(n: number, length: number): number[] {
  const out = new Array<number>(length)
  for (let i = length - 1; i >= 0; i--) {
    const d = n % 10
    out[i] = d
    n = (n - d) / 10
  }
  return out
}

/** An answer as one number: strikes · 10 + balls. */
const answerKey = (a: { strikes: number; balls: number }) => a.strikes * 10 + a.balls

/**
 * A fast scorer for one guess against packed codes — the same answers as scoreGuess (Mastermind:
 * common digits counted with multiplicity, less the strikes), without allocating per code.
 */
function scorer(guess: readonly number[], repeats: boolean): (code: number) => number {
  const len = guess.length
  if (!repeats) {
    let mask = 0
    for (const d of guess) mask |= 1 << d
    return (code) => {
      let strikes = 0
      let seen = 0
      for (let i = len - 1; i >= 0; i--) {
        const d = code % 10
        code = (code - d) / 10
        if (d === guess[i]) strikes++
        seen |= 1 << d
      }
      let common = 0
      for (let m = seen & mask; m; m &= m - 1) common++
      return strikes * 10 + common - strikes
    }
  }
  const want = new Array<number>(10).fill(0)
  for (const d of guess) want[d]++
  const have = new Array<number>(10).fill(0)
  return (code) => {
    have.fill(0)
    let strikes = 0
    for (let i = len - 1; i >= 0; i--) {
      const d = code % 10
      code = (code - d) / 10
      if (d === guess[i]) strikes++
      have[d]++
    }
    let common = 0
    for (let d = 0; d < 10; d++) if (want[d] && have[d]) common += Math.min(want[d], have[d])
    return strikes * 10 + common - strikes
  }
}

/** Every code of a shape that `keep` allows, packed, in pool order. */
function codesWhere(b: Shape, keep: (code: number) => boolean): number[] {
  const out: number[] = []
  const used = new Array<boolean>(10).fill(false)
  const walk = (depth: number, prefix: number) => {
    if (depth === b.length) {
      if (keep(prefix)) out.push(prefix)
      return
    }
    for (const d of b.pool) {
      if (!b.repeats && used[d]) continue
      used[d] = true
      walk(depth + 1, prefix * 10 + d)
      used[d] = false
    }
  }
  walk(0, 0)
  return out
}

/** Every code of a shape that gives these answers to these guesses, packed, in pool order. */
export function codesFitting(b: Shape, guesses: readonly CodeBreakGuess[]): number[] {
  const tests = guesses.map((g) => ({ score: scorer(g.digits, b.repeats), key: answerKey(g) }))
  return codesWhere(b, (code) => tests.every((t) => t.score(code) === t.key))
}

export interface CodeBreakState {
  secret: number[]
  length: number
  pool: readonly number[]
  repeats: boolean
  maxGuesses: number
  guesses: CodeBreakGuess[]
  entry: number[]
  crossed: number[]
  /** How many codes the trial could have been. */
  space: number
  /** The codes every answer so far allows (packed; the secret always among them); null before the first answer — every code. */
  fits: readonly number[] | null
  /** Seeds the demo player's choices, so solution() is the same for the same state. */
  seed: number
  /** The guess the demo player plays next ([] once the trial is over). */
  plan: number[]
  band: number
}

function solved(s: CodeBreakState): boolean {
  return s.guesses.some((g) => g.strikes === s.length)
}

function over(s: CodeBreakState): boolean {
  return solved(s) || s.guesses.length >= s.maxGuesses
}

/** Guesses the demo player weighs per turn, and the possible codes it weighs them against. */
const SPLIT_TRIES = 24
const SPLIT_TARGETS = 300

/**
 * The demo player (solution()) — a consistent-candidate strategy, as a careful person plays: every
 * guess is a code the answers so far still allow. Of up to 24 such codes it plays the one that splits
 * the still-possible codes into the smallest groups (least expected codes left — Knuth-style, over a
 * sample of at most 300). The opening is any code. On the last guess it plays the code itself:
 * solution() is the answer key, as for every game, and 6 guesses for 4 digits of 0-9 is below
 * what a perfect player can always manage.
 */
function nextPlan(s: Pick<CodeBreakState, 'secret' | 'length' | 'pool' | 'repeats' | 'maxGuesses' | 'guesses' | 'fits' | 'seed'>): number[] {
  if (s.maxGuesses - s.guesses.length <= 1) return [...s.secret]
  const rng = createRng(s.seed + s.guesses.length * 7919)
  if (s.fits === null) return s.repeats ? Array.from({ length: s.length }, () => rng.pick(s.pool)) : rng.sample(s.pool, s.length)
  if (s.fits.length <= 2) return unpackCode(s.fits[0], s.length)
  return unpackCode(bestSplit(s.fits, s.length, s.repeats, rng), s.length)
}

function draw(codes: readonly number[], n: number, rng: Rng): readonly number[] {
  if (codes.length <= n) return codes
  return Array.from({ length: n }, () => codes[rng.int(0, codes.length - 1)])
}

function bestSplit(fits: readonly number[], length: number, repeats: boolean, rng: Rng): number {
  const tries = draw(fits, SPLIT_TRIES, rng)
  const targets = draw(fits, SPLIT_TARGETS, rng)
  const groups = new Array<number>(56)
  let best = tries[0]
  let bestCost = Infinity
  for (const t of tries) {
    const score = scorer(unpackCode(t, length), repeats)
    groups.fill(0)
    for (const c of targets) groups[score(c)]++
    let cost = 0
    for (const n of groups) cost += n * n
    if (cost < bestCost) {
      bestCost = cost
      best = t
    }
  }
  return best
}

/**
 * How far a trial's answers narrowed the code down: log(codes / codes still possible) ÷ log(codes),
 * 0 (nothing ruled out) to 1 (only the code left). An optimal player has it at 1 within the
 * guesses (the top bands excepted); repeating a guess or ignoring an answer leaves it low. A miss
 * reports it as its accuracy, so one that came close drops the level less.
 */
export function codeBreakNarrowed(s: Pick<CodeBreakState, 'space' | 'fits'>): number {
  const left = Math.max(1, s.fits?.length ?? s.space)
  if (s.space <= 1) return 1
  return Math.round((1 - Math.log(left) / Math.log(s.space)) * 100) / 100
}

const index = {
  del: (s: Pick<CodeBreakState, 'pool'>) => s.pool.length,
  submit: (s: Pick<CodeBreakState, 'pool'>) => s.pool.length + 1,
  note: (s: Pick<CodeBreakState, 'pool'>, i: number) => s.pool.length + 2 + i,
}

function keyDisabled(s: CodeBreakState, digit: number): boolean {
  return s.entry.length >= s.length || (!s.repeats && s.entry.includes(digit))
}

export const codeBreak: BrainGameDef<CodeBreakState> = {
  id: 'codeBreak',
  create(level, rng: Rng, ctx) {
    const b = codeBreakBand(level, ctx.blockRules ?? [])
    const secret = b.repeats ? Array.from({ length: b.length }, () => rng.pick(b.pool)) : rng.sample(b.pool, b.length)
    const base = {
      secret,
      length: b.length,
      pool: b.pool,
      repeats: b.repeats,
      maxGuesses: b.maxGuesses,
      guesses: [],
      entry: [],
      crossed: [],
      space: codeSpace(b),
      fits: null,
      seed: rng.int(1, 0x7fffffff),
      band: b.band,
    }
    return { ...base, plan: nextPlan(base) }
  },
  pendingMs: () => null,
  advance: (s) => s,
  acceptsInput: (s) => !over(s),
  tap(s, i) {
    if (over(s) || !Number.isInteger(i)) return s
    const p = s.pool.length
    if (i >= 0 && i < p) {
      const digit = s.pool[i]
      return keyDisabled(s, digit) ? s : { ...s, entry: [...s.entry, digit] }
    }
    if (i === index.del(s)) return s.entry.length === 0 ? s : { ...s, entry: s.entry.slice(0, -1) }
    if (i === index.submit(s)) {
      if (s.entry.length !== s.length) return s
      const guess: CodeBreakGuess = { digits: s.entry, ...scoreGuess(s.secret, s.entry) }
      const score = scorer(guess.digits, s.repeats)
      const key = answerKey(guess)
      const fits = s.fits === null ? codesWhere(s, (c) => score(c) === key) : s.fits.filter((c) => score(c) === key)
      const next = { ...s, guesses: [...s.guesses, guess], entry: [], fits }
      return { ...next, plan: over(next) ? [] : nextPlan(next) }
    }
    if (i >= index.note(s, 0) && i < index.note(s, p)) {
      const digit = s.pool[i - index.note(s, 0)]
      return { ...s, crossed: s.crossed.includes(digit) ? s.crossed.filter((d) => d !== digit) : [...s.crossed, digit].sort((a, b) => a - b) }
    }
    return s
  },
  timeout: (s) => s,
  outcome(s) {
    if (!over(s)) return null
    if (solved(s)) return { correct: true, accuracy: 1, guesses: s.guesses.length }
    // Out of guesses: how close the answers came (codeBreakNarrowed) softens the drop.
    return { correct: false, accuracy: codeBreakNarrowed(s), guesses: s.guesses.length }
  },
  timeLimitMs: () => null,
  view(s): CodeBreakView {
    const done = over(s)
    const view: CodeBreakView = {
      kind: 'codeBreak',
      // `count` = guesses left (plural keys play.codeBreakGuess_one/_other).
      prompt: { key: 'play.codeBreakGuess', params: { length: s.length, count: Math.max(0, s.maxGuesses - s.guesses.length) } },
      length: s.length,
      pool: [...s.pool],
      repeats: s.repeats,
      guesses: s.guesses.map((g) => ({ ...g, digits: [...g.digits] })),
      maxGuesses: s.maxGuesses,
      entry: [...s.entry],
      keys: s.pool.map((digit, i) => ({ digit, index: i, disabled: done || keyDisabled(s, digit) })),
      del: { index: index.del(s), disabled: done || s.entry.length === 0 },
      submit: { index: index.submit(s), disabled: done || s.entry.length !== s.length },
      notes: s.pool.map((digit, i) => ({ digit, index: index.note(s, i), crossed: s.crossed.includes(digit) })),
      locked: done,
    }
    if (done) {
      view.secret = [...s.secret]
      view.solved = solved(s)
    }
    return view
  },
  signature: (s) => `cb:${s.pool[0]}-${s.pool[s.pool.length - 1]}:${s.repeats ? 'r' : ''}${s.secret.join('')}`,
  solution(s) {
    if (over(s)) return null
    const plan = s.plan
    const keep = s.entry.every((d, i) => plan[i] === d) ? s.entry.length : 0
    const taps: number[] = []
    for (let i = keep; i < s.entry.length; i++) taps.push(index.del(s))
    for (let i = keep; i < plan.length; i++) taps.push(s.pool.indexOf(plan[i]))
    taps.push(index.submit(s))
    return taps
  },
  mechanics(s) {
    const tags: string[] = []
    if (s.length === 3) tags.push('codeBreak.three')
    if (s.length === 4) tags.push('codeBreak.four')
    if (s.length === 5) tags.push('codeBreak.five')
    if (s.pool.includes(0)) tags.push('codeBreak.zero')
    if (s.repeats) tags.push('codeBreak.repeats')
    return tags
  },
  maxLevel: () => CODE_BREAK_MAX_LEVEL,
  trialInfo: (s) => ({ kind: `b${s.band}` }),
}
