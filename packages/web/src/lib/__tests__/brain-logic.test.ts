/**
 * The game logic behind "it no longer starts at level 1": placement finds a player's level in a
 * handful of trials and keeps the staircase's target, uncertainty scales the steps and grows with
 * time away, every rule a game introduces is detectable from its trial, tiers sit where the puzzle
 * changes and below every ceiling, cross-game seeding stays conservative, achievements are earned
 * once, and the compact meta record survives garbage.
 */
import { describe, it, expect } from 'vitest'
import {
  ACHIEVEMENTS,
  BRAIN_GAMES,
  DEFAULT_CONTEXT,
  MECHANICS,
  SKILL,
  TIERS,
  TIER_COUNT,
  achievementBit,
  brainGame,
  createRng,
  crossGameSeed,
  quickEyeTierStage,
  earnedByRound,
  emptyMeta,
  emptyProgress,
  hasBit,
  levelAtStanding,
  maxColsFor,
  mechanicInfo,
  orMask,
  parseMeta,
  pCorrect,
  placementCeiling,
  placementDone,
  placementLevel,
  placementResult,
  roundEstimate,
  sdAfterDays,
  serializeMeta,
  setBit,
  standing,
  startFromEstimate,
  startPlacement,
  stepMultiplier,
  tierFor,
  tierProgress,
  updatePlacement,
  type BrainMeta,
} from '@reeeeecall/shared/lib/brain-games'

/** A simulated player: answers at the psychometric function with their true level. */
function runPlacement(theta: number, seed: number, opts: { target: number; slope: number; guess: number; hi: number; mu0?: number; sigma0?: number }) {
  const rng = createRng(seed)
  let p = startPlacement({ lo: 1, hi: opts.hi, mu0: opts.mu0 ?? 3, sigma0: opts.sigma0 ?? 9, target: opts.target, slope: opts.slope, maxMove: 3, minTrials: 8, maxTrials: 12 })
  const levels: number[] = []
  while (!placementDone(p)) {
    const x = placementLevel(p)
    levels.push(x)
    const correct = rng.next() < pCorrect(x, theta, opts.guess, { slope: 1.5, lapse: 0.03, target: opts.target })
    p = updatePlacement(p, x, correct, opts.guess)
  }
  return { result: placementResult(p), trials: levels.length, levels }
}

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1]

describe('placement', () => {
  it('finds a strong player in 8-12 trials instead of a round of +0.15 steps', () => {
    for (const theta of [4, 10, 18]) {
      const errors: number[] = []
      for (let seed = 1; seed <= 60; seed++) {
        const { result, trials } = runPlacement(theta, seed * 31, { target: 0.85, slope: 2, guess: 0.25, hi: 30 })
        expect(trials).toBeGreaterThanOrEqual(8)
        expect(trials).toBeLessThanOrEqual(12)
        errors.push(Math.abs(result.level - theta))
      }
      expect(median(errors), `θ=${theta}`).toBeLessThan(4)
    }
    // A very strong player is carried well up and handed over unsure, so the staircase's bigger
    // steps finish the climb.
    const far = Array.from({ length: 40 }, (_, i) => runPlacement(26, i * 13 + 1, { target: 0.85, slope: 2, guess: 0.25, hi: 30 }).result)
    expect(median(far.map((r) => r.level))).toBeGreaterThan(15)
    expect(median(far.map((r) => r.sd))).toBeGreaterThan(2)
  })

  it('errs easy for a novice and never jumps more than 3 levels at a time', () => {
    const ends: number[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const { result, levels } = runPlacement(1.5, seed, { target: 0.85, slope: 2, guess: 0.25, hi: 30 })
      ends.push(result.level)
      for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(3.001)
    }
    expect(median(ends)).toBeLessThan(2.5)
    expect(ends.filter((x) => x > 4).length).toBeLessThanOrEqual(6)
  })

  it("the model's target point is the staircase's target accuracy", () => {
    for (const guess of [0, 0.25, 0.5]) {
      expect(pCorrect(10, 10, guess, { slope: 2, lapse: 0.05, target: 0.85 })).toBeCloseTo(0.85, 6)
      expect(pCorrect(10, 10, guess, { slope: 1, lapse: 0.05, target: 0.8 })).toBeCloseTo(0.8, 6)
    }
    // Harder than the player's level → less likely right.
    expect(pCorrect(14, 10, 0.25, { slope: 2, lapse: 0.05, target: 0.85 })).toBeLessThan(0.85)
  })

  it('stays below the third unseen rule, so a strong first round opens with at most two cards', () => {
    const none = () => false
    const ceiling = placementCeiling('schulte', none)
    expect(ceiling).toBe(Infinity) // Number Hunt has only two rules
    const mathCeiling = placementCeiling('math', none)
    expect(mathCeiling).toBe(Infinity) // one card (two-step)
    // All seen → no ceiling.
    expect(placementCeiling('oddOneOut', () => true)).toBe(Infinity)
  })
})

describe('skill estimate', () => {
  it('k is 1 once settled, up to kMax while unsure; span never scales', () => {
    expect(stepMultiplier('speed', SKILL.speed.floor)).toBe(1)
    expect(stepMultiplier('speed', 100)).toBe(SKILL.speed.kMax)
    expect(stepMultiplier('quickEye', 1.2)).toBeCloseTo(2)
    expect(stepMultiplier('span', 10)).toBe(1)
  })

  it('uncertainty grows with days away, capped at sd0 — a return re-finds the level, a week off barely moves it', () => {
    const week = sdAfterDays('speed', 1, 7)
    const quarter = sdAfterDays('speed', 1, 90)
    expect(week).toBeGreaterThan(1)
    expect(week).toBeLessThan(1.4)
    expect(quarter).toBeGreaterThan(week)
    expect(sdAfterDays('speed', 1, 100000)).toBe(SKILL.speed.sd0)
  })

  it("the round's estimate needs 4 reversals and averages the last 6", () => {
    expect(roundEstimate([5, 6, 5])).toBeNull()
    expect(roundEstimate([1, 2, 3, 4, 5, 6, 7, 8])).toBeCloseTo(5.5)
  })

  it('next start: a little below the estimate, more when unsure; none for a strong round; mercy eases one step', () => {
    expect(startFromEstimate('speed', 10, 1)).toBeCloseTo(9.5)
    expect(startFromEstimate('speed', 10, 4)).toBeCloseTo(8)
    expect(startFromEstimate('speed', 10, 1, { momentum: true })).toBe(10)
    expect(startFromEstimate('speed', 10, 1, { mercy: true })).toBeCloseTo(8.65)
    expect(startFromEstimate('speed', 1.2, 4)).toBe(1)
  })
})

describe('mechanics (new rules and board changes)', () => {
  const contexts = [DEFAULT_CONTEXT, { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), ringSlots: [8, 16, 16] }]

  it('every registered mechanic is produced by some trial, and games report only registered ones', () => {
    const produced = new Set<string>()
    for (const { id, def } of BRAIN_GAMES) {
      for (const ctx of contexts) {
        for (const level of [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 23, 25, 30]) {
          for (let variant = 1; variant <= 16; variant++) {
            if (id !== 'quickEye' && variant > 1) break
            for (let seed = 1; seed <= 25; seed++) {
              const s = def.create(id === 'quickEye' ? Math.min(level, 12) : Math.max(1, level), createRng(seed * 977 + level), { ...ctx, variant })
              for (const tag of def.mechanics(s)) {
                expect(mechanicInfo(tag), `${id} reported unknown tag ${tag}`).toBeDefined()
                expect(mechanicInfo(tag)?.game).toBe(id)
                produced.add(tag)
              }
            }
          }
        }
      }
    }
    const missing = MECHANICS.map((m) => m.tag).filter((t) => !produced.has(t))
    expect(missing).toEqual([])
  })

  it('a rule never appears below its stated level (cards come when the rule really starts)', () => {
    for (const m of MECHANICS.filter((x) => x.kind === 'rule' && x.game !== 'quickEye')) {
      const def = brainGame(m.game).def
      for (let seed = 1; seed <= 200; seed++) {
        // Span levels act as whole lengths (rounded), so stay a full step below.
        const level = Math.max(1, m.from - (brainGame(m.game).group === 'span' ? 1 : 0.5))
        const s = def.create(level, createRng(seed), DEFAULT_CONTEXT)
        expect(def.mechanics(s).includes(m.tag), `${m.tag} at ${level}`).toBe(false)
      }
    }
  })
})

describe('tiers', () => {
  it('six thresholds per game, rising, and every one reachable below the level ceiling on a phone', () => {
    for (const { id, def } of BRAIN_GAMES) {
      const t = TIERS[id]
      expect(t).toHaveLength(TIER_COUNT)
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1])
      if (id === 'quickEye') continue
      const cap = def.maxLevel?.({ ...DEFAULT_CONTEXT, maxCols: maxColsFor(358) }) ?? Infinity
      expect(t[5], `${id} master below its cap`).toBeLessThan(cap)
    }
  })

  it('tier and progress toward the next', () => {
    expect(tierFor('stroop', 2)).toBe(0)
    expect(tierFor('stroop', 8)).toBe(2)
    expect(tierFor('stroop', 99)).toBe(6)
    expect(tierProgress('stroop', 5.5)).toMatchObject({ tier: 1, next: 8 })
    expect(tierProgress('stroop', 99).next).toBeNull()
  })

  it('standing and its inverse round-trip', () => {
    for (const { id } of BRAIN_GAMES) {
      for (const lv of [2, 5, 9, 13].filter((x) => x <= TIERS[id][5])) expect(levelAtStanding(id, standing(id, lv))).toBeCloseTo(Math.max(id === 'quickEye' ? 0 : 1, lv), 6)
    }
  })
})

describe('cross-game seed', () => {
  it('none without settled games; with them, conservative and capped at the Silver tier', () => {
    expect(crossGameSeed(emptyMeta(), 'stroop')).toBeNull()
    const meta: BrainMeta = { ...emptyMeta(), sk: { oddOneOut: { mu: 40, sd: 1, n: 200, day: 1 }, schulte: { mu: 34, sd: 1, n: 200, day: 1 } } }
    const seed = crossGameSeed(meta, 'stroop')
    expect(seed).not.toBeNull()
    expect(seed as number).toBeLessThanOrEqual(TIERS.stroop[1])
    // A barely-played game says nothing.
    expect(crossGameSeed({ ...emptyMeta(), sk: { oddOneOut: { mu: 40, sd: 9, n: 3, day: 1 } } }, 'stroop')).toBeNull()
  })
})

describe('achievements', () => {
  it('earned once, from game facts only', () => {
    const facts = { gameId: 'stroop' as const, endedBy: 'cap' as const, cleared: true, trials: 20, correct: 19, livesLost: 0, bestStreak: 12, spanLength: 0, flawlessHunt: false }
    const got = earnedByRound(facts, emptyProgress(), emptyMeta())
    expect(got).toEqual(expect.arrayContaining(['firstClear', 'cleanRound', 'streak10']))
    const meta = { ...emptyMeta(), ach: got.reduce((m, a) => setBit(m, achievementBit(a)), '') }
    expect(earnedByRound(facts, emptyProgress(), meta)).toEqual([])
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(15)
  })

  it('a round under half right is not "cleared"', () => {
    const facts = { gameId: 'sequence' as const, endedBy: 'cap' as const, cleared: false, trials: 14, correct: 3, livesLost: 0, bestStreak: 1, spanLength: 4, flawlessHunt: false }
    expect(earnedByRound(facts, emptyProgress(), emptyMeta())).not.toContain('firstClear')
    // The round's own verdict decides: a "Round over" summary never comes with a "cleared" badge.
    expect(earnedByRound({ ...facts, correct: 12 }, emptyProgress(), emptyMeta())).not.toContain('firstClear')
  })

  it('centre-only Quick Eye: the field stages are one stage (the puzzle on screen never changed)', () => {
    expect(quickEyeTierStage(9, true)).toBe(1)
    expect(quickEyeTierStage(10, true)).toBe(2)
    expect(quickEyeTierStage(9, false)).toBe(9)
    const p = { ...emptyProgress(), quickEye: { ...emptyProgress().quickEye, variant: 9 }, settings: { ...emptyProgress().settings, centerOnly: true } }
    const facts = { gameId: 'quickEye' as const, endedBy: 'stop' as const, cleared: false, trials: 3, correct: 3, livesLost: 0, bestStreak: 3, spanLength: 0, flawlessHunt: false }
    expect(earnedByRound(facts, p, emptyMeta())).not.toContain('quickEyeStage5')

  })

  it('a Quick Eye estimate never seeds a board game (it is a speed level, not a tier-scale level)', () => {
    expect(crossGameSeed({ ...emptyMeta(), sk: { quickEye: { mu: 8, sd: 1, n: 120, day: 1 } } }, 'oddOneOut')).toBeNull()
  })
})

describe('meta record', () => {
  it('bitmasks set, test and merge', () => {
    let m = ''
    for (const bit of [0, 5, 47]) m = setBit(m, bit)
    expect([0, 5, 47, 1, 46].map((b) => hasBit(m, b))).toEqual([true, true, true, false, false])
    expect(hasBit(orMask(setBit('', 3), setBit('', 60)), 60)).toBe(true)
    expect(orMask('', '')).toBe('')
  })

  it('round-trips, clamps, tolerates garbage, and stays small', () => {
    const meta: BrainMeta = {
      ...emptyMeta(),
      sk: Object.fromEntries(BRAIN_GAMES.map((g) => [g.id, { mu: 12.34, sd: 1.5, n: 1234, day: 1050 }])),
      tier: Object.fromEntries(BRAIN_GAMES.map((g) => [g.id, 4])),
      seen: MECHANICS.reduce((mask, _m, i) => setBit(mask, i), ''),
      ach: ACHIEVEMENTS.reduce((mask, _a, i) => setBit(mask, i), ''),
      practice: Object.fromEntries(BRAIN_GAMES.map((g) => [g.id, 4])),
      wipes: Object.fromEntries(BRAIN_GAMES.map((g) => [g.id, 1])),
      rt: Object.fromEntries(BRAIN_GAMES.map((g) => [g.id, 1234])),
      span1: { memoryGrid: 6, sequence: 5 },
      span2: { memoryGrid: 5, sequence: 4 },
    }
    const raw = serializeMeta(meta)
    expect(parseMeta(raw)).toEqual(meta)
    // Its own SecureStore value on mobile (~2KB).
    expect(raw.length).toBeLessThan(1900)
    expect(parseMeta('nope')).toEqual(emptyMeta())
    expect(parseMeta('{"v":1,"sk":{"stroop":{"mu":1e308,"sd":-1},"x":{}},"tier":{"stroop":99},"seen":"zz"}')).toMatchObject({ sk: { stroop: { mu: 500, sd: 0.1 } }, tier: { stroop: 6 }, seen: '' })
  })
})
