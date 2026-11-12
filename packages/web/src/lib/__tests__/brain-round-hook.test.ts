/**
 * The round hook's clocks and endings, driven with fake timers: a pause keeps what was left of a
 * memorise phase (it used to replay the whole phase, buying unlimited study time), a span round
 * always ends, a waited-out span trial costs a chance even in relaxed timing, Quick Eye stops a
 * round of nothing but void trials, levels stop at each game's ceiling, and the round reports the
 * time actually played.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { emptyProgress, quickEyeMaxLevel, brainGame, DEFAULT_CONTEXT, type BrainProgress } from '@reeeeecall/shared/lib/brain-games'
import { useBrainRound, type PlatformContext } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'

const PLATFORM: PlatformContext = { maxCols: 5, minExposureMs: 33, ringSlots: [8, 16, 16] }

function seed(patch: (p: BrainProgress) => BrainProgress = (p) => p) {
  const p = emptyProgress()
  // Every game already practised: the tests start on counted trials.
  useBrainStore.setState({ progress: patch({ ...p, practiced: ['memoryGrid', 'sequence', 'quickEye', 'oddOneOut', 'stroop', 'schulte', 'pairs', 'math', 'series'] }), storageKey: 'test' })
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
  it('relaxed timing: a span trial left blank costs a chance, so waiting cannot loop forever', () => {
    seed((p) => ({ ...p, settings: { ...p.settings, timing: 2 } }))
    const { result } = renderHook(() => useBrainRound('memoryGrid', PLATFORM))
    for (let i = 0; i < 40 && !result.current.over; i++) advance(10_000)
    expect(result.current.over).toBe(true)
    expect(result.current.stats.endedBy).toBe('lives')
  })

  it('a span round that keeps passing stops at its cap', () => {
    seed()
    const { result } = renderHook(() => useBrainRound('sequence', PLATFORM))
    for (let guard = 0; guard < 4000 && !result.current.over; guard++) {
      const taps = result.current.solution
      if (taps && taps.length) act(() => result.current.tap(taps[0]))
      else advance(100)
    }
    expect(result.current.stats.endedBy).toBe('cap')
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
