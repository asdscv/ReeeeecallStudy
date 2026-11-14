/**
 * Brain games: every round is generated at the player's level, the level has no ceiling, and the
 * adaptive rules follow the research the feature cites. These tests walk every game across levels
 * and screen widths and check each round is well-formed and solvable, then pin the staircase
 * targets, the Corsi stop rule, the session plan and the course schedule — and that Quick Eye,
 * removed by the owner (2026-11-13), is gone from everything a player sees while its old saves
 * still read and round-trip.
 */
import { describe, it, expect } from 'vitest'
import {
  BRAIN_GAMES,
  DEFAULT_CONTEXT,
  GROUP_RULES,
  RETIRED_GAME_IDS,
  brainGame,
  courseStatus,
  createRng,
  emptyProgress,
  isBrainGameId,
  isSavedGameId,
  maxColsFor,
  maxRowsFor,
  parseProgress,
  planToday,
  planTodaysSession,
  recordRound,
  recordSession,
  restartLevel,
  serializeProgress,
  stepLevel,
  targetAccuracy,
  buildDemo,
  emptyHistory,
  gameHistory,
  parseHistory,
  recordHistory,
  serializeHistory,
  roundStars,
  streakTier,
  todaysPlanSeed,
  HISTORY_PER_GAME,
  weekProgress,
  weekStart,
  type ChoiceView,
  type CreateContext,
} from '@reeeeecall/shared/lib/brain-games'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

function settle(def: Any, s: Any): Any {
  for (let i = 0; i < 500 && def.pendingMs(s) !== null && !def.acceptsInput(s); i++) s = def.advance(s)
  return s
}

/** Plays a trial with nothing but the game's own `solution()` — what the how-to-play demo does. */
function playBySolution(def: Any, s: Any): Any {
  for (let guard = 0; guard < 2000 && !def.outcome(s); guard++) {
    if (def.pendingMs(s) !== null && !def.acceptsInput(s)) {
      s = def.advance(s)
      continue
    }
    const taps = def.solution(s)
    if (!taps || taps.length === 0) throw new Error('no solution while input is expected')
    s = def.tap(s, taps[0])
  }
  return s
}

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 40, 60, 120]
/** The staircase moves in fractions: every create() takes any level ≥ 1 and looks its table up itself. */
const FRACTIONAL = [1.5, 2.99, 7.3, 13.5, 25.75]
/** Desktop 7×7, a phone 5×7, a small phone 4×6, a narrow 3×5 (last life). */
const CONTEXTS: CreateContext[] = [
  DEFAULT_CONTEXT,
  { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 },
  { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 6 },
  { ...DEFAULT_CONTEXT, maxCols: 3, maxRows: 5, livesLeft: 1 },
]

describe('every game, every level, every screen', () => {
  it('the screens are what they say', () => {
    expect(CONTEXTS.map((c) => `${c.maxCols}x${c.maxRows}`)).toEqual(['7x7', '5x7', '4x6', '3x5'])
    expect([100, 300, 360, 400, 456, 600].map(maxRowsFor)).toEqual([3, 4, 5, 6, 7, 7])
  })

  for (const { id, def } of BRAIN_GAMES) {
    it(`${id}: well-formed, and following solution() always wins`, () => {
      const levels = [...LEVELS, ...FRACTIONAL]
      for (const ctx of CONTEXTS) {
        for (const level of levels) {
          for (let seed = 1; seed <= 16; seed++) {
            const c = ctx
            const s0 = def.create(level, createRng(seed * 7919 + Math.round(level * 100)), c)
            const view = def.view(s0)
            const at = `${id} L${level} ${c.maxCols}x${c.maxRows} seed ${seed}`
            if (view.kind === 'grid') {
              expect(view.cells.length, at).toBe(view.cols * view.rows)
              expect(view.cols, `${at}: wider than the screen`).toBeLessThanOrEqual(Math.max(3, Math.min(7, c.maxCols)))
              if (view.extra) expect(view.extra.index, `${at}: the extra button sits after the cells`).toBe(view.cells.length)
            } else if (view.kind === 'choice') {
              const keys = view.options.map((o) => o.text ?? o.textKey ?? String(o.value))
              expect(new Set(keys).size, `${at} duplicate options ${keys}`).toBe(keys.length)
              expect(view.options.length).toBeGreaterThanOrEqual(2)
              const values = view.options.map((o) => o.value)
              if (values.every((v) => v !== undefined)) {
                for (let i = 1; i < values.length; i++) expect(values[i]!, `${at}: numeric options ascending`).toBeGreaterThan(values[i - 1]!)
              }
              if (view.stimulus.terms) expect(view.stimulus.terms.filter((t) => t === null), `${at}: one gap`).toHaveLength(1)
              expect(view.stimulus.reveal, `${at}: the reveal waits for the answer`).toBeUndefined()
            }
            const won = playBySolution(def, s0)
            expect(def.outcome(won)?.correct, `${at} not won`).toBe(true)
            expect(def.solution(won), 'nothing is asked once the trial is over').toBeNull()
          }
        }
      }
    // Thousands of deduction/arithmetic puzzles also search candidates and square variants; 5s is too
    // short when the full suite shares a CPU with the native bundle check.
    }, id === 'codeBreak' || id === 'makeNumber' ? 20_000 : 5_000)
  }
})

describe('staircase', () => {
  it('targets 85% for speed games; speed never moves the level', () => {
    expect(targetAccuracy('speed')).toBeCloseTo(0.85, 2)
  })

  function simulate(group: 'speed', threshold: number, seed: number) {
    const rng = createRng(seed)
    const r = GROUP_RULES[group]
    let level = r.min
    let wins = 0
    const N = 6000
    for (let i = 0; i < N; i++) {
      const p = 1 / (1 + Math.exp((level - threshold) / 1.2))
      const correct = rng.chance(p)
      wins += correct ? 1 : 0
      level = stepLevel(group, level, correct, correct ? 1 : 0, i % 20)
    }
    return wins / N
  }

  it('settles near its target accuracy', () => {
    expect(Math.abs(simulate('speed', 15, 1) - 0.85)).toBeLessThan(0.04)
  })

  it('uncertainty scales both steps by k (the ratio — the target — unchanged); never below the floor', () => {
    expect(stepLevel('speed', 5, true, 1, 2)).toBeCloseTo(5.3)
    expect(stepLevel('speed', 5, true, 1)).toBeCloseTo(5.15)
    expect(stepLevel('speed', 5, false, 0, 2)).toBeCloseTo(3.3)
    expect(stepLevel('speed', 1.2, false, 0)).toBe(1)
    let level = 1
    for (let i = 0; i < 2000; i++) level = stepLevel('speed', level, true, 1)
    expect(level).toBeGreaterThan(250)
  })

  it('span games follow Corsi: up one length per success, a miss does not move the level', () => {
    expect(stepLevel('span', 4, true, 1, 0)).toBe(5)
    expect(stepLevel('span', 4, false, 0, 0)).toBe(4)
    expect(restartLevel('span', 9, 9)).toBe(7)
    expect(restartLevel('speed', 6.4, 6.4)).toBeCloseTo(5.9)
  })
})

describe('Today\'s Training plan', () => {
  it('every session is a different mix: game count, games, order and minutes vary within the chosen length', () => {
    const SLOW = ['schulte', 'pairs']
    for (const length of [5, 20] as const) {
      const shapes = new Set<string>()
      const splits = new Set<string>()
      for (let seed = 1; seed <= 80; seed++) {
        let p = emptyProgress()
        p = { ...p, sessions: { ...p.sessions, total: seed }, settings: { ...p.settings, sessionMinutes: length } }
        const { focus, slots } = planToday(p, createRng(seed * 7919))
        const ids = slots.map((s) => s.gameId)
        // Exactly the chosen length, no game twice, each slot big enough for its game.
        expect(slots.reduce((a, s) => a + s.minutes, 0)).toBe(length)
        expect(new Set(ids).size).toBe(ids.length)
        for (const s of slots) expect(s.minutes).toBeGreaterThanOrEqual(SLOW.includes(s.gameId) ? (length === 5 ? 1.5 : 3) : length === 5 ? 1 : 2.5)
        expect(ids.length).toBeGreaterThanOrEqual(length === 5 ? 2 : 3)
        expect(ids.length).toBeLessThanOrEqual(length === 5 ? 4 : 6)
        // Quick Eye is gone (owner, 2026-11-13): no game is guaranteed a place.
        expect(ids).not.toContain('quickEye')
        for (const id of ids) expect(isBrainGameId(id), id).toBe(true)
        if (focus === 'memory') expect(ids.some((id) => BRAIN_GAMES.find((g) => g.id === id)!.skill === 'memory')).toBe(true)
        shapes.add(ids.join(','))
        splits.add(slots.map((s) => s.minutes).join('/'))
      }
      expect(shapes.size).toBeGreaterThan(30)
      expect(splits.size).toBeGreaterThan(5)
    }
    expect(emptyProgress().settings.sessionMinutes).toBe(5)
  })

  it('a game left out lately comes back: over a few sessions every game turns up', () => {
    let p = emptyProgress()
    const seen = new Set<string>()
    for (let i = 0; i < 8; i++) {
      const slots = planTodaysSession(p, createRng(100 + i))
      slots.forEach((s) => seen.add(s.gameId))
      p = recordSession(p, 5, `2026-11-${String(2 + i * 2).padStart(2, '0')}`, null, slots.map((s) => s.gameId))
    }
    expect(seen.size).toBe(BRAIN_GAMES.length)
  })

  it('counts sessions by week, Monday to Sunday', () => {
    expect(weekStart('2026-11-12')).toBe('2026-11-09')
    expect(weekStart('2026-11-09')).toBe('2026-11-09')
    expect(weekStart('2026-11-15')).toBe('2026-11-09')
    let p = emptyProgress()
    for (const day of ['2026-11-06', '2026-11-09', '2026-11-11']) p = recordSession(p, 22, day, null)
    expect(weekProgress(p, '2026-11-12')).toEqual({ done: 2, goal: 3 })
  })

  it('runs a 10-session core course, then refreshers at 11 and 35 months', () => {
    let p = emptyProgress()
    // Mon/Wed/Fri from Monday 2026-01-05: the 10th session is Monday 2026-02-02.
    const days = ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14', '2026-01-16', '2026-01-19', '2026-01-21', '2026-01-23', '2026-02-02']
    for (const day of days) p = recordSession(p, 22, day, null)
    expect(p.sessions.coreDoneOn).toBe('2026-02-02')
    expect(courseStatus(p, '2026-06-01')).toMatchObject({ phase: 'maintenance', nextBoosterOn: '2027-01-02' })
    expect(courseStatus(p, '2027-01-04')).toMatchObject({ phase: 'booster', booster: { index: 1, done: 0, total: 4 } })
    for (const day of ['2027-01-04', '2027-01-06', '2027-01-08', '2027-01-11']) p = recordSession(p, 22, day, 1)
    expect(courseStatus(p, '2027-01-20')).toMatchObject({ phase: 'maintenance', nextBoosterOn: '2029-01-02' })
    expect(courseStatus(p, '2029-01-03')).toMatchObject({ phase: 'booster', booster: { index: 2 } })
  })

  it('a session past three in a week is welcome but moves the course no further (EVIDENCE §3)', () => {
    let p = emptyProgress()
    for (let i = 0; i < 10; i++) p = recordSession(p, 22, '2026-01-15', null)
    expect(p.sessions.total).toBe(10)
    expect(p.sessions.course).toBe(3)
    expect(p.sessions.coreDoneOn).toBeNull()
    expect(courseStatus(p, '2026-01-15')).toMatchObject({ phase: 'core', coreDone: 3 })
  })
})

describe('choice answers', () => {
  it('math: the marked option is the real answer, all options non-negative', () => {
    const { def } = brainGame('math')
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 60; seed++) {
        const s = def.create(Math.max(1, level), createRng(seed + level * 1000), DEFAULT_CONTEXT) as Any
        const view = def.view(s) as ChoiceView
        // Tokens when the game sends them (numbers drawn by locale), plain text otherwise.
        const written = view.stimulus.tokens ? view.stimulus.tokens.join(' ') : view.stimulus.text!
        const expr = written.replace(/\s*=\s*\?$/, '')
        const values = view.options.map((o) => o.value ?? Number(o.text))
        values.forEach((v) => expect(v).toBeGreaterThanOrEqual(0))
        if (!expr.includes('?')) {
          const answer = Function(`return ${expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')}`)()
          expect(values[s.correctIndex]).toBe(answer)
        }
      }
    }
  })

  it('stroop: the answer is the ink (or the word, when asked)', () => {
    const { def } = brainGame('stroop')
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 60; seed++) {
        const s = def.create(Math.max(1, level), createRng(seed + level * 31), DEFAULT_CONTEXT) as Any
        const view = def.view(s) as ChoiceView
        const answer = view.options[s.correctIndex].textKey
        const rule = view.stimulus.cue ?? (s.prompt.key === 'play.pickWord' ? 'word' : 'ink')
        const want = rule === 'ink' ? `colors.${view.stimulus.color}` : view.stimulus.textKey
        expect(answer).toBe(want)
      }
    }
  })
})

describe('per-game life rules', () => {
  it('Number Hunt spends a life per wrong tap, and stops at the lives left', () => {
    const def = brainGame('schulte').def as Any
    let s = def.create(3, createRng(9), { ...DEFAULT_CONTEXT, livesLeft: 2 })
    const right = def.solution(s)[0]
    const wrong = right === 0 ? 1 : 0
    s = def.tap(s, wrong)
    expect(def.outcome(s)).toBeNull()
    s = def.tap(s, wrong)
    expect(def.outcome(s)).toMatchObject({ correct: false, livesSpent: 2 })
  })

  it('Match Pairs does not count turning over unseen cards as mistakes', () => {
    const def = brainGame('pairs').def as Any
    let s = def.create(24, createRng(11), DEFAULT_CONTEXT) // the preview has tapered away by here
    s = settle(def, s)
    const a = 0
    const b = s.cards.findIndex((c: string, i: number) => i !== a && c !== s.cards[a])
    s = def.tap(def.tap(s, a), b)
    expect(s.misses).toBe(0)
  })
})

describe('migration and rotation', () => {
  it('converts v1 span levels to the new length scale', () => {
    const v1 = JSON.stringify({ v: 1, games: { memoryGrid: { level: 6, bestLevel: 9, rounds: 4, wins: 3 }, sequence: { level: 6, bestLevel: 6, rounds: 2, wins: 1 }, math: { level: 6, bestLevel: 6, rounds: 2, wins: 1 } }, totalRounds: 8, totalPoints: 0, lastDay: null, dayStreak: 0, todayRounds: 0 })
    const p = parseProgress(v1)
    expect(p.games.memoryGrid).toMatchObject({ level: 4, bestLevel: 5 }) // 3 + ⌊5·0.6⌋ = 6 cells → length 6 − 2
    expect(p.games.sequence).toMatchObject({ level: 3 }) // 3 + ⌊5·0.45⌋ = 5 tiles → 3
    // A v2 record is read as written.
    const v2 = parseProgress(serializeProgress({ ...emptyProgress(), games: { memoryGrid: { level: 6, bestLevel: 6, rounds: 1, wins: 1 } } }))
    expect(v2.games.memoryGrid?.level).toBe(6)
  })

  it('rotates by the games recent sessions used, not by trial counts', () => {
    let p = emptyProgress()
    // An old session log can still name Quick Eye: it is simply never planned again.
    p = recordSession(p, 22, '2026-11-10', null, ['quickEye' as never, 'oddOneOut', 'memoryGrid', 'pairs'])
    const justUsed = ['oddOneOut', 'memoryGrid', 'pairs']
    for (let seed = 1; seed < 30; seed++) {
      const others = planTodaysSession(p, createRng(seed)).map((s) => s.gameId)
      expect(others).not.toContain('quickEye')
      // Games the last session used give way to the ones it did not.
      expect(others.filter((id) => justUsed.includes(id)).length).toBeLessThanOrEqual(others.filter((id) => !justUsed.includes(id)).length)
    }
  })
})

describe('progress', () => {
  it('records rounds, keeps the best level, and counts day streaks', () => {
    let p = emptyProgress()
    p = recordRound(p, 'math', { level: 3.3, correct: true, points: 30 }, '2026-11-10')
    p = recordRound(p, 'math', { level: 2.5, correct: false, points: 0 }, '2026-11-10')
    expect(p.games.math).toEqual({ level: 2.5, bestLevel: 3.3, rounds: 2, wins: 1 })
    expect(p.todayRounds).toBe(2)
    p = recordRound(p, 'stroop', { level: 1.3, correct: true, points: 10 }, '2026-11-11')
    expect(p.dayStreak).toBe(2)
  })

  it('round-trips, tolerates garbage, and stays small enough for SecureStore', () => {
    let p = emptyProgress()
    for (const g of BRAIN_GAMES) p = recordRound(p, g.id, { level: 123.45, correct: true, points: 99999 }, '2026-11-12')
    for (let i = 0; i < 20; i++) p = recordSession(p, 23, `2026-11-${String(10 + (i % 18)).padStart(2, '0')}`, null)
    p = { ...p, bestRuns: Object.fromEntries(BRAIN_GAMES.map((g) => [g.id, 123456])), practiced: BRAIN_GAMES.map((g) => g.id) }
    const raw = serializeProgress(p)
    expect(parseProgress(raw)).toEqual(p)
    expect(raw.length).toBeLessThan(1800)
    expect(parseProgress('not json')).toEqual(emptyProgress())
    expect(parseProgress('{"v":2}')).toEqual(emptyProgress())
    // A corrupted level is clamped, never handed to a game as 1e308 (which hung Quick Math).
    const huge = parseProgress('{"v":1,"games":{"math":{"level":1e308}},"sessions":{}}')
    expect(huge.games.math?.level).toBeGreaterThanOrEqual(1)
    expect(huge.games.math?.level).toBeLessThanOrEqual(500)
    expect(brainGame('math').def.create(1e308, createRng(1), DEFAULT_CONTEXT)).toBeTruthy()
  })

  it("Quick Eye is removed (owner, 2026-11-13): no game, route or plan slot — an old save's record of it still reads, round-trips and stays its own", () => {
    expect(BRAIN_GAMES.some((g) => (g.id as string) === 'quickEye')).toBe(false)
    expect(isBrainGameId('quickEye')).toBe(false)
    expect(() => brainGame('quickEye' as never)).toThrow()
    expect(RETIRED_GAME_IDS).toEqual(['quickEye'])
    expect(isSavedGameId('quickEye')).toBe(true)
    expect(isSavedGameId('nope')).toBe(false)
    const old = JSON.stringify({
      v: 2,
      games: { quickEye: { level: 9, bestLevel: 10, rounds: 80, wins: 60 }, math: { level: 4, bestLevel: 5, rounds: 3, wins: 2 } },
      quickEye: { variant: 7, recentMs: [33, 50, 33], recentOk: '101', thresholdMs: 40 },
      quickEyeField: 2,
      bestRuns: { quickEye: 900, math: 300 },
      practiced: ['quickEye', 'math'],
      sessions: { recentGames: ['quickEye', 'math'] },
      settings: { centerOnly: true },
    })
    const p = parseProgress(old)
    const games = p.games as Record<string, unknown>
    expect(games.quickEye).toEqual({ level: 9, bestLevel: 10, rounds: 80, wins: 60 })
    expect(p.quickEye).toEqual({ variant: 7, recentMs: [33, 50, 33], recentOk: '101', thresholdMs: 40 })
    expect((p.bestRuns as Record<string, number>).quickEye).toBe(900)
    expect(p.settings.centerOnly).toBe(true)
    expect(parseProgress(serializeProgress(p))).toEqual(p)
    // Its clamps still hold on an old record (its own level 0-12, its 16 stages, its 24-trial window).
    expect(parseProgress('{"v":1,"games":{"quickEye":{"level":99}},"quickEye":{"variant":99,"recentMs":[1,2],"recentOk":"1"},"sessions":{}}')).toMatchObject({
      games: { quickEye: { level: 12 } },
      quickEye: { variant: 16, recentMs: [], recentOk: '' },
    })
    // Nothing plans it, and nothing a round records can touch it.
    for (let seed = 1; seed <= 20; seed++) expect(planTodaysSession(p, createRng(seed)).map((s) => s.gameId)).not.toContain('quickEye')
    const after = recordRound(p, 'math', { level: 4.2, correct: true, points: 40 }, '2026-11-13')
    expect((after.games as Record<string, unknown>).quickEye).toEqual(games.quickEye)
    expect(after.quickEye).toEqual(p.quickEye)
  })
})

describe('the how-to-play demo plays every game from the engine alone', () => {
  it('every game has a demo that asks something, taps, and ends on a right answer', () => {
    for (const { id, def } of BRAIN_GAMES) {
      const frames = buildDemo(id)
      expect(frames.length, id).toBeGreaterThan(2)
      expect(frames.some((f) => f.tap !== undefined), `${id} demo taps`).toBe(true)
      const last = frames[frames.length - 1].view
      if (last.kind === 'choice') expect(last.picked).toBe(last.correctIndex)
      if (last.kind === 'grid') expect(last.cells.some((c) => c.tone === 'wrong'), `${id} demo makes no mistake`).toBe(false)
      expect(frames.every((f) => f.holdMs > 0 && f.holdMs <= 1600)).toBe(true)
      void def
    }
  })

  it("Color Word's demo shows the conflict it teaches: the word names one colour, the ink is another", () => {
    // The platforms build it on a 4-wide, 4-tall board (DemoPlayer); the default context too.
    for (const ctx of [{}, { maxCols: 4, maxRows: 4 }]) {
      const asked = buildDemo('stroop', ctx).find((f) => f.tap !== undefined)?.view as ChoiceView
      expect(asked.stimulus.textKey).not.toBe(`colors.${asked.stimulus.color}`)
    }
  })
})

describe('round history, stars and streaks', () => {
  it('keeps the last rounds per game, round-trips, and stays small for SecureStore', () => {
    let h = emptyHistory()
    for (const { id } of BRAIN_GAMES) {
      for (let i = 0; i < 20; i++) h = recordHistory(h, id, { day: '2026-11-12', level: 12.34 + i, accuracy: 0.876 })
    }
    for (const { id } of BRAIN_GAMES) expect(gameHistory(h, id)).toHaveLength(HISTORY_PER_GAME)
    const raw = serializeHistory(h)
    expect(raw.length).toBeLessThan(1800)
    const back = parseHistory(raw)
    expect(gameHistory(back, 'memoryGrid').at(-1)).toEqual({ day: '2026-11-12', level: 31.3, accuracy: 0.88 })
    expect(parseHistory('{"v":2,"rounds":{"memoryGrid":[[1,2],"x",[1,2,3]],"nope":[[1,1,1]]}}').rounds).toEqual({ memoryGrid: [[1, 2, 3]] })
    expect(parseHistory('garbage')).toEqual(emptyHistory())
    // A day far out of range would throw in the date conversion on every trend: it is dropped.
    expect(parseHistory('{"v":2,"rounds":{"math":[[9e15,10,50],[1000,10,50]]}}').rounds).toEqual({ math: [[1000, 10, 50]] })
  })

  it('stars by accuracy (none for very short rounds), streak tiers at 3, 6 and 10', () => {
    expect(roundStars(4, 4)).toBe(0)
    expect(roundStars(10, 9)).toBe(3)
    expect(roundStars(10, 8)).toBe(2)
    expect(roundStars(10, 5)).toBe(1)
    expect([2, 3, 6, 10].map(streakTier)).toEqual([0, 1, 2, 3])
  })

  it("today's line-up is the same all day, and changes once a session is done", () => {
    const p = emptyProgress()
    const a = planTodaysSession(p, createRng(todaysPlanSeed(p, '2026-11-12'))).map((s) => s.gameId)
    const b = planTodaysSession(p, createRng(todaysPlanSeed(p, '2026-11-12'))).map((s) => s.gameId)
    expect(a).toEqual(b)
    const after = recordSession(p, 22, '2026-11-12', null, a)
    expect(todaysPlanSeed(after, '2026-11-12')).not.toBe(todaysPlanSeed(p, '2026-11-12'))
  })
})
