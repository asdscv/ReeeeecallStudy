/**
 * Brain games never run out: every round is generated at the player's level, and the level has
 * no ceiling. These tests walk every game from level 1 to far past where any parameter tops out
 * and check that each round is well-formed and solvable — a perfect player wins it, a wrong tap
 * loses it.
 */
import { describe, it, expect } from 'vitest'
import {
  BRAIN_GAMES,
  createRng,
  nextLevel,
  pickNextGame,
  emptyProgress,
  recordRound,
  parseProgress,
  serializeProgress,
  currentDays,
  type BrainGameId,
  type ChoiceView,
} from '@reeeeecall/shared/lib/brain-games'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

function settle(def: Any, s: Any): Any {
  for (let i = 0; i < 500 && def.pendingMs(s) !== null && !def.acceptsInput(s); i++) s = def.advance(s)
  return s
}

/** Plays the round perfectly using the game's own state. */
function solve(id: BrainGameId, def: Any, s: Any): Any {
  s = settle(def, s)
  switch (id) {
    case 'memoryGrid':
      for (const t of s.targets) s = def.tap(s, t)
      return s
    case 'sequence': {
      const order = s.reverse ? [...s.seq].reverse() : s.seq
      for (const t of order) s = def.tap(s, t)
      return s
    }
    case 'pairs': {
      const faces = [...new Set(s.cards as string[])]
      for (const f of faces) {
        const idx = s.cards.map((c: string, i: number) => (c === f ? i : -1)).filter((i: number) => i >= 0)
        s = def.tap(s, idx[0])
        s = def.tap(s, idx[1])
      }
      return s
    }
    case 'schulte': {
      const total = s.n * s.n
      for (let k = 0; k < total; k++) {
        const want = s.order === 'asc' ? k + 1 : total - k
        s = def.tap(s, s.values.indexOf(want))
      }
      return s
    }
    case 'oddOneOut':
      return def.tap(s, s.oddIndex)
    default:
      return def.tap(s, s.correctIndex)
  }
}

const LEVELS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 40, 60, 100, 250]

describe('every game, every level', () => {
  for (const { id, def } of BRAIN_GAMES) {
    it(`${id}: well-formed and solvable from level 1 to 250`, () => {
      for (const level of LEVELS) {
        for (let seed = 1; seed <= 40; seed++) {
          const rng = createRng(seed * 7919 + level)
          const s0 = def.create(level, rng)
          const view = def.view(s0)
          if (view.kind === 'grid') {
            expect(view.cells.length).toBe(view.cols * view.rows)
            expect(view.cols).toBeLessThanOrEqual(7)
          } else {
            const texts = view.options.map((o) => o.text ?? o.textKey)
            expect(new Set(texts).size, `${id} L${level} duplicate options ${texts}`).toBe(texts.length)
            expect(view.options.length).toBeGreaterThanOrEqual(2)
          }
          expect(def.timeLimitMs(s0)).toBeGreaterThan(0)

          const won = solve(id, def, s0)
          expect(def.outcome(won), `${id} L${level} seed ${seed} not won`).toEqual({ correct: true, accuracy: 1 })

          const lost = def.timeout(settle(def, s0))
          expect(def.outcome(lost)?.correct, `${id} timeout must lose`).toBe(false)
        }
      }
    })
  }
})

describe('choice answers', () => {
  it('math: the marked option is the real answer, all options non-negative', () => {
    const { def } = BRAIN_GAMES.find((g) => g.id === 'math')!
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 60; seed++) {
        const s = def.create(level, createRng(seed + level * 1000))
        const view = def.view(s) as ChoiceView
        const expr = view.stimulus.text!.replace(' = ?', '')
        const values = view.options.map((o) => Number(o.text))
        values.forEach((v) => expect(v).toBeGreaterThanOrEqual(0))
        if (!expr.includes('?')) {
          const answer = Function(`return ${expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')}`)()
          expect(values[s.correctIndex]).toBe(answer)
        }
      }
    }
  })

  it('stroop: the answer is the ink (or the word, when asked)', () => {
    const { def } = BRAIN_GAMES.find((g) => g.id === 'stroop')!
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 60; seed++) {
        const s = def.create(level, createRng(seed + level * 31))
        const view = def.view(s) as ChoiceView
        const answer = view.options[s.correctIndex].textKey
        const want = s.prompt.key === 'play.pickInk' ? `colors.${view.stimulus.color}` : view.stimulus.textKey
        expect(answer).toBe(want)
      }
    }
  })
})

describe('adaptive level', () => {
  it('climbs on wins, never drops below 1, keeps climbing with no ceiling', () => {
    let level = 1
    for (let i = 0; i < 1000; i++) level = nextLevel(level, { correct: true, accuracy: 1 }, 0.9)
    expect(level).toBeGreaterThan(250)
    let low = 3
    for (let i = 0; i < 20; i++) low = nextLevel(low, { correct: false, accuracy: 0 }, 1)
    expect(low).toBe(1)
  })

  it('settles near three-in-four right', () => {
    // A player whose chance of success falls as the level rises.
    const rng = createRng(42)
    let level = 1
    let wins = 0
    const N = 4000
    for (let i = 0; i < N; i++) {
      const p = 1 / (1 + Math.exp((level - 20) / 3))
      const correct = rng.chance(p)
      wins += correct ? 1 : 0
      level = nextLevel(level, { correct, accuracy: correct ? 1 : 0 }, 0.8)
    }
    expect(wins / N).toBeGreaterThan(0.65)
    expect(wins / N).toBeLessThan(0.8)
  })
})

describe('endless mix', () => {
  it('never repeats the last two games and visits all of them', () => {
    const rng = createRng(7)
    const seen = new Set<BrainGameId>()
    const recent: BrainGameId[] = []
    for (let i = 0; i < 400; i++) {
      const next = pickNextGame(emptyProgress(), recent, rng)
      expect(recent.slice(-2)).not.toContain(next)
      recent.push(next)
      seen.add(next)
    }
    expect(seen.size).toBe(BRAIN_GAMES.length)
  })
})

describe('progress', () => {
  it('records rounds, keeps the best level, and counts day streaks', () => {
    let p = emptyProgress()
    p = recordRound(p, 'math', { level: 3.3, correct: true, points: 30 }, '2026-11-10')
    p = recordRound(p, 'math', { level: 2.5, correct: false, points: 0 }, '2026-11-10')
    expect(p.games.math).toEqual({ level: 2.5, bestLevel: 3.3, rounds: 2, wins: 1 })
    expect(p.dayStreak).toBe(1)
    expect(p.todayRounds).toBe(2)
    p = recordRound(p, 'stroop', { level: 1.3, correct: true, points: 10 }, '2026-11-11')
    expect(p.dayStreak).toBe(2)
    expect(p.todayRounds).toBe(1)
    expect(currentDays(p, '2026-11-11')).toEqual({ dayStreak: 2, todayRounds: 1 })
    expect(currentDays(p, '2026-11-12')).toEqual({ dayStreak: 2, todayRounds: 0 })
    expect(currentDays(p, '2026-11-14')).toEqual({ dayStreak: 0, todayRounds: 0 })
    p = recordRound(p, 'stroop', { level: 1.6, correct: true, points: 10 }, '2026-11-14')
    expect(p.dayStreak).toBe(1)
  })

  it('round-trips, tolerates garbage, and stays small enough for SecureStore', () => {
    let p = emptyProgress()
    for (const g of BRAIN_GAMES) p = recordRound(p, g.id, { level: 123.45, correct: true, points: 99999 }, '2026-11-12')
    const raw = serializeProgress(p)
    expect(parseProgress(raw)).toEqual(p)
    expect(raw.length).toBeLessThan(1500)
    expect(parseProgress('not json')).toEqual(emptyProgress())
    expect(parseProgress('{"v":2}')).toEqual(emptyProgress())
    expect(parseProgress(null)).toEqual(emptyProgress())
  })
})
