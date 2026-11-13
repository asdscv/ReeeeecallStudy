/**
 * The round hook's clocks and endings, driven with fake timers: a pause keeps what was left of a
 * memorise phase (it used to replay the whole phase, buying unlimited study time), a span round
 * always ends, a waited-out span trial costs a chance even in relaxed timing, Quick Eye stops a
 * round of nothing but void trials, levels stop at each game's ceiling, and the round reports the
 * time actually played.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { emptyHistory, emptyMeta, emptyProgress, hasBit, mechanicInfo, quickEyeMaxLevel, brainGame, DEFAULT_CONTEXT, type BrainMeta, type BrainProgress } from '@reeeeecall/shared/lib/brain-games'
import { useBrainRound, type PlatformContext } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'

const PLATFORM: PlatformContext = { maxCols: 5, minExposureMs: 33, ringSlots: [8, 16, 16] }

function seed(patch: (p: BrainProgress) => BrainProgress = (p) => p, meta: BrainMeta = emptyMeta()) {
  const p = emptyProgress()
  // Every game already practised: the tests start on counted trials. Fresh meta and history each time.
  useBrainStore.setState({ progress: patch({ ...p, practiced: ['memoryGrid', 'sequence', 'quickEye', 'oddOneOut', 'stroop', 'schulte', 'pairs', 'math', 'series'] }), meta, history: emptyHistory(), storageKey: 'test' })
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
    // Level 1: 3 cells for 1950ms. Pause at 1500ms, wait a minute, resume.
    advance(1500)
    act(() => result.current.pause())
    advance(60_000)
    act(() => result.current.resume())
    advance(400)
    expect(result.current.view.kind === 'grid' && result.current.view.locked, 'still memorising just before the 450ms left run out').toBe(true)
    advance(100)
    expect(result.current.view.kind === 'grid' && result.current.view.locked, 'recall starts when the original 1950ms are used up').toBe(false)
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

describe('Quick Eye void trials', () => {
  it('after five voids in a row the measured flash is accepted as it was', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('quickEye', PLATFORM))
    let voids = 0
    for (let guard = 0; guard < 400 && voids < 6; guard++) {
      const v = result.current.view
      if (v.kind === 'quickEye' && v.phase === 'stimulus' && !result.current.result) {
        // A device that always shows two frames too many: never an exact match.
        act(() => result.current.reportExposure(v.exposureMs + 2 * (1000 / 60), 1000 / 60))
        // Read afresh: the guard above narrowed `result` to null for TypeScript.
        const judged = (result.current as { result: { void: boolean } | null }).result
        if (judged?.void) voids++
        else break
      }
      advance(50)
    }
    expect(voids).toBe(5)
    expect(result.current.view.kind === 'quickEye' && result.current.view.phase).toBe('mask')
  })

  it('a stimulus that never reports (a stalled screen) ends the round after eight voids', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('quickEye', PLATFORM))
    for (let i = 0; i < 200 && !result.current.over; i++) advance(500)
    expect(result.current.over).toBe(true)
    expect(result.current.stats.trials).toBe(0)
    // Not "cleared": the round stopped itself.
    expect(result.current.stats.endedBy).toBe('void')
  })

  it('once lenient, stays lenient: a device a frame or two off keeps playing, not voiding five in six', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('quickEye', PLATFORM))
    let voids = 0
    let counted = 0
    for (let guard = 0; guard < 2000 && counted < 6; guard++) {
      const v = result.current.view
      if (v.kind === 'quickEye' && v.phase === 'stimulus' && !result.current.result) {
        act(() => result.current.reportExposure(v.exposureMs + 2 * (1000 / 60), 1000 / 60))
        const judged = (result.current as { result: { void: boolean } | null }).result
        if (judged?.void) voids++
      }
      const taps = result.current.solution
      if (taps && taps.length && !result.current.result) {
        act(() => result.current.tap(taps[0]))
        if ((result.current as { result: unknown }).result) counted++
      }
      advance(50)
    }
    expect(counted).toBe(6)
    expect(voids).toBe(5)
  })

  it('a device whose floor gets raised never loses level for answering right', () => {
    seed((p) => ({ ...p, games: { ...p.games, quickEye: { level: 11, bestLevel: 11, rounds: 3, wins: 3 } } }))
    const { result } = renderHook(() => useBrainRound('quickEye', PLATFORM))
    let lowest = result.current.level
    for (let guard = 0; guard < 3000 && !result.current.over; guard++) {
      const v = result.current.view
      // One frame long every time: voids, then the floor rises, then lenient play.
      if (v.kind === 'quickEye' && v.phase === 'stimulus' && !result.current.result) act(() => result.current.reportExposure(v.exposureMs + 1000 / 60, 1000 / 60))
      const taps = result.current.solution
      if (taps && taps.length && !result.current.result) act(() => result.current.tap(taps[0]))
      lowest = Math.min(lowest, result.current.level)
      advance(50)
    }
    expect(lowest).toBeGreaterThanOrEqual(10.9)
  })

  it('a pause during fixation restarts the fixation: the flash never comes right after resume', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('quickEye', PLATFORM))
    advance(450)
    act(() => result.current.pause())
    advance(5000)
    act(() => result.current.resume())
    advance(100)
    const v = result.current.view
    expect(v.kind === 'quickEye' && v.phase).toBe('fixation')
  })
})

describe('level ceilings', () => {
  it("Quick Eye stops at the platform's shortest flash: 33ms is ladder step 11, not 12", () => {
    expect(quickEyeMaxLevel(33)).toBe(11)
    expect(quickEyeMaxLevel(17)).toBe(12)
    seed((p) => ({ ...p, games: { ...p.games, quickEye: { level: 12, bestLevel: 12, rounds: 3, wins: 3 } } }))
    const { result } = renderHook(() => useBrainRound('quickEye', PLATFORM))
    expect(result.current.level).toBe(11)
  })

  it('games whose puzzle stops changing have a ceiling; the ones that keep growing do not', () => {
    for (const id of ['schulte', 'oddOneOut', 'pairs', 'stroop', 'memoryGrid', 'quickEye'] as const) {
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
    // The first placement trial may land on a turned-shape round (level 4+, 35%): its rule card comes first.
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
    expect(result.current.intro?.tag).toBe('stroop.word')
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

describe('game logic across rounds', () => {
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
    const today = Math.floor(new Date('2026-11-12T10:00:00').getTime() / 86_400_000)
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
