/**
 * Code Break (숫자 야구) against the owner's bar for the new games («새로운 게임은 처음부터 내
 * 피드백 수준으로 만들어라»): level 1 easy and inviting, a capable adult at real challenge within a
 * few codes, every level a harder code (more digits or a bigger pool, or fewer guesses), a new size
 * or rule starting small again, both ways on the staircase, a top that even a sharp adult loses,
 * real thinking on every code, untimed for older players — and a short round (a code is a whole
 * puzzle). The ladder itself is pinned in brain-new-games.test.ts; this file plays it.
 *
 * Players here are MODELLED, not measured people (as .audit/brain-sim.ts): a persona takes in each
 * answer with a probability that falls with the code's length, and every guess it types is a code
 * the answers it took in still allow, picked at random. They play the real engine through its keys.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DEFAULT_CONTEXT,
  SKILL,
  brainGame,
  buildDemo,
  createRng,
  emptyHistory,
  emptyMeta,
  emptyProgress,
  maxColsFor,
  nextSd,
  placementDone,
  placementHandover,
  placementLevel,
  roundEstimate,
  startFromEstimate,
  startPlacement,
  stepLevel,
  stepMultiplier,
  updatePlacement,
  zestPlan,
  type CodeBreakView,
  type CreateContext,
  type Rng,
} from '@reeeeecall/shared/lib/brain-games'
import {
  CODE_BREAK_LADDER,
  CODE_BREAK_MAX_LEVEL,
  CODE_BREAK_ROUND_CAP,
  codeBreak,
  codeBreakBand,
  codeBreakNarrowed,
  codeSpace,
  codesFitting,
  packCode,
  scoreGuess,
  unpackCode,
  type CodeBreakState,
} from '@reeeeecall/shared/lib/brain-games/games/code-break'
import { useBrainRound } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'

const PHONE: CreateContext = { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 }
const BLOCKED: CreateContext = { ...PHONE, blockRules: ['codeBreak.repeats'] }
const bands = Array.from({ length: CODE_BREAK_MAX_LEVEL }, (_, i) => i + 1)
const make = (level: number, seed: number, ctx: CreateContext = PHONE) => codeBreak.create(level, createRng(seed * 7919 + Math.round(level * 100)), ctx) as CodeBreakState
const view = (s: CodeBreakState) => codeBreak.view(s) as CodeBreakView

/** Types a guess on the keypad and submits it, as a player does (the keys' own indices). */
function play(s: CodeBreakState, guess: readonly number[]): CodeBreakState {
  for (const d of guess) s = codeBreak.tap(s, view(s).keys.find((k) => k.digit === d)!.index)
  return codeBreak.tap(s, view(s).submit.index)
}

/** The plainest possible scorer: strikes by position, common digits by multiset, balls = common − strikes. */
function reference(code: readonly number[], guess: readonly number[]): { strikes: number; balls: number } {
  const strikes = code.filter((d, i) => guess[i] === d).length
  const left = [...code]
  let common = 0
  for (const d of guess) {
    const at = left.indexOf(d)
    if (at >= 0) {
      common++
      left.splice(at, 1)
    }
  }
  return { strikes, balls: common - strikes }
}

/** Every code of a band, by brute force. */
function every(b: { length: number; pool: readonly number[]; repeats: boolean }): number[][] {
  let out: number[][] = [[]]
  for (let i = 0; i < b.length; i++) out = out.flatMap((p) => b.pool.filter((d) => b.repeats || !p.includes(d)).map((d) => [...p, d]))
  return out
}

function randomCode(s: Pick<CodeBreakState, 'length' | 'pool' | 'repeats'>, rng: Rng): number[] {
  return s.repeats ? Array.from({ length: s.length }, () => rng.pick(s.pool)) : rng.sample(s.pool, s.length)
}

// ── personas ────────────────────────────────────────────────────────────────────────────────

interface Persona {
  name: string
  /** Each answer is taken in with probability keep^(length − 1): longer codes are harder to reason about. */
  keep: number
}
const SHARP: Persona = { name: '30대 빠른 성인', keep: 0.9 }
const SLOW75: Persona = { name: '느린 75세', keep: 0.5 }

/** One code played by a persona through the real keys; the engine's own outcome. */
function personaPlays(p: Persona, level: number, seed: number, ctx: CreateContext) {
  const rng = createRng(seed)
  let s = make(level, seed, ctx)
  const take = p.keep ** (s.length - 1)
  let belief: number[] | null = null
  while (!codeBreak.outcome(s)) {
    const guess = belief === null ? randomCode(s, rng) : unpackCode(belief[rng.int(0, belief.length - 1)], s.length)
    s = play(s, guess)
    const last = s.guesses[s.guesses.length - 1]
    if (rng.next() < take) {
      belief =
        belief === null
          ? codesFitting(s, [last])
          : belief.filter((c) => {
              const r = reference(unpackCode(c, s.length), last.digits)
              return r.strikes === last.strikes && r.balls === last.balls
            })
    }
  }
  return codeBreak.outcome(s)!
}

/** A persona's share of codes solved at a band (placement plays repeats bands blocked). */
function solveRate(p: Persona, level: number, n: number, ctx: CreateContext = PHONE): number {
  let ok = 0
  for (let i = 1; i <= n; i++) if (personaPlays(p, level, i * 104729 + level, ctx).correct) ok++
  return ok / n
}

describe('the ladder, band by band', () => {
  it('level 1 is small and inviting: two digits from 1-4 (12 codes) in 8 guesses — even the slow persona solves nearly every one', () => {
    expect(codeSpace(CODE_BREAK_LADDER[0])).toBe(12)
    expect(solveRate(SLOW75, 1, 120)).toBeGreaterThanOrEqual(0.97)
  })

  it('every step is a harder code — more possible codes without a guess more, or a guess fewer — except where a new size or rule starts again with guesses given back', () => {
    const lines: string[] = []
    for (const b of bands.slice(1)) {
      const [was, now] = [CODE_BREAK_LADDER[b - 2], CODE_BREAK_LADDER[b - 1]]
      const harder = codeSpace(now) >= codeSpace(was) && now.maxGuesses <= was.maxGuesses && (codeSpace(now) > codeSpace(was) || now.maxGuesses < was.maxGuesses)
      const restart = now.length > was.length || (now.repeats && !was.repeats)
      lines.push(`L${b} ${harder ? 'harder' : restart ? 'restart' : 'SAME'}`)
      expect(harder || restart, `L${b - 1} → L${b}`).toBe(true)
      // A restart is small: more guesses than the band before, or far fewer codes (repeats from 3 of 1-5).
      if (!harder) expect(now.maxGuesses > was.maxGuesses || codeSpace(now) * 10 < codeSpace(was), `L${b} restart`).toBe(true)
    }
    // Restarts: three digits (L4), four (L8), repeats (L13, a card), four with repeats (L15), five (L19).
    expect(lines.filter((l) => l.endsWith('restart'))).toEqual(['L4 restart', 'L8 restart', 'L13 restart', 'L15 restart', 'L19 restart'])
  })

  it('sampled codes per band: the pool, the length, distinct digits unless repeats, uniformly spread over places and digits', () => {
    for (const b of [1, 4, 7, 8, 12, 13, 16, 18, 21]) {
      const row = codeBreakBand(b)
      const counts = new Map<string, number>()
      const n = 400
      for (let seed = 1; seed <= n; seed++) {
        const s = make(b, seed)
        expect(s.secret).toHaveLength(row.length)
        if (!row.repeats) expect(new Set(s.secret).size).toBe(row.length)
        s.secret.forEach((d, i) => counts.set(`${i}:${d}`, (counts.get(`${i}:${d}`) ?? 0) + 1))
      }
      // Every digit of the pool turns up in every place, none more than twice as often as fair.
      const fair = n / row.pool.length
      for (let i = 0; i < row.length; i++) {
        for (const d of row.pool) {
          const c = counts.get(`${i}:${d}`) ?? 0
          expect(c, `L${b} place ${i} digit ${d}`).toBeGreaterThan(fair * 0.4)
          expect(c, `L${b} place ${i} digit ${d}`).toBeLessThan(fair * 2)
        }
      }
    }
  })

  it('untimed at every level (a thinking game for older players): the budget is guesses, never a clock', () => {
    for (const b of bands) expect(codeBreak.timeLimitMs(make(b, 1))).toBeNull()
  })

  it('a blocked repeats rule (placement) plays distinct digits from 0-9 at the same length and guesses — near the band, not back at L4', () => {
    for (const b of [13, 14, 15, 16]) {
      const own = CODE_BREAK_LADDER[b - 1]
      const s = make(b, 3, BLOCKED)
      expect([s.length, s.maxGuesses, s.repeats, s.pool]).toEqual([own.length, own.maxGuesses, false, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]])
      expect(codeBreak.mechanics(s)).not.toContain('codeBreak.repeats')
      expect(codeSpace(s), `L${b}`).toBeGreaterThanOrEqual(codeSpace(own))
    }
  })
})

describe('the rules of play', () => {
  it('strikes and balls are exact: scoreGuess agrees with a brute-force count on 20 000 random pairs, repeats included', () => {
    const rng = createRng(42)
    for (let i = 0; i < 20000; i++) {
      const row = CODE_BREAK_LADDER[rng.int(0, CODE_BREAK_LADDER.length - 1)]
      const code = randomCode(row, rng)
      // Guesses may repeat digits even when the code does not: the scorer must still be right.
      const guess = Array.from({ length: row.length }, () => rng.pick(row.pool))
      expect(scoreGuess(code, guess), `${code} / ${guess}`).toEqual(reference(code, guess))
    }
  })

  it('after every answer the trial keeps exactly the codes all the answers allow — the code always among them', () => {
    for (const b of [1, 3, 5, 8, 13, 14, 15]) {
      const all = every(CODE_BREAK_LADDER[b - 1])
      for (let seed = 1; seed <= 6; seed++) {
        const rng = createRng(seed * 31 + b)
        let s = make(b, seed)
        while (!codeBreak.outcome(s)) {
          s = play(s, randomCode(s, rng))
          const brute = all.filter((c) => s.guesses.every((g) => {
            const r = reference(c, g.digits)
            return r.strikes === g.strikes && r.balls === g.balls
          })).map(packCode)
          expect([...s.fits!].sort((x, y) => x - y), `L${b} seed ${seed} after ${s.guesses.length}`).toEqual(brute.sort((x, y) => x - y))
          expect(s.fits).toContain(packCode(s.secret))
        }
      }
    }
  })

  it('a solved code is right; out of guesses is a miss whose accuracy is how far the answers narrowed the code', () => {
    const s0 = make(12, 4)
    const won = play(play(s0, s0.secret.map((d) => (d + 1) % 10).reverse()), s0.secret)
    expect(codeBreak.outcome(won)).toMatchObject({ correct: true, accuracy: 1, guesses: 2 })
    expect(view(won)).toMatchObject({ solved: true, secret: s0.secret, locked: true })
    expect(codeBreak.solution(won)).toBeNull()

    // Out of guesses (L12, 4 of 0-9): a player who uses every answer but never quite types the code
    // ends with one or two codes left; one who types the same four wrong digits eight times has
    // ruled out only those digits (360 of 5040 codes left).
    let careful = make(12, 9)
    const secret = packCode(careful.secret)
    const rng = createRng(5)
    while (!codeBreak.outcome(careful)) {
      const others = careful.fits?.filter((c) => c !== secret) ?? []
      const guess = careful.fits === null ? [...careful.secret.slice(1), careful.secret[0]] : others.length ? unpackCode(others[rng.int(0, others.length - 1)], 4) : careful.guesses[0].digits
      careful = play(careful, guess)
    }
    let stubborn = make(12, 9)
    const wrong = stubborn.pool.filter((d) => !stubborn.secret.includes(d)).slice(0, 4)
    while (!codeBreak.outcome(stubborn)) stubborn = play(stubborn, wrong)
    const [c, w] = [codeBreak.outcome(careful)!, codeBreak.outcome(stubborn)!]
    expect([c.correct, w.correct, c.guesses, w.guesses]).toEqual([false, false, 8, 8])
    expect([c.accuracy, w.accuracy]).toEqual([codeBreakNarrowed(careful), codeBreakNarrowed(stubborn)])
    expect(careful.fits!.length).toBeLessThanOrEqual(2)
    expect(c.accuracy).toBeGreaterThan(0.9)
    expect(stubborn.fits).toHaveLength(360)
    expect(w.accuracy).toBe(0.31)
    // So the careful miss drops the level far less (rules.ts: drop × (1 − accuracy / 2)).
    const drop = (acc: number) => 12 - stepLevel('speed', 12, false, acc, 2)
    expect(drop(c.accuracy)).toBeLessThan(drop(w.accuracy) * 0.7)
  })

  it('the keypad never takes a digit twice when digits are distinct, nor more digits than the code; notes are never judged', () => {
    let s = make(8, 2)
    s = codeBreak.tap(s, 0)
    expect(codeBreak.tap(s, 0)).toBe(s)
    for (const k of view(s).keys.slice(1, 4)) s = codeBreak.tap(s, k.index)
    expect(view(s).keys.every((k) => k.disabled)).toBe(true)
    expect(codeBreak.tap(s, view(s).keys[5].index)).toBe(s)
    const noted = codeBreak.tap(s, view(s).notes[2].index)
    expect(codeBreak.outcome(noted)).toBeNull()
    expect(noted.guesses).toEqual(s.guesses)
    // Repeats bands take a digit again.
    let r = make(15, 2)
    r = codeBreak.tap(codeBreak.tap(r, 0), 0)
    expect(r.entry).toEqual([r.pool[0], r.pool[0]])
  })
})

describe('the demo player (solution()) plays a real strategy', () => {
  it('every guess fits every answer before it — a consistent-candidate strategy, no peeking until the last allowed guess', () => {
    for (const b of bands) {
      for (let seed = 1; seed <= 6; seed++) {
        let s = make(b, seed)
        while (!codeBreak.outcome(s)) {
          const lastChance = s.maxGuesses - s.guesses.length === 1
          const guess = s.plan
          if (!lastChance) {
            for (const g of s.guesses) expect(reference(guess, g.digits), `L${b} seed ${seed}`).toEqual({ strikes: g.strikes, balls: g.balls })
          }
          s = play(s, guess)
        }
        expect(codeBreak.outcome(s)!.correct).toBe(true)
      }
    }
  })

  it('without its answer key it is near the best known play — and still loses at the top (six guesses for four of 0-9; five digits in six)', () => {
    /** Guesses the strategy needs on its own (no last-guess key: the budget raised out of reach). */
    const alone = (b: number, seed: number) => {
      let s = { ...make(b, seed), maxGuesses: 40 }
      while (!codeBreak.outcome(s)) s = play(s, s.plan)
      return s.guesses.length
    }
    const stats = (b: number, n: number) => {
      const g = Array.from({ length: n }, (_, i) => alone(b, i + 1))
      return { mean: g.reduce((a, x) => a + x, 0) / n, within: g.filter((x) => x <= CODE_BREAK_LADDER[b - 1].maxGuesses).length / n }
    }
    // Classic 4 of 0-9: the best possible average is 5.21 guesses (Koyama & Lai 1993).
    const l12 = stats(12, 120)
    expect(l12.mean).toBeLessThan(5.6)
    expect(l12.within).toBe(1)
    const l18 = stats(18, 150)
    expect(l18.within).toBeLessThan(0.99)
    const l21 = stats(21, 80)
    expect(l21.within).toBeLessThan(0.9)
  })

  it('the how-to-play demo shows a strike, a ball and the code found, in three guesses', () => {
    const frames = buildDemo('codeBreak')
    const last = frames[frames.length - 1].view as CodeBreakView
    expect(last.solved).toBe(true)
    expect(last.guesses.length).toBe(3)
    expect(last.guesses.some((g) => g.strikes > 0 && g.strikes < last.length)).toBe(true)
    expect(last.guesses.some((g) => g.balls > 0)).toBe(true)
  })
})

describe('personas on the real staircase (modelled players)', () => {
  /**
   * A first play as useBrainRound runs it: two practice codes at L1 (no level change), then ZEST
   * placement (Code Break's plan: three or four codes, the first at L3, hot after one right, unseen
   * rules blocked), then three rounds of at most five counted codes on the 85% staircase with
   * Code Break's doubled steps — the persona playing every code through the keys.
   */
  function journey(p: Persona, seed: number) {
    const plan = zestPlan('codeBreak')
    let place = startPlacement({ lo: 1, hi: plan.hi, mu0: 3, sigma0: 9, target: 0.85, slope: 2, maxMove: 3, minTrials: plan.minTrials, maxTrials: plan.maxTrials, tailMass: plan.tailMass, hotMove: plan.hotMove, hotAfter: plan.hotAfter })
    const placement: number[] = []
    let n = 0
    while (!placementDone(place)) {
      const x = placement.length === 0 ? 3 : placementLevel(place)
      placement.push(x)
      place = updatePlacement(place, x, personaPlays(p, x, seed * 1000 + n++, BLOCKED).correct, 0.02)
    }
    const handover = placementHandover(place, plan.handoverK)
    let level = Math.min(CODE_BREAK_MAX_LEVEL, handover.level)
    let sd = Math.max(SKILL.speed.floor, Math.min(SKILL.speed.sd0, handover.sd))
    const steps = brainGame('codeBreak').steps!
    const counted: { level: number; correct: boolean }[] = []
    for (let round = 0; round < 3; round++) {
      let lives = 3
      let trials = 0
      let right = 0
      let lastDir = 0
      let upRun = 0
      const reversals: number[] = []
      while (trials < CODE_BREAK_ROUND_CAP && lives > 0) {
        const out = personaPlays(p, level, seed * 1000 + n++, PHONE)
        counted.push({ level, correct: out.correct })
        trials++
        if (out.correct) right++
        else lives--
        const dir = out.correct ? 1 : -1
        if (lastDir !== 0 && dir !== lastDir) reversals.push(level)
        upRun = out.correct ? upRun + 1 : 0
        const k = stepMultiplier('speed', sd, steps.kMax) * steps.scale
        level = Math.min(CODE_BREAK_MAX_LEVEL, stepLevel('speed', level, out.correct, out.accuracy, k))
        sd = nextSd('speed', sd, lastDir !== 0 && dir !== lastDir, upRun)
        lastDir = dir
      }
      const mu = roundEstimate(reversals) ?? level
      level = startFromEstimate('speed', mu, sd, { momentum: trials === CODE_BREAK_ROUND_CAP && right / trials >= 0.9 })
    }
    return { placement, handover: handover.level, counted }
  }

  // The sharp persona's own solve rate per band, as placement plays it (repeats blocked) — what
  // «real challenge» (≤ 90%: a code they miss one time in ten or more) and «trivial» (≥ 97%) mean for them.
  const sharpRate = new Map<number, number>()
  const rate = (level: number) => {
    const b = Math.floor(level)
    if (!sharpRate.has(b)) sharpRate.set(b, solveRate(SHARP, b, 100, BLOCKED))
    return sharpRate.get(b)!
  }

  it('the sharp persona meets real challenge within the first four codes after practice, is handed over high, and never sits through a run of trivial codes', () => {
    const runs = Array.from({ length: 40 }, (_, i) => journey(SHARP, i + 1))
    for (const r of runs) expect(r.placement[0]).toBe(3)
    const after = (r: ReturnType<typeof journey>) => [...r.placement, ...r.counted.map((c) => c.level)]
    const reached = runs.filter((r) => after(r).slice(0, 4).some((x) => rate(x) <= 0.9)).length
    expect(reached / runs.length).toBeGreaterThanOrEqual(0.85)
    // One unlucky miss in a short placement must not hand them back to easy codes (placement.ts handoverK 0).
    expect(runs.filter((r) => r.handover >= 7).length / runs.length).toBeGreaterThanOrEqual(0.85)
    const trivial = runs.reduce((a, r) => a + after(r).slice(0, 10).filter((x) => rate(x) >= 0.97).length, 0) / runs.length
    expect(trivial).toBeLessThanOrEqual(3)
  })

  it('the top is genuinely hard: the sharp persona loses most five-digit codes in six guesses, and many four-digit ones in six', () => {
    expect(solveRate(SHARP, 21, 60)).toBeLessThan(0.4)
    expect(solveRate(SHARP, 18, 60)).toBeLessThan(0.65)
  })

  it('the slow 75-year-old starts easy, is handed over low, and stays near 80% right over three rounds', () => {
    const runs = Array.from({ length: 40 }, (_, i) => journey(SLOW75, i + 101))
    for (const r of runs) expect(r.placement[0]).toBe(3)
    const handover = runs.reduce((a, r) => a + r.handover, 0) / runs.length
    expect(handover).toBeLessThan(4.5)
    const all = runs.flatMap((r) => r.counted)
    const accuracy = all.filter((c) => c.correct).length / all.length
    expect(accuracy).toBeGreaterThan(0.7)
    expect(accuracy).toBeLessThan(0.93)
    // Never pushed into content they cannot do: nobody is past four-digit codes.
    expect(Math.max(...all.map((c) => c.level))).toBeLessThan(8)
  })
})

describe('a round is short: five codes, each a different one', () => {
  const TODAY = Math.floor(new Date('2026-11-12T10:00:00').getTime() / 86_400_000)
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-12T10:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('the catalogue caps a Code Break round at five codes; the round hook ends there, cleared, and never repeats a code', () => {
    expect(brainGame('codeBreak').roundCap).toBe(5)
    expect(brainGame('math').roundCap).toBeUndefined()
    const p = emptyProgress()
    useBrainStore.setState({
      progress: { ...p, practiced: ['codeBreak'], games: { codeBreak: { level: 5, bestLevel: 5, rounds: 3, wins: 2 } } },
      meta: { ...emptyMeta(), sk: { codeBreak: { mu: 5, sd: 1, n: 3, day: TODAY } } },
      history: emptyHistory(),
      storageKey: 'test',
    })
    const { result } = renderHook(() => useBrainRound('codeBreak', { maxCols: 5 }))
    expect(result.current.roundCap).toBe(5)
    const codes: string[] = []
    for (let guard = 0; guard < 4000 && !result.current.over; guard++) {
      if (result.current.intro) {
        act(() => result.current.ackIntro())
        continue
      }
      const v = result.current.view as CodeBreakView
      if (result.current.result && v.secret && codes[codes.length - 1] !== `${result.current.trialId}:${v.secret.join('')}`) codes.push(`${result.current.trialId}:${v.secret.join('')}`)
      const taps = result.current.solution
      if (taps && taps.length) act(() => result.current.tap(taps[0]))
      else act(() => { vi.advanceTimersByTime(200) })
    }
    expect(result.current.stats.endedBy).toBe('cap')
    expect(result.current.stats.trials).toBe(5)
    expect(result.current.stats.cleared).toBe(true)
    const secrets = codes.map((c) => c.split(':')[1])
    expect(secrets).toHaveLength(5)
    expect(new Set(secrets).size).toBe(5)
  })
})

it('the same secret stays a repeat when the available digit pool changes', () => {
  const def = brainGame('codeBreak').def
  const s = def.create(5, createRng(19), DEFAULT_CONTEXT)
  expect(def.signature({ ...s, pool: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] })).toBe(def.signature(s))
})
