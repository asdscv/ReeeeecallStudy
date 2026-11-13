/**
 * The round hook's clocks and endings, driven with fake timers: a pause keeps what was left of a
 * memorise phase (it used to replay the whole phase, buying unlimited study time), a span round
 * always ends, a waited-out span trial costs a chance even in relaxed timing, levels stop at each
 * game's ceiling, and the round reports the time actually played.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { dayNumber, emptyHistory, emptyMeta, emptyProgress, hasBit, mechanicInfo, parseMeta, parseProgress, brainGame, DEFAULT_CONTEXT, MECHANICS, type BrainMeta, type BrainProgress, type CreateContext, type RoundView } from '@reeeeecall/shared/lib/brain-games'
import { useBrainRound, type PlatformContext, type RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useTodaysTraining } from '@reeeeecall/shared/hooks/useTodaysTraining'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'

const PLATFORM: PlatformContext = { maxCols: 5 }

const TODAY = Math.floor(new Date('2026-11-12T10:00:00').getTime() / 86_400_000)

/**
 * Every game already practised: the tests start on counted trials. Fresh meta and history each time.
 * A game given a record also gets a settled skill estimate (a returning player of this version),
 * unless the test passes its own meta — a record with no estimate is a pre-estimate (legacy) player.
 */
function seed(patch: (p: BrainProgress) => BrainProgress = (p) => p, meta?: BrainMeta) {
  const p = emptyProgress()
  const progress = patch({ ...p, practiced: ['memoryGrid', 'sequence', 'oddOneOut', 'stroop', 'schulte', 'pairs', 'math', 'series'] })
  const sk: BrainMeta['sk'] = {}
  for (const [id, g] of Object.entries(progress.games)) if (g && g.rounds > 0) sk[id as keyof BrainMeta['sk']] = { mu: g.level, sd: 1, n: g.rounds, day: TODAY }
  useBrainStore.setState({ progress, meta: meta ?? { ...emptyMeta(), sk }, history: emptyHistory(), storageKey: 'test' })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-12T10:00:00'))
})
afterEach(() => {
  vi.useRealTimers()
})

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe('memorise phases and pause', () => {
  it('a pause keeps the remaining show time instead of restarting it', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('memoryGrid', PLATFORM))
    const view = result.current.view
    expect(view.kind === 'grid' && view.locked).toBe(true)
    // Level 1: 3 cells for 1540ms (its memorise bar says how long). Pause 450ms before the end, wait a minute, resume.
    const showMs = view.kind === 'grid' ? (view.showBar?.ms ?? 0) : 0
    expect(showMs).toBe(1540)
    advance(showMs - 450)
    act(() => result.current.pause())
    advance(60_000)
    act(() => result.current.resume())
    advance(400)
    expect(result.current.view.kind === 'grid' && result.current.view.locked, 'still memorising just before the 450ms left run out').toBe(true)
    advance(100)
    expect(result.current.view.kind === 'grid' && result.current.view.locked, 'recall starts when the original show time is used up').toBe(false)
  })
})

describe('rounds always end', () => {
  it('relaxed timing: a timeout never costs a chance (EVIDENCE §4.3), and the round still ends — at its cap, not as cleared', () => {
    seed((p) => ({ ...p, settings: { ...p.settings, timing: 2 } }))
    const { result } = renderHook(() => useBrainRound('memoryGrid', PLATFORM))
    for (let i = 0; i < 80 && !result.current.over; i++) advance(10_000)
    expect(result.current.over).toBe(true)
    expect(result.current.stats.endedBy).toBe('cap')
    expect(result.current.stats.cleared).toBe(false)
    expect(result.current.lives).toBe(2)
  })

  it('a span round that keeps passing stops at its cap', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('sequence', PLATFORM))
    for (let guard = 0; guard < 6000 && !result.current.over; guard++) {
      if (result.current.intro) {
        act(() => result.current.ackIntro())
        continue
      }
      const taps = result.current.solution
      if (taps && taps.length) act(() => result.current.tap(taps[0]))
      else advance(100)
    }
    expect(result.current.stats.endedBy).toBe('cap')
    expect(result.current.stats.cleared).toBe(true)
    // The reverse-order card came up once, and its trial did not count.
    expect(result.current.stats.trials).toBe(14)
  })
})

describe('level ceilings', () => {
  it('games whose puzzle stops changing have a ceiling; the ones that keep growing do not', () => {
    for (const id of ['schulte', 'oddOneOut', 'pairs', 'stroop', 'memoryGrid'] as const) {
      expect(brainGame(id).def.maxLevel?.(DEFAULT_CONTEXT), id).toBeGreaterThan(0)
    }
    expect(brainGame('memoryGrid').def.maxLevel?.({ ...DEFAULT_CONTEXT, maxCols: 3 })).toBeLessThan(brainGame('memoryGrid').def.maxLevel?.({ ...DEFAULT_CONTEXT, maxCols: 7 }) ?? 0)
    // Number Hunt keeps tightening its clock past the last grid size.
    const def = brainGame('schulte').def
    const at = (level: number) => Number(def.timeLimitMs(def.create(level, { next: () => 0.99, int: (a: number) => a, chance: () => false, pick: <T,>(x: readonly T[]) => x[0], shuffle: <T,>(x: readonly T[]) => x.slice(), sample: <T,>(x: readonly T[], n: number) => x.slice(0, n) }, DEFAULT_CONTEXT)))
    expect(at(30)).toBeLessThan(at(16))
  })
})

describe('active time', () => {
  it('reports time played, not time paused', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('stroop', PLATFORM))
    advance(2000)
    act(() => result.current.pause())
    advance(120_000)
    act(() => result.current.resume())
    advance(1000)
    act(() => result.current.stop())
    expect(result.current.stats.activeMs).toBe(3000)
  })
})

describe('placement and rule cards in a round', () => {
  it("a game never played starts by finding the level: no chances spent, then the staircase takes over higher than 1", () => {
    seed()
    const { result } = renderHook(() => useBrainRound('oddOneOut', PLATFORM))
    // Placement blocks every unseen rule, so no card should come; acknowledge one if it does.
    if (result.current.intro) act(() => result.current.ackIntro())
    // Either way the level stays hidden: it is "finding your start" until the staircase takes over.
    expect(result.current.placing).toBe(true)
    let placementTrials = 0
    for (let guard = 0; guard < 400 && result.current.trialKind !== 'counted'; guard++) {
      if (result.current.intro) {
        act(() => result.current.ackIntro())
        continue
      }
      const taps = result.current.solution
      if (taps && taps.length && !result.current.result) {
        if (result.current.trialKind === 'placement') placementTrials++
        act(() => result.current.tap(taps[0]))
      } else advance(100)
    }
    expect(placementTrials).toBeGreaterThanOrEqual(8)
    expect(result.current.lives).toBe(3)
    // A perfect player is placed well above the floor (it used to be level 1 for a whole round).
    expect(result.current.level).toBeGreaterThan(5)
  })

  it('a rule met for the first time stops its trial with a card; the trial waits and does not count', () => {
    seed((p) => ({ ...p, games: { ...p.games, stroop: { level: 12, bestLevel: 12, rounds: 40, wins: 30 } } }))
    const { result } = renderHook(() => useBrainRound('stroop', PLATFORM))
    let sawCard = false
    for (let guard = 0; guard < 600 && !sawCard; guard++) {
      if (result.current.intro) {
        sawCard = true
        break
      }
      const taps = result.current.solution
      if (taps && taps.length && !result.current.result) act(() => result.current.tap(taps[0]))
      else advance(100)
    }
    expect(sawCard).toBe(true)
    expect(result.current.intro?.tag).toBe('stroop.labelInk')
    expect(result.current.timer).toBeNull()
    expect(result.current.solution).toBeNull()
    advance(60_000)
    expect(result.current.result).toBeNull()
    act(() => result.current.ackIntro())
    expect(result.current.intro).toBeNull()
    const taps = result.current.solution as number[]
    act(() => result.current.tap(taps[0]))
    expect(result.current.result?.practice).toBe(true)
    expect(result.current.result?.points).toBe(0)
  })
})

/** Plays a round perfectly (or with misses every `missEvery` trials), acknowledging rule cards. */
function playRound(result: { current: ReturnType<typeof useBrainRound> }, opts: { missEvery?: number; maxTrials?: number } = {}) {
  let judged = 0
  for (let guard = 0; guard < 8000 && !result.current.done; guard++) {
    const r = result.current
    if (r.intro) {
      act(() => r.ackIntro())
      continue
    }
    if (opts.maxTrials !== undefined && judged >= opts.maxTrials && !r.over) {
      act(() => r.stop())
      continue
    }
    const taps = r.solution
    if (taps && taps.length && !r.result) {
      const miss = opts.missEvery !== undefined && (judged + 1) % opts.missEvery === 0
      const view = r.view
      const wrong = view.kind === 'choice' ? (taps[0] + 1) % view.options.length : view.kind === 'grid' ? view.cells.findIndex((_c, i) => !taps.includes(i)) : taps[0]
      act(() => r.tap(miss && wrong >= 0 ? wrong : taps[0]))
      if (result.current.result) judged++
    } else advance(100)
  }
}

describe('time budget (Today\'s Training slots)', () => {
  it('when the slot time is up the round ends after the trial in play — a normal ending, not a quit, not a clear', () => {
    seed((p) => ({ ...p, games: { ...p.games, stroop: { level: 6, bestLevel: 6, rounds: 60, wins: 50 } } }))
    const { result } = renderHook(() => useBrainRound('stroop', PLATFORM, { timeBudgetMs: 5_000 }))
    let judged = 0
    for (let guard = 0; guard < 2000 && !result.current.done; guard++) {
      const r = result.current
      if (r.intro) {
        act(() => r.ackIntro())
        continue
      }
      const taps = r.solution
      if (taps && taps.length && !r.result) {
        act(() => r.tap(taps[0]))
        // Rule-card trials are unscored (a placement may reach the word rule): count scored ones only.
        if (result.current.result && !result.current.result.practice) judged++
      } else advance(100)
    }
    expect(result.current.stats.endedBy).toBe('time')
    expect(result.current.stats.cleared).toBe(false)
    expect(judged).toBeGreaterThan(2)
    expect(judged).toBeLessThan(20)
    // Never mid-trial: the last trial was judged before the round ended.
    expect(result.current.stats.trials).toBe(judged)
    expect(result.current.stats.setupMs).toBe(0)
  })

  it("a first round never ends during placement, and its setup time is not the slot's play time", () => {
    seed()
    const { result } = renderHook(() => useBrainRound('stroop', PLATFORM, { timeBudgetMs: 5_000 }))
    let placementTrials = 0
    let countedTrials = 0
    for (let guard = 0; guard < 4000 && !result.current.done; guard++) {
      const r = result.current
      if (r.intro) {
        act(() => r.ackIntro())
        continue
      }
      const taps = r.solution
      if (taps && taps.length && !r.result) {
        const kind = r.trialKind
        act(() => r.tap(taps[0]))
        if (kind === 'placement') placementTrials++
        else if (kind === 'counted') countedTrials++
      } else advance(100)
    }
    const s = result.current.stats
    expect(s.endedBy).toBe('time')
    // A perfect player's placement runs its full 14 trials — well past the 5s budget — and hands over.
    expect(placementTrials).toBe(14)
    expect(s.placement).toBe('done')
    expect(countedTrials).toBeGreaterThan(2)
    expect(s.setupMs).toBeGreaterThan(9_000)
    expect(s.setupMs).toBeLessThan(s.activeMs)
    // What is left after setup is about the budget (it ends after the trial in play).
    expect(s.activeMs - s.setupMs).toBeGreaterThanOrEqual(5_000)
    expect(s.activeMs - s.setupMs).toBeLessThan(7_000)
  })

  it("Today's Training keeps a round's setup time out of the slot", () => {
    seed()
    const { result } = renderHook(() => useTodaysTraining())
    const slot = result.current.slot!
    const full = slot.minutes * 60_000
    expect(result.current.slotBudgetMs).toBe(full)
    const stats = { trials: 3, correct: 2, points: 10, levelStart: 3, levelEnd: 4, endedBy: 'lives', activeMs: 50_000, setupMs: 40_000 } as RoundStats
    act(() => result.current.onRoundOver(slot.gameId, stats))
    // Only the 10s actually played count against the slot (another round of the same game follows).
    expect(result.current.slotBudgetMs).toBe(Math.max(15_000, full - 10_000))
  })
})

describe('the board games\' new round logic (GAMES_DIFFICULTY_PLAN §2.3-2.9)', () => {
  /** Every ctx a game's create() was called with, from now on. */
  function spyCreates(id: Parameters<typeof brainGame>[0]) {
    const def = brainGame(id).def
    const calls: { level: number; ctx: CreateContext }[] = []
    const real = def.create.bind(def)
    const spy = vi.spyOn(def, 'create').mockImplementation((level: number, rng, ctx: CreateContext) => {
      calls.push({ level, ctx })
      return real(level, rng, ctx)
    })
    return { calls, restore: () => spy.mockRestore() }
  }

  it('counted trials let only the lowest unseen rule through, and none for three counted trials after a card or once two were shown', () => {
    seed((p) => ({ ...p, games: { ...p.games, schulte: { level: 13, bestLevel: 13, rounds: 50, wins: 40 } } }))
    // What the round knew when each trial was built: counted trials so far and the cards shown.
    const snap = { counted: 0, cards: [] as string[], cardAt: null as number | null }
    const def = brainGame('schulte').def
    const real = def.create.bind(def)
    const calls: { ctx: CreateContext; at: typeof snap }[] = []
    const spy = vi.spyOn(def, 'create').mockImplementation((level: number, rng, ctx: CreateContext) => {
      calls.push({ ctx, at: { ...snap, cards: [...snap.cards] } })
      return real(level, rng, ctx)
    })
    const { result } = renderHook(() => useBrainRound('schulte', PLATFORM))
    const rules = MECHANICS.filter((m) => m.game === 'schulte' && m.kind === 'rule' && !m.retired).map((m) => m.tag)
    expect(calls[0].ctx.trialKind).toBe('counted')
    expect(calls[0].ctx.blockRules).not.toContain('schulte.descending')
    expect(calls[0].ctx.blockRules).toContain('schulte.reshuffle')
    expect(calls[0].ctx.maxRows).toBe(DEFAULT_CONTEXT.maxRows)
    for (let guard = 0; guard < 40000 && result.current.trialInRound < 12 && !result.current.over; guard++) {
      const r = result.current
      snap.counted = r.trialInRound
      if (r.intro) {
        if (!snap.cards.includes(r.intro.tag)) {
          snap.cards.push(r.intro.tag)
          snap.cardAt = r.trialInRound
        }
        act(() => r.ackIntro())
        continue
      }
      const taps = r.solution
      if (taps && taps.length && !r.result) act(() => r.tap(taps[0]))
      else advance(100)
    }
    spy.mockRestore()
    expect(snap.cards.length).toBeGreaterThan(0)
    let gated = 0
    for (const { ctx, at } of calls.slice(1)) {
      // (The games produce their rules from their own changes; until each honours blockRules a
      // blocked rule can still show — what is checked here is what the round asked for.)
      const notMet = rules.filter((t) => !at.cards.includes(t))
      const closed = at.cards.length >= 2 || (at.cardAt !== null && at.counted - at.cardAt < 3)
      if (closed) {
        gated++
        expect([...ctx.blockRules].sort(), JSON.stringify(at)).toEqual(notMet.sort())
      } else {
        expect(ctx.blockRules.length, JSON.stringify(at)).toBeGreaterThanOrEqual(notMet.length - 1)
      }
    }
    expect(gated).toBeGreaterThan(0)
  })

  it('a first round of a board game: placement trials are built as placement with every rule blocked, the first at level 3', () => {
    seed()
    const { calls, restore } = spyCreates('oddOneOut')
    const { result } = renderHook(() => useBrainRound('oddOneOut', PLATFORM))
    expect(result.current.placing).toBe(true)
    expect(calls[0].level).toBe(3)
    const unseen = MECHANICS.filter((m) => m.game === 'oddOneOut' && m.kind === 'rule' && !m.retired).map((m) => m.tag).sort()
    for (let guard = 0; guard < 2000 && result.current.trialKind !== 'counted'; guard++) {
      // (A game that does not honour blockRules yet can still show a rule here: acknowledge it.)
      if (result.current.intro) {
        act(() => result.current.ackIntro())
        continue
      }
      const taps = result.current.solution
      if (taps && taps.length && !result.current.result) act(() => result.current.tap(taps[0]))
      else advance(100)
    }
    const placement = calls.filter((c) => c.ctx.trialKind === 'placement')
    expect(placement.length).toBeGreaterThanOrEqual(8)
    expect([...placement[0].ctx.blockRules].sort()).toEqual(unseen)
    // Every rule unseen at the round's start is blocked in placement (a card met meanwhile is seen, so drops out).
    for (const c of placement) expect(unseen.filter((t) => !c.ctx.blockRules.includes(t)).every((t) => hasBit(useBrainStore.getState().meta.seen, mechanicInfo(t)!.bit))).toBe(true)
    // No card met cold in placement; the round's seed and its last trials ride along.
    expect(new Set(calls.map((c) => c.ctx.roundSeed)).size).toBe(1)
    expect(calls[2].ctx.recent.map((t) => t.level)).toEqual([calls[0].level, calls[1].level])
    restore()
  })

  it('Odd One Out: a new player placed mid-way up the mirror tier meets the mirror on 4 cards first, then on the level’s own board', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('oddOneOut', PLATFORM))
    // Right on every board without colour noise, wrong on every one with it (tier 5 on): placement
    // hands over inside the mirror tier, past its 2×2 level, the mirror blocked all through placement.
    const play = () => {
      const r = result.current
      const taps = r.solution
      if (!taps || !taps.length || r.result) return advance(100)
      const v = r.view
      const inked = v.kind === 'grid' && v.cells.some((c) => c.ink)
      act(() => r.tap(inked && v.kind === 'grid' ? (taps[0] + 1) % v.cells.length : taps[0]))
    }
    let card: { view: RoundView; level: number } | null = null
    for (let guard = 0; guard < 3000 && !card && !result.current.over; guard++) {
      const r = result.current
      if (r.intro) {
        if (r.intro.tag === 'oddOneOut.mirror') card = { view: r.view, level: r.level }
        else act(() => r.ackIntro())
      } else play()
    }
    expect(card?.level).toBeGreaterThanOrEqual(17)
    expect(card?.level).toBeLessThan(21)
    expect(card?.view.kind === 'grid' && [card.view.cols, card.view.rows]).toEqual([2, 2])
    act(() => result.current.ackIntro())
    for (let guard = 0; guard < 200 && result.current.trialKind !== 'counted'; guard++) play()
    const next = result.current.view
    expect(next.kind === 'grid' && next.cols).toBeGreaterThan(2)
  })

  it('Number Hunt places in three graded boards: a fast perfect player hands over well up', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('schulte', PLATFORM))
    let boards = 0
    for (let guard = 0; guard < 20000 && result.current.trialKind !== 'counted'; guard++) {
      const r = result.current
      if (r.intro) {
        act(() => r.ackIntro())
        continue
      }
      const taps = r.solution
      if (taps && taps.length && !r.result) {
        act(() => r.tap(taps[0]))
        if (result.current.result?.kind === 'placement') boards++
      } else advance(100)
    }
    expect(boards).toBe(3)
    expect(result.current.level).toBeGreaterThanOrEqual(12.5)
  })

  it('span fast entry: a first round jumps two lengths a pass (never past the reverse rule), and its first miss costs no chance', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('sequence', PLATFORM))
    expect(result.current.level).toBe(2)
    const levels: number[] = []
    let missed = false
    for (let guard = 0; guard < 8000 && !missed && !result.current.over; guard++) {
      const r = result.current
      if (r.intro) {
        act(() => r.ackIntro())
        continue
      }
      const taps = r.solution
      if (taps && taps.length && !r.result) {
        if (r.trialKind === 'counted' && !levels.includes(r.level)) levels.push(r.level)
        if (r.trialKind === 'counted' && r.level >= 6) {
          // The first miss: a probe — one length back, both chances kept.
          const v = r.view
          const wrong = v.kind === 'grid' ? v.cells.findIndex((_c, i) => i !== taps[0]) : 0
          act(() => r.tap(wrong))
          missed = true
          break
        }
        act(() => r.tap(taps[0]))
      } else advance(100)
    }
    expect(levels).toEqual([2, 4, 6])
    expect(result.current.result).toMatchObject({ correct: false, livesLost: 0, levelAfter: 5 })
    expect(result.current.lives).toBe(2)
  })

  it("Match Pairs' probe ladder: L3 → L6 → L9 → L12, no score, then the staircase half a level below the last board passed", () => {
    seed()
    const { result } = renderHook(() => useBrainRound('pairs', PLATFORM))
    const boards: number[] = []
    for (let guard = 0; guard < 40000 && result.current.trialKind !== 'counted' && !result.current.over; guard++) {
      const r = result.current
      if (r.intro) {
        act(() => r.ackIntro())
        continue
      }
      const taps = r.solution
      if (taps && taps.length && !r.result) {
        if (!boards.includes(r.level)) boards.push(r.level)
        expect(r.placing).toBe(true)
        act(() => r.tap(taps[0]))
        if (result.current.result) expect(result.current.result.points).toBe(0)
      } else advance(100)
    }
    expect(boards).toEqual([3, 6, 9, 12])
    // Four clean clears: the last board passed is L12, so the staircase starts at 11.5, unsure (its
    // bigger steps climb from there). It used to start at 15 − 0.5 — a board never shown.
    expect(result.current.level).toBeCloseTo(11.5)
    expect(result.current.stats.points).toBe(0)
    expect(result.current.stats.trials).toBe(0)
    expect(result.current.lives).toBe(3)
  })

  it('the probe stops on a clear with two informed misses or on a failed board, half a level below the last board passed; none passed starts at L2', () => {
    const def = brainGame('pairs').def
    const realOutcome = def.outcome.bind(def)
    /** Plays the probe; `board(n, outcome)` may change the n-th board's outcome (1-based). */
    const probe = (board: (n: number, o: NonNullable<ReturnType<typeof realOutcome>>) => ReturnType<typeof realOutcome>) => {
      let n = 0
      let last: unknown = null
      const spy = vi.spyOn(def, 'outcome').mockImplementation((s) => {
        const o = realOutcome(s)
        if (!o) return o
        if (s !== last) {
          last = s
          n++
        }
        return board(n, o)
      })
      seed()
      const { result, unmount } = renderHook(() => useBrainRound('pairs', PLATFORM))
      const boards: number[] = []
      for (let guard = 0; guard < 40000 && result.current.trialKind !== 'counted' && !result.current.over; guard++) {
        const r = result.current
        if (r.intro) {
          act(() => r.ackIntro())
          continue
        }
        const taps = r.solution
        if (taps && taps.length && !r.result) {
          if (!boards.includes(r.level)) boards.push(r.level)
          act(() => r.tap(taps[0]))
        } else advance(100)
      }
      const out = { boards, level: result.current.level, placement: result.current.stats.placement }
      unmount()
      spy.mockRestore()
      return out
    }
    // Board 2 (L6) cleared with two informed misses: stop, the last board passed is L6 → 5.5.
    expect(probe((n, o) => (n === 2 ? { ...o, informedMisses: 2 } : o))).toMatchObject({ boards: [3, 6], level: 5.5 })
    // Board 2 failed: the last board passed is L3 → 2.5 (never half a level under the board just failed).
    expect(probe((n, o) => (n === 2 ? { ...o, correct: false } : o))).toMatchObject({ boards: [3, 6], level: 2.5 })
    // The first board failed: none passed → L2.
    expect(probe((n, o) => (n === 1 ? { ...o, correct: false } : o))).toMatchObject({ boards: [3], level: 2 })
  })

  it('a span game back after two weeks re-enters fast; one played yesterday climbs a length at a time', () => {
    const away = (days: number) => {
      seed(
        (p) => ({ ...p, games: { ...p.games, memoryGrid: { level: 4, bestLevel: 5, rounds: 30, wins: 20 } } }),
        { ...emptyMeta(), sk: { memoryGrid: { mu: 4, sd: 1, n: 30, day: dayNumber('2026-11-12') - days } } },
      )
      const { result, unmount } = renderHook(() => useBrainRound('memoryGrid', PLATFORM))
      const levels: number[] = []
      for (let guard = 0; guard < 8000 && levels.length < 3 && !result.current.over; guard++) {
        const r = result.current
        if (r.intro) {
          act(() => r.ackIntro())
          continue
        }
        const taps = r.solution
        if (taps && taps.length && !r.result) {
          if (!levels.includes(r.level)) levels.push(r.level)
          for (const t of taps) if (!result.current.result) act(() => result.current.tap(t))
        } else advance(100)
      }
      unmount()
      return levels
    }
    const fast = away(20)
    expect(fast[1] - fast[0]).toBeCloseTo(2, 6)
    const slow = away(1)
    expect(slow[1] - slow[0]).toBeCloseTo(1, 6)
  })

  it('a missed choice trial with a worked answer stays up 2.4s, skippable after 500ms', () => {
    seed((p) => ({ ...p, games: { ...p.games, math: { level: 6, bestLevel: 6, rounds: 60, wins: 50 } } }))
    const def = brainGame('math').def
    const realView = def.view.bind(def)
    const spy = vi.spyOn(def, 'view').mockImplementation((s) => {
      const v = realView(s) as RoundView
      return v.kind === 'choice' && def.outcome(s) ? { ...v, stimulus: { ...v.stimulus, reveal: { lines: ['worked'] } } } : v
    })
    const { result } = renderHook(() => useBrainRound('math', PLATFORM))
    const wrongTap = () => {
      const r = result.current
      const v = r.view
      act(() => r.tap(((r.solution as number[])[0] + 1) % (v.kind === 'choice' ? v.options.length : 2)))
    }
    wrongTap()
    const trial = result.current.trialId
    advance(1600)
    expect(result.current.trialId, 'a plain miss would have moved on at 1500ms').toBe(trial)
    advance(900)
    expect(result.current.trialId).toBe(trial + 1)
    // The next miss is skipped after 500ms.
    wrongTap()
    advance(300)
    act(() => result.current.skipReveal())
    advance(1)
    expect(result.current.trialId).toBe(trial + 1)
    advance(250)
    act(() => result.current.skipReveal())
    advance(1)
    expect(result.current.trialId).toBe(trial + 2)
    spy.mockRestore()
  })

  it("a right Number Pattern answer keeps the row's rule up 1.3s (plan §3.2), skippable after 500ms", () => {
    seed((p) => ({ ...p, games: { ...p.games, series: { level: 6, bestLevel: 6, rounds: 60, wins: 50 } } }))
    const { result } = renderHook(() => useBrainRound('series', PLATFORM))
    const rightTap = () => {
      const r = result.current
      act(() => r.tap((r.solution as number[])[0]))
    }
    rightTap()
    const v = result.current.view
    expect(v.kind === 'choice' && (v.stimulus.reveal?.gaps?.length ?? 0) > 0, 'a right answer shows the gap labels').toBe(true)
    const trial = result.current.trialId
    advance(1000)
    expect(result.current.trialId, 'a plain right answer would have moved on at 700ms').toBe(trial)
    advance(400)
    expect(result.current.trialId).toBe(trial + 1)
    rightTap()
    advance(300)
    act(() => result.current.skipReveal())
    advance(1)
    expect(result.current.trialId).toBe(trial + 1)
    advance(250)
    act(() => result.current.skipReveal())
    advance(1)
    expect(result.current.trialId).toBe(trial + 2)
  })

  it("a v1 save shaped like the owner's (Quick Math L3, no estimate) opens on placement, from its converted level", () => {
    const v1 = JSON.stringify({ v: 1, games: { math: { level: 3, bestLevel: 3.4, rounds: 120, wins: 100 } }, practiced: ['math'], sessions: {}, quickEyeField: 2 })
    const progress = parseProgress(v1)
    // Written as the current format (v3 since the thinking games), levels on the v2 scale.
    expect(progress.v).toBe(3)
    expect(progress.games.math?.level).toBeCloseTo(2.35)
    useBrainStore.setState({ progress, meta: parseMeta(JSON.stringify({ v: 1, seen: '' })), history: emptyHistory(), storageKey: 'test' })
    const { calls, restore } = spyCreates('math')
    const { result } = renderHook(() => useBrainRound('math', PLATFORM))
    expect(result.current.placing).toBe(true)
    expect(result.current.trialKind).toBe('placement')
    // The seed is the converted record (mu0 = max(3, 2.35), sd 9): the search opens on the prior's
    // easy side (its 30th percentile), not at the old record's band.
    expect(calls[0].level).toBeGreaterThan(2.35)
    expect(calls[0].level).toBeLessThanOrEqual(6)
    restore()
  })
})

describe('game logic across rounds', () => {
  it('a record from before skill estimates (the old slow ladder) is re-found once by placement, starting from that record', () => {
    seed((p) => ({ ...p, games: { ...p.games, math: { level: 2.4, bestLevel: 2.6, rounds: 40, wins: 36 } } }), emptyMeta())
    const { result } = renderHook(() => useBrainRound('math', PLATFORM))
    expect(result.current.placing).toBe(true)
    for (let guard = 0; guard < 600 && result.current.trialKind !== 'counted'; guard++) {
      if (result.current.intro) {
        act(() => result.current.ackIntro())
        continue
      }
      const taps = result.current.solution
      if (taps && taps.length && !result.current.result) act(() => result.current.tap(taps[0]))
      else advance(100)
    }
    // A player who gets everything right is not left at the old record's 2.4.
    expect(result.current.level).toBeGreaterThan(6)
    expect(result.current.lives).toBe(3)
  })

  it('practice ends after two right in a row, and a half-done practice resumes rather than restarts', () => {
    seed((p) => ({ ...p, practiced: p.practiced.filter((g) => g !== 'math') }))
    const { result } = renderHook(() => useBrainRound('math', PLATFORM))
    expect(result.current.trialKind).toBe('practice')
    for (let i = 0; i < 2; i++) {
      act(() => result.current.tap((result.current.solution as number[])[0]))
      advance(800)
    }
    expect(result.current.trialKind).not.toBe('practice')
    // Saved the moment it ends — the round may be closed before it finishes (a tab shut mid-round).
    expect(useBrainStore.getState().progress.practiced).toContain('math')
    // Resume: one practice trial done earlier → three left.
    seed((p) => ({ ...p, practiced: p.practiced.filter((g) => g !== 'stroop') }), { ...emptyMeta(), practice: { stroop: 1 } })
    const second = renderHook(() => useBrainRound('stroop', PLATFORM))
    expect(second.result.current.practiceDone).toBe(1)
    // One more practice trial, wrong, then the round is abandoned without an end: the count is kept,
    // and two tried with one wrong is not a finished practice.
    act(() => second.result.current.tap(((second.result.current.solution as number[])[0] + 1) % 2))
    expect(useBrainStore.getState().meta.practice.stroop).toBe(2)
    expect(useBrainStore.getState().progress.practiced).not.toContain('stroop')
    act(() => second.result.current.stop())
    expect(useBrainStore.getState().progress.practiced).not.toContain('stroop')
  })

  it('the next round starts from the round estimate — never back at level 1 — and a 2-trial quit leaves the start alone', () => {
    seed()
    const first = renderHook(() => useBrainRound('stroop', PLATFORM))
    playRound(first.result, { missEvery: 6 })
    const after = useBrainStore.getState()
    const start = after.progress.games.stroop?.level ?? 1
    expect(start).toBeGreaterThan(4)
    expect(after.meta.sk.stroop?.n).toBeGreaterThan(10)
    // A quick open-and-leave (2 counted trials) must not drain the start level.
    const quick = renderHook(() => useBrainRound('stroop', PLATFORM))
    playRound(quick.result, { maxTrials: 2 })
    expect(useBrainStore.getState().progress.games.stroop?.level).toBeCloseTo(start, 5)
  })

  it('short rounds never drag the start down — not through the stored level, not through the estimate', () => {
    const today = TODAY
    seed(
      (p) => ({ ...p, games: { ...p.games, stroop: { level: 9.5, bestLevel: 11, rounds: 60, wins: 50 } } }),
      { ...emptyMeta(), sk: { stroop: { mu: 10, sd: 1, n: 60, day: today } } },
    )
    const opens: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = renderHook(() => useBrainRound('stroop', PLATFORM))
      opens.push(r.result.current.stats.levelStart)
      // Two misses, then away.
      playRound(r.result, { missEvery: 1, maxTrials: 2 })
      r.unmount()
    }
    expect(opens).toEqual([9.5, 9.5, 9.5, 9.5])
    expect(useBrainStore.getState().meta.sk.stroop!.mu).toBe(10)
  })

  it('a strong clear (90%+) starts the next round right at the estimate — momentum, not the usual drop', () => {
    seed((p) => ({ ...p, games: { ...p.games, stroop: { level: 6, bestLevel: 6, rounds: 60, wins: 50 } } }))
    const first = renderHook(() => useBrainRound('stroop', PLATFORM))
    playRound(first.result)
    expect(first.result.current.stats.cleared).toBe(true)
    const mu = useBrainStore.getState().meta.sk.stroop!.mu
    const next = renderHook(() => useBrainRound('stroop', PLATFORM))
    expect(next.result.current.stats.levelStart).toBeCloseTo(mu, 5)
  })

  it("a first span round: practice at the floor, then the other span game's seed (two below its longest passed)", () => {
    seed(
      (p) => ({ ...p, practiced: p.practiced.filter((g) => g !== 'sequence'), games: { ...p.games, memoryGrid: { level: 6, bestLevel: 8, rounds: 30, wins: 20 } } }),
      { ...emptyMeta(), sk: { memoryGrid: { mu: 7, sd: 1, n: 30, day: 1 } } },
    )
    const { result } = renderHook(() => useBrainRound('sequence', PLATFORM))
    expect(result.current.trialKind).toBe('practice')
    expect(result.current.level).toBe(1)
    for (let guard = 0; guard < 4000 && result.current.trialKind === 'practice'; guard++) {
      const taps = result.current.solution
      if (taps && taps.length && !result.current.result) act(() => result.current.tap(taps[0]))
      else advance(100)
    }
    expect(result.current.level).toBe(5)
    // Practice met no rule card's rule: the reverse rule is still unseen.
    expect(hasBit(useBrainStore.getState().meta.seen, mechanicInfo('sequence.reverse')!.bit)).toBe(false)
  })

  it('a rule card is shown once: the next round does not stop for it again', () => {
    seed((p) => ({ ...p, games: { ...p.games, schulte: { level: 6, bestLevel: 6, rounds: 50, wins: 40 } } }))
    const a = renderHook(() => useBrainRound('schulte', PLATFORM))
    let sawDescending = false
    for (let guard = 0; guard < 20000 && !a.result.current.over; guard++) {
      const r = a.result.current
      if (r.intro) {
        if (r.intro.tag === 'schulte.descending') sawDescending = true
        act(() => r.ackIntro())
        continue
      }
      if (sawDescending && r.result) {
        act(() => r.stop())
        continue
      }
      const taps = r.solution
      if (taps && taps.length && !r.result) act(() => r.tap(taps[0]))
      else advance(100)
    }
    expect(sawDescending).toBe(true)
    const bit = mechanicInfo('schulte.descending')?.bit as number
    expect(hasBit(useBrainStore.getState().meta.seen, bit)).toBe(true)
    const b = renderHook(() => useBrainRound('schulte', PLATFORM))
    let again = 0
    for (let guard = 0; guard < 20000 && b.result.current.trialInRound < 10 && !b.result.current.over; guard++) {
      const r = b.result.current
      if (r.intro?.tag === 'schulte.descending') again++
      if (r.intro) {
        act(() => r.ackIntro())
        continue
      }
      const taps = r.solution
      if (taps && taps.length && !r.result) act(() => r.tap(taps[0]))
      else advance(100)
    }
    expect(again).toBe(0)
  })

  it('a strong cleared round earns a tier (once) and achievements, and the score shows its parts', () => {
    seed((p) => ({ ...p, games: { ...p.games, stroop: { level: 9, bestLevel: 9, rounds: 60, wins: 50 } } }), { ...emptyMeta(), sk: { stroop: { mu: 9, sd: 1, n: 60, day: 1000 } }, seen: 'ffffffffffffffff' })
    const { result } = renderHook(() => useBrainRound('stroop', PLATFORM))
    playRound(result)
    const s = result.current.stats
    expect(s.cleared).toBe(true)
    expect(s.tierUp).not.toBeNull()
    expect(s.achievements).toEqual(expect.arrayContaining(['firstClear', 'cleanRound', 'streak10']))
    expect(s.score.clear).toBeGreaterThan(0)
    expect(s.score.clean).toBeGreaterThan(0)
    const parts = s.score.base + s.score.speed + s.score.combo + s.score.clear + s.score.clean
    expect(Math.abs(parts - s.points)).toBeLessThan(s.trials + 2)
    const tier = useBrainStore.getState().meta.tier.stroop
    expect(tier).toBe(s.tierUp)
    // Played again the same way: no second tier-up for the same tier, no repeat achievements.
    const again = renderHook(() => useBrainRound('stroop', PLATFORM))
    playRound(again.result)
    expect(again.result.current.stats.achievements).not.toContain('firstClear')
  })
})
