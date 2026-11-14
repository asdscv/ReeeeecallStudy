/**
 * The game logic behind "it no longer starts at level 1": placement finds a player's level in a
 * handful of trials and keeps the staircase's target, uncertainty scales the steps and grows with
 * time away, every rule a game introduces is detectable from its trial, tiers sit where the puzzle
 * changes and below every ceiling, cross-game seeding stays conservative, achievements are earned
 * once, and the compact meta record survives garbage.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BITS,
  BRAIN_GAMES,
  DEFAULT_CONTEXT,
  MECHANICS,
  PLACEMENT,
  RULE_CARDS_PER_ROUND,
  RULE_CARD_GAP,
  SKILL,
  TIERS,
  TIER_COUNT,
  achievementBit,
  blockedRules,
  brainGame,
  createRng,
  crossGameSeed,
  earnedByRound,
  emptyMeta,
  emptyProgress,
  hasBit,
  levelAtStanding,
  maxColsFor,
  mechanicInfo,
  nextSd,
  orMask,
  parseMeta,
  pCorrect,
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
  zestPlan,
  type BrainGameId,
  type BrainMeta,
} from '@reeeeecall/shared/lib/brain-games'

// Thousands of sampled trials per test: a second or three here, several times that on a CI runner,
// where the 5s default would time out.
vi.setConfig({ testTimeout: 30_000 })

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

  /**
   * The real init path for a game never played (useBrainRound): nothing known, so the first trial is
   * at level 3, then the plan's ZEST search; Number Hunt's three boards, each a strong pass.
   */
  function perfectHandover(id: BrainGameId, guess: number): { level: number; trials: number } {
    const plan = zestPlan(id)
    let p = startPlacement({ lo: 1, hi: plan.hi, mu0: 3, sigma0: 9, target: 0.85, slope: 2, maxMove: 3, minTrials: plan.minTrials, maxTrials: plan.maxTrials, tailMass: plan.tailMass, hotMove: plan.hotMove })
    let trials = 0
    while (!placementDone(p)) {
      const x = trials === 0 ? 3 : placementLevel(p)
      p = updatePlacement(p, x, true, guess, plan.graded ? 2 : 1)
      trials++
    }
    return { level: placementResult(p, plan.handoverK).level, trials }
  }

  it('a perfect responder is carried to near the top of the search (GAMES_DIFFICULTY_PLAN §2.3)', () => {
    for (const id of ['math', 'series', 'oddOneOut', 'stroop'] as const) {
      const plan = zestPlan(id)
      const { level, trials } = perfectHandover(id, 0.25)
      expect(level, id).toBeGreaterThanOrEqual(plan.hi - 3.5)
      // Continues while the last three are right, to the most trials.
      expect(trials, id).toBe(14)
    }
    expect(PLACEMENT.math).toMatchObject({ method: 'zest', hi: 26, minTrials: 8, maxTrials: 14, tailMass: 0.2, hotMove: 4, handoverK: 0.25 })
    expect([PLACEMENT.series, PLACEMENT.oddOneOut, PLACEMENT.stroop].map((x) => x && 'hi' in x && x.hi)).toEqual([20, 24, 24])
    // Number Hunt: exactly three boards, each cleared in under half its time.
    const hunt = perfectHandover('schulte', 0.02)
    expect(hunt.trials).toBe(3)
    expect(hunt.level).toBeGreaterThanOrEqual(12.5)
    expect([PLACEMENT.pairs, PLACEMENT.memoryGrid, PLACEMENT.sequence].map((x) => x?.method)).toEqual(['probe', 'fast', 'fast'])
  })

  it('the flat tail is really the share asked for; unset keeps the old prior', () => {
    const p = startPlacement({ lo: 1, hi: 26, mu0: 3, sigma0: 9, target: 0.85, slope: 2, maxMove: 3, minTrials: 8, maxTrials: 14, tailMass: 0.2 })
    const total = p.post.reduce((a, b) => a + b, 0)
    // The top of the range keeps at least the flat share of mass per point.
    expect(p.post[p.post.length - 1] / total).toBeGreaterThanOrEqual(0.2 / p.post.length - 1e-12)
    expect(total).toBeCloseTo(1, 9)
    const old = startPlacement({ lo: 1, hi: 26, mu0: 3, sigma0: 9, target: 0.85, slope: 2, maxMove: 3, minTrials: 8, maxTrials: 12 })
    expect(old.post[0]).toBeCloseTo(0.8 * Math.exp(-0.5 * (2 / 9) ** 2) + 0.2 / old.post.length, 9)
  })

  it('weight raises the likelihood; a strong pass allows the bigger step; the handover sits handoverK spreads below the mean', () => {
    const start = startPlacement({ lo: 1, hi: 20, mu0: 3, sigma0: 9, target: 0.85, slope: 2, maxMove: 3, minTrials: 3, maxTrials: 3, tailMass: 0.2, hotMove: 5 })
    const once = updatePlacement(start, 3, true, 0.02)
    const twice = updatePlacement(once, 3, true, 0.02)
    const weighted = updatePlacement(start, 3, true, 0.02, 2)
    weighted.post.forEach((w, i) => expect(w).toBeCloseTo(twice.post[i], 9))
    // After an ordinary right answer the step is capped at maxMove; after a strong one at hotMove.
    expect(placementLevel(once)).toBeLessThanOrEqual(3 + 3)
    expect(placementLevel(weighted)).toBeGreaterThan(3 + 3)
    expect(placementLevel(weighted)).toBeLessThanOrEqual(3 + 5)
    const a = placementResult(weighted, 0.5)
    const b = placementResult(weighted, 0.25)
    expect(b.level - a.level).toBeCloseTo(0.25 * a.sd, 6)
  })

  it('rule gating: placement and practice block every unseen rule; a counted trial lets only the lowest through, two cards a round, three counted trials apart', () => {
    const fresh = { shown: 0, countedSinceLast: null }
    for (const { id } of BRAIN_GAMES) {
      const rules = MECHANICS.filter((m) => m.game === id && m.kind === 'rule' && !m.retired)
      const tags = rules.map((m) => m.tag).sort()
      const live = [...rules].sort((a, b) => a.from - b.from)
      const none = () => false
      expect(blockedRules(id, none, 'placement', fresh).sort(), id).toEqual(tags)
      expect(blockedRules(id, none, 'practice', fresh).sort(), id).toEqual(tags)
      const counted = blockedRules(id, none, 'counted', fresh)
      expect(counted.sort(), id).toEqual(tags.filter((t) => t !== live[0]?.tag))
      expect(blockedRules(id, none, 'intro', fresh).sort(), id).toEqual(counted)
      // The card budget: two a round, then everything; under three counted trials since the last, everything.
      expect(blockedRules(id, none, 'counted', { shown: RULE_CARDS_PER_ROUND, countedSinceLast: 10 }).sort(), id).toEqual(tags)
      expect(blockedRules(id, none, 'counted', { shown: 1, countedSinceLast: RULE_CARD_GAP - 1 }).sort(), id).toEqual(tags)
      expect(blockedRules(id, none, 'counted', { shown: 1, countedSinceLast: RULE_CARD_GAP }).sort(), id).toEqual(counted)
      // Every rule met: nothing to block.
      expect(blockedRules(id, () => true, 'placement', fresh), id).toEqual([])
      // The lowest met: the next one in `from` order is let through.
      if (live.length >= 2) {
        const seen = (tag: string) => tag === live[0].tag
        expect(blockedRules(id, seen, 'counted', fresh), id).not.toContain(live[1].tag)
        expect(blockedRules(id, seen, 'counted', fresh), id).not.toContain(live[0].tag)
      }
    }
    // Number Hunt's first card is the lowest rule (descending), never reshuffle.
    expect(blockedRules('schulte', () => false, 'counted', fresh)).toContain('schulte.reshuffle')
    expect(blockedRules('schulte', () => false, 'counted', fresh)).not.toContain('schulte.descending')
    expect(RULE_CARDS_PER_ROUND).toBe(2)
    expect(RULE_CARD_GAP).toBe(3)
  })
})

describe('skill estimate', () => {
  it('k is 1 once settled, up to kMax while unsure; span never scales', () => {
    expect(stepMultiplier('speed', SKILL.speed.floor)).toBe(1)
    expect(stepMultiplier('speed', 100)).toBe(SKILL.speed.kMax)
    expect(stepMultiplier('span', 10)).toBe(1)
    // A game's own kMax (Match Pairs 1.5) caps it lower.
    expect(stepMultiplier('speed', 100, 1.5)).toBe(1.5)
    expect(stepMultiplier('speed', SKILL.speed.floor, 1.5)).toBe(1)
    expect(brainGame('pairs').steps).toEqual({ scale: 2, kMax: 1.5 })
  })

  it('a run of 4+ right answers re-opens the speed estimate a little (never past sd0); anything else shrinks it', () => {
    expect(nextSd('speed', 2, false, 4)).toBeCloseTo(2.2)
    expect(nextSd('speed', 8.5, false, 9)).toBe(SKILL.speed.sd0)
    expect(nextSd('speed', 2, false, 3)).toBeCloseTo(2 * 0.92)
    expect(nextSd('speed', 2, true, 0)).toBeCloseTo(2 * 0.7)
    expect(nextSd('speed', SKILL.speed.floor, false, 0)).toBe(SKILL.speed.floor)
    // Only the speed group; the span group keeps shrinking.
    expect(nextSd('span', 2, false, 6)).toBeCloseTo(2 * 0.92)
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
  // Desktop 7×7 and a phone 5×7 (the boards that reach every grid size).
  const contexts = [DEFAULT_CONTEXT, { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 }]
  // No longer made (retired): nothing produces them.
  const live = MECHANICS.filter((m) => !m.retired)

  it('no entry is registered ahead of its game: every line is live or retired, nothing pending', () => {
    // The hard-content block was registered with a temporary `pending` flag while each game was
    // rebuilt; every game now produces its lines, so the flag is gone for good. Only the fields
    // below exist — a new temporary flag would need a test of its own.
    const allowed = new Set(['tag', 'game', 'kind', 'from', 'copy', 'retired'])
    for (const m of MECHANICS) {
      expect(Object.keys(m).filter((k) => !allowed.has(k)), m.tag).toEqual([])
      expect('pending' in m, m.tag).toBe(false)
    }
    // Retired: Quick Eye's five (the game was removed, owner 2026-11-13), Odd One Out's turned glyph
    // (owner 2026-11-13) and its emoji near-twins (§2.10).
    expect(MECHANICS.filter((m) => m.retired).map((m) => m.tag)).toEqual([
      'quickEye.periphery', 'quickEye.distractors', 'quickEye.similar', 'quickEye.sameDiff',
      'oddOneOut.rotation', 'oddOneOut.nearTwin', 'quickEye.clearView', 'makeNumber.tiles5',
    ])
    // Every mechanic of a game no longer in the catalogue is retired.
    for (const m of MECHANICS) if (!BRAIN_GAMES.some((g) => g.id === m.game)) expect(m.retired, m.tag).toBe(true)
  })

  it('every live mechanic is produced by some trial, and games report only registered ones', () => {
    const produced = new Set<string>()
    for (const { id, def } of BRAIN_GAMES) {
      const levels = [...Array.from({ length: 41 }, (_, i) => i + 1), 50, 60]
      for (const ctx of contexts) {
        for (const level of levels) {
          for (let seed = 1; seed <= 25; seed++) {
            const s = def.create(level, createRng(seed * 977 + level), ctx)
            for (const tag of def.mechanics(s)) {
              expect(mechanicInfo(tag), `${id} reported unknown tag ${tag}`).toBeDefined()
              expect(mechanicInfo(tag)?.game).toBe(id)
              produced.add(tag)
            }
          }
        }
      }
    }
    const missing = live.map((m) => m.tag).filter((t) => !produced.has(t))
    expect(missing).toEqual([])
  })

  it('a rule never appears below its stated level (cards come when the rule really starts)', () => {
    for (const m of live.filter((x) => x.kind === 'rule')) {
      const def = brainGame(m.game as Parameters<typeof brainGame>[0]).def
      for (let seed = 1; seed <= 200; seed++) {
        // Span levels act as whole lengths (rounded), so stay a full step below.
        const level = Math.max(1, m.from - (brainGame(m.game as Parameters<typeof brainGame>[0]).group === 'span' ? 1 : 0.5))
        const s = def.create(level, createRng(seed), DEFAULT_CONTEXT)
        expect(def.mechanics(s).includes(m.tag), `${m.tag} at ${level}`).toBe(false)
      }
    }
  })

  it('bits never move: one tag each, its game is its prefix, the hard-content block starts at 49', () => {
    expect(new Set(MECHANICS.map((m) => m.tag)).size).toBe(MECHANICS.length)
    for (const m of MECHANICS) expect(m.tag.split('.')[0], m.tag).toBe(m.game)
    expect(mechanicInfo('quickEye.clearView')?.bit).toBe(48)
    const appended = [
      'math.missing', 'math.threeDigit', 'math.parens', 'math.bigMul',
      'series.halving', 'series.altOps', 'series.mixedLines', 'series.growFactor', 'series.tribonacci', 'series.threeLines',
      'series.diffGrowing', 'series.opCycle', 'series.diffLines', 'series.diffFib', 'series.cubes', 'series.missingTerm',
      'oddOneOut.colorNoise', 'oddOneOut.mirror', 'oddOneOut.absent', 'oddOneOut.glyphTwin',
      'schulte.twoDigit', 'schulte.skipCount', 'schulte.alternate', 'schulte.alternateOpposite', 'schulte.unmarked',
      'stroop.shuffle', 'stroop.labelInk', 'stroop.switchOften', 'stroop.frame',
      'memoryGrid.waves',
      'pairs.lookalike', 'pairs.triples',
    ]
    appended.forEach((tag, i) => {
      expect(mechanicInfo(tag)?.bit, tag).toBe(49 + i)
      // Each has its own copy, `mechanics.<game>.<name>`.
      expect(mechanicInfo(tag)?.copy, tag).toBe(tag)
    })
    // The released table ends there (bit 80); later blocks only append after it.
    expect(MECHANICS.length).toBeGreaterThanOrEqual(49 + appended.length)
    const rules = ['math.missing', 'series.missingTerm', 'oddOneOut.mirror', 'oddOneOut.absent', 'schulte.alternate', 'schulte.alternateOpposite', 'stroop.labelInk', 'pairs.triples']
    for (const tag of appended) expect(mechanicInfo(tag)?.kind, tag).toBe(rules.includes(tag) ? 'rule' : 'board')
  })

  it("the thinking games' block (2026-11-13): appended after the released table, one contiguous block in this order, rules where a new kind of content starts", () => {
    const block: [tag: string, kind: 'rule' | 'board', from: number, copy: string][] = [
      ['setMatch.board6', 'board', 2, 'board.moreCards'],
      ['setMatch.board9', 'board', 6, 'board.moreCards'],
      ['setMatch.color', 'rule', 4, 'setMatch.color'],
      ['setMatch.board12', 'board', 7, 'board.moreCards'],
      ['setMatch.fill', 'rule', 8, 'setMatch.fill'],
      ['setMatch.oneSet', 'board', 13, 'setMatch.oneSet'],
      ['setMatch.none', 'rule', 16, 'setMatch.none'],
      ['setMatch.board15', 'board', 18, 'board.moreCards'],
      ['codeBreak.three', 'board', 4, 'codeBreak.three'],
      ['codeBreak.four', 'board', 8, 'codeBreak.four'],
      ['codeBreak.zero', 'board', 12, 'codeBreak.zero'],
      ['codeBreak.repeats', 'rule', 13, 'codeBreak.repeats'],
      ['codeBreak.five', 'board', 19, 'codeBreak.five'],
      ['makeNumber.target24', 'board', 16, 'makeNumber.target24'],
      ['makeNumber.tiles4', 'board', 2, 'board.moreNumbers'],
      ['makeNumber.multiply', 'rule', 3, 'makeNumber.multiply'],
      ['makeNumber.divide', 'rule', 5, 'makeNumber.divide'],
      ['makeNumber.brackets', 'rule', 13, 'makeNumber.brackets'],
      ['makeNumber.tiles5', 'board', 3, 'board.moreNumbers'],
      ['makeNumber.fraction', 'rule', 17, 'makeNumber.fraction'],
      // Maze Run's ladder (games/maze-run.ts): sizes, keys from L11, hidden walls from L16, both from L21.
      ['mazeRun.grid6', 'board', 3, 'board.biggerGrid'],
      ['mazeRun.grid8', 'board', 5, 'board.biggerGrid'],
      ['mazeRun.keys', 'rule', 11, 'mazeRun.keys'],
      ['mazeRun.twoKeys', 'board', 13, 'mazeRun.moreKeys'],
      ['mazeRun.hidden', 'rule', 16, 'mazeRun.hidden'],
      ['mazeRun.threeKeys', 'board', 15, 'mazeRun.moreKeys'],
      ['mazeRun.hiddenKeys', 'board', 21, 'mazeRun.hiddenKeys'],
    ]
    const first = mechanicInfo(block[0][0])!.bit
    expect(first, 'after the released table (bits 0-80)').toBeGreaterThan(80)
    block.forEach(([tag, kind, from, copy], i) => {
      const m = mechanicInfo(tag)
      expect(m, tag).toMatchObject({ bit: first + i, kind, from, copy })
      expect(m?.retired, tag).toBe(tag === 'makeNumber.tiles5' ? true : undefined)
    })
  })

})

describe('tiers', () => {
  // A phone 5×7, and 4 columns × 7 rows (Match Pairs' and Flash Grid's narrower boards).
  const phones = [
    { ...DEFAULT_CONTEXT, maxCols: maxColsFor(358), maxRows: 7 },
    { ...DEFAULT_CONTEXT, maxCols: 4, maxRows: 7 },
  ]

  it('six thresholds per game, rising, and every one reachable below the level ceiling on a phone', () => {
    for (const { id, def } of BRAIN_GAMES) {
      const t = TIERS[id]
      expect(t).toHaveLength(TIER_COUNT)
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1])
      for (const ctx of phones) {
        const cap = def.maxLevel?.(ctx) ?? Infinity
        expect(t[5], `${id} master below its cap on ${ctx.maxCols}x${ctx.maxRows}`).toBeLessThan(cap)
      }
    }
  })

  it('thresholds sit where the puzzle changes (GAMES_DIFFICULTY_PLAN §2.10)', () => {
    expect(TIERS).toMatchObject({
      oddOneOut: [6, 11, 16, 21, 26, 31],
      schulte: [3, 6, 10, 14, 16, 21],
      stroop: [3, 7, 10, 14, 20, 27],
      math: [3, 6, 10, 13, 18, 23],
      series: [3, 6, 9, 12, 15, 20],
      pairs: [3, 6, 8, 11, 13, 15],
      memoryGrid: [3, 4, 6, 7, 9, 12],
      sequence: [2, 3, 4, 5, 6, 8],
    })
  })

  it('tier and progress toward the next', () => {
    expect(tierFor('stroop', 2)).toBe(0)
    expect(tierFor('stroop', 8)).toBe(2)
    expect(tierFor('stroop', 99)).toBe(6)
    expect(tierProgress('stroop', 5.5)).toMatchObject({ tier: 1, next: 7 })
    expect(tierProgress('stroop', 99).next).toBeNull()
  })

  it('standing and its inverse round-trip', () => {
    for (const { id } of BRAIN_GAMES) {
      for (const lv of [2, 5, 9, 13].filter((x) => x <= TIERS[id][5])) expect(levelAtStanding(id, standing(id, lv))).toBeCloseTo(Math.max(1, lv), 6)
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
    expect(ACHIEVEMENT_BITS.length).toBeLessThanOrEqual(15)
  })

  it('a round under half right is not "cleared"', () => {
    const facts = { gameId: 'sequence' as const, endedBy: 'cap' as const, cleared: false, trials: 14, correct: 3, livesLost: 0, bestStreak: 1, spanLength: 4, flawlessHunt: false }
    expect(earnedByRound(facts, emptyProgress(), emptyMeta())).not.toContain('firstClear')
    // The round's own verdict decides: a "Round over" summary never comes with a "cleared" badge.
    expect(earnedByRound({ ...facts, correct: 12 }, emptyProgress(), emptyMeta())).not.toContain('firstClear')
  })

  it("Quick Eye's two stage achievements are retired (the game was removed, owner 2026-11-13): their bits stay, never earned or listed", () => {
    // Append-only: the bits after them never moved.
    expect(ACHIEVEMENT_BITS.indexOf('quickEyeStage5')).toBe(6)
    expect(ACHIEVEMENT_BITS.indexOf('quickEyeStage10')).toBe(7)
    expect(achievementBit('allGames')).toBe(8)
    expect(achievementBit('masterTier')).toBe(14)
    expect(ACHIEVEMENTS as readonly string[]).not.toContain('quickEyeStage5')
    expect(ACHIEVEMENTS as readonly string[]).not.toContain('quickEyeStage10')
    expect(ACHIEVEMENTS).toHaveLength(ACHIEVEMENT_BITS.length - 2)
    // An old save far along the old stages, with a gold Quick Eye tier: nothing comes of either.
    const p = { ...emptyProgress(), quickEye: { ...emptyProgress().quickEye, variant: 16 } }
    const facts = { gameId: 'stroop' as const, endedBy: 'stop' as const, cleared: false, trials: 3, correct: 3, livesLost: 0, bestStreak: 3, spanLength: 0, flawlessHunt: false }
    const got: string[] = earnedByRound(facts, p, { ...emptyMeta(), tier: { quickEye: 6 } as BrainMeta['tier'] })
    expect(got).not.toContain('quickEyeStage5')
    expect(got).not.toContain('quickEyeStage10')
    expect(got).not.toContain('goldTier')
    expect(got).not.toContain('masterTier')
    // A bit already earned in an old save stays set (and is simply not listed).
    const old = parseMeta(serializeMeta({ ...emptyMeta(), ach: setBit('', 6) }))
    expect(hasBit(old.ach, 6)).toBe(true)
  })

  it("an old save's Quick Eye estimate never seeds a board game, and its meta still reads and round-trips", () => {
    const meta = parseMeta(JSON.stringify({ v: 2, sk: { quickEye: { mu: 8, sd: 1, n: 120, day: 1 } }, tier: { quickEye: 4 }, rt: { quickEye: 900 } }))
    expect((meta.sk as Record<string, unknown>).quickEye).toEqual({ mu: 8, sd: 1, n: 120, day: 1 })
    expect(parseMeta(serializeMeta(meta))).toEqual(meta)
    expect(crossGameSeed(meta, 'oddOneOut')).toBeNull()
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
      ach: ACHIEVEMENT_BITS.reduce((mask, _a, i) => setBit(mask, i), ''),
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
    expect(parseMeta('{"v":2,"sk":{"stroop":{"mu":1e308,"sd":-1},"x":{}},"tier":{"stroop":99},"seen":"zz"}')).toMatchObject({ sk: { stroop: { mu: 500, sd: 0.1 } }, tier: { stroop: 6 }, seen: '' })
  })
})
