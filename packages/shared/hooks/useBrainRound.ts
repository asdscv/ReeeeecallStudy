import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  type AchievementId,
  type BrainGameId,
  type BrainMeta,
  type CreateContext,
  type GameGroup,
  type PlacementState,
  type RecentTrial,
  type RoundOutcome,
  type RoundView,
  type TimingMode,
  DEFAULT_CONTEXT,
  GROUP_RULES,
  MECHANICS,
  PRACTICE_TRIALS,
  SKILL,
  achievementBit,
  blockedRules,
  brainGame,
  createRng,
  crossGameSeed,
  dayNumber,
  displayLevel,
  earnedByRound,
  emptyMeta,
  gameProgress,
  hasBit,
  legacySd,
  localDayKey,
  mechanicInfo,
  nextSd,
  placementDone,
  placementHandover,
  placementLevel,
  randomSeed,
  recentMedian,
  restartLevel,
  roundEstimate,
  roundPoints,
  scaledLimit,
  sdAfterDays,
  setBit,
  startFromEstimate,
  startPlacement,
  stepLevel,
  stepMultiplier,
  tierFor,
  updatePlacement,
  zestPlan,
} from '../lib/brain-games'
import { useBrainStore } from '../stores/brain-store'

/**
 * One round of one game — trials until the chances run out, the round's cap is reached, or the
 * player stops. Web and mobile only draw `view` and call `tap`; every timer and every rule lives
 * here, so the two platforms cannot drift.
 *
 * The game logic of a round, in order:
 *   practice (first time only; ends after 2 right in a row) → placement (a game never played:
 *   finds the level in ~8 trials, no chances spent) → counted trials (the staircase, its steps
 *   scaled by how unsure the game still is) → round end (the round's estimate, the next start,
 *   tier, achievements, score bonuses).
 * A rule the player has not met yet stops its first trial with a card, and that trial is unscored;
 * a bigger board gets a short notice. See lib/brain-games/{rules,skill,placement,mechanics,tiers}.ts.
 *
 * The board games since the hard-content change (GAMES_DIFFICULTY_PLAN §2.3-2.9): one placement
 * path for a game never played, a pre-estimate record or a re-opened estimate (ZEST; Number Hunt's
 * three graded boards); Match Pairs' probe ladder; the span games' fast entry; unseen rules gated
 * (ctx.blockRules — at most two cards a round, three counted trials apart); setup time (practice,
 * placement, rule-card trials) kept out of a Today's Training slot.
 */
export interface PlatformContext {
  /** Widest grid with cells ≥ 56dp on this screen (see maxColsFor). */
  maxCols: number
  /** Tallest grid with cells ≥ 56dp on this screen (see maxRowsFor). Unset: 7. */
  maxRows?: number
}

/** practice: first-time tutorial · intro: right after a new-rule card · placement: finding the start · counted: the real thing. */
export type TrialKind = 'practice' | 'intro' | 'placement' | 'counted'

export interface TrialResult {
  correct: boolean
  /** 0..1, how much of the trial was right. */
  accuracy: number
  timedOut: boolean
  /** The trial did not count (its outcome said `void`) and is being replaced. */
  void: boolean
  /** Unscored: a practice trial or the trial right after a new-rule card. */
  practice: boolean
  kind: TrialKind
  points: number
  livesLost: number
  levelBefore: number
  levelAfter: number
}

export interface ScoreParts {
  /** Difficulty × right answers. */
  base: number
  /** Faster than the player's own recent median. */
  speed: number
  /** The run of right answers. */
  combo: number
  /** Reaching the round's end with at least half right. */
  clear: number
  /** …and without losing a chance. */
  clean: number
}

export interface RoundStats {
  trials: number
  correct: number
  points: number
  streak: number
  bestStreak: number
  levelStart: number
  levelEnd: number
  /** Span games: the longest length passed. Others: the highest level reached. */
  bestLevel: number
  startedAt: number
  /** Time actually played, ms — wall clock minus paused time. Set when the round ends. */
  activeMs: number
  /**
   * Of `activeMs`, the time spent setting up rather than playing: practice, placement (Match
   * Pairs' probe boards) and rule-card trials, at most 2 minutes a round. Today's Training keeps it
   * out of the slot, so a first day's setup does not eat the game's minutes.
   */
  setupMs: number
  /**
   * 'void': the round stopped itself after many trials in a row that could not count. 'time': its time budget (a Today's Training slot) ran out — it ends after the trial in
   * play, as a normal ending, not a quit.
   */
  endedBy: 'lives' | 'cap' | 'stop' | 'void' | 'time' | null
  /** Reached the round's end with at least half its counted trials right — what "cleared" means. */
  cleared: boolean
  /**
   * The round opened with placement: 'done' = it found the start (levelStart is where the staircase
   * took over), 'partial' = stopped before it did (no level to show yet). Never a result to announce.
   */
  placement: 'none' | 'done' | 'partial'
  isNewBest: boolean
  score: ScoreParts
  /** A tier reached in this round (1-6), to celebrate once. */
  tierUp: number | null
  /** Achievements earned in this round. */
  achievements: AchievementId[]
  /** Rounds in a row ended early on chances: offer relaxed timing (a suggestion, never automatic). */
  suggestRelax: boolean
}

interface State {
  gameId: BrainGameId
  group: GameGroup
  platform: PlatformContext
  timing: TimingMode
  // Each game's state is private to that game.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  round: any
  trialId: number
  level: number
  /** Where this round started (restored when a round is too short to say anything). */
  startLevel: number
  trialKind: TrialKind
  trialInRound: number
  /** Counted trials (the staircase's): drives the round cap, the estimate and the start rule. */
  counted: number
  countedCorrect: number
  /** Span games: the longest length passed on a counted trial this round (0 = none). */
  spanPassed: number
  /** First round of a span game or Match Pairs: where play starts once practice (at the floor) is done. */
  seedLevel: number | null
  practiceLeft: number
  practiceDone: number
  practiceStreak: number
  /** Unscored trials still to come after a new-rule card. */
  introLeft: number
  /** The rule card holding this trial, until the player has read it. */
  intro: { tag: string } | null
  /** A short notice for a bigger board, shown between trials. */
  toast: { tag: string; id: number } | null
  /** Rules met in this round (persisted as they are met). */
  seenAdded: string[]
  seenMask: string
  /** The game had counted rounds before this one (new-board notices only for a returning game). */
  playedBefore: boolean
  place: PlacementState | null
  placed: boolean
  placementTrials: number
  sd: number
  reversals: number[]
  lastDir: 0 | 1 | -1
  livesLostTotal: number
  misses: number
  flawlessHunt: boolean
  inputStartedAt: number | null
  timedOut: boolean
  result: TrialResult | null
  lives: number
  over: boolean
  /** The round's end has been recorded (best score, next start level) — `stats` is final. */
  finalized: boolean
  /** Paused — by the player, or by a rule card. Every clock stops; the input clock resumes where it was. */
  paused: boolean
  pausedAt: number | null
  pausedMs: number
  voidRun: number
  recentSigs: string[]
  correctRts: number[]
  stats: RoundStats
  /** The level a placement's first trial is played at when nothing is known yet; null = the placement's own pick. */
  placeStart: number | null
  /** When the trial's result came in (the reveal can be skipped REVEAL_SKIP_AFTER_MS later). */
  resultAt: number | null
  revealSkipped: boolean
  /** Fixed for the round (ctx.roundSeed: Color Word's colour subset). */
  roundSeed: number
  /** The round's last two trials as the game described them (ctx.recent). */
  recent: RecentTrial[]
  /** Rule cards this round has shown, and the counted-trial count when it showed the last one. */
  cardsShown: number
  cardAt: number | null
  /** Counted right answers in a row (the staircase's up-run: nextSd). */
  upRun: number
  /** Span fast entry: +2 per first-try pass until the first miss (a probe — no chance spent). */
  fastEntry: boolean
  /** Match Pairs' probe ladder: boards played, the level of the next one, whether any was cleared. */
  probe: { board: number; level: number; passed: boolean } | null
  /** When the trial in play was created, and the round's paused time then (setup time is measured per trial). */
  trialAt: number
  trialPausedMs: number
}

type Action =
  | { type: 'advance'; now: number }
  | { type: 'tap'; index: number; now: number }
  | { type: 'timeout'; now: number }
  | { type: 'inputStarted'; now: number }
  | { type: 'next'; level: number; seed: number; now: number }
  | { type: 'end'; reason: 'lives' | 'cap' | 'stop' | 'void' | 'time'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'ackIntro'; now: number }
  | { type: 'skipReveal'; now: number }
  | { type: 'best'; isNewBest: boolean; tierUp: number | null; achievements: AchievementId[]; suggestRelax: boolean }

const RECENT_SIGS = 24
const END_AFTER_VOIDS = 8
/**
 * How long a trial's answer stays up: longer when it shows something to read (a miss's worked line,
 * a pattern's rule), and then skippable after REVEAL_SKIP_AFTER_MS. A void trial has no answer.
 */
const REVEAL = { right: 700, rightWithRule: 1300, wrong: 1500, wrongWithReveal: 2400, void: 500 }
const REVEAL_SKIP_AFTER_MS = 500
/** Rounds this short (counted trials) say too little to move the next start. */
const SHORT_ROUND = { speed: 5, span: 2 }
/** Setup time kept out of a Today's Training slot, at most (per round). */
const SETUP_CAP_MS = 120_000
/** A span game away this long re-enters fast (§2.6). */
const FAST_ENTRY_AFTER_DAYS = 14
/** Match Pairs' probe ladder: the first board's level, the step after a clean clear, the most boards, the sd it hands over with, the start when no board passed. */
const PROBE = { start: 3, clean: 3, boards: 4, sd: 2, none: 2 } as const

type CtxSource = Pick<State, 'platform' | 'lives'> & Partial<Pick<State, 'roundSeed' | 'recent'>>

/** What a trial is built with. `trial` is what the round knows about this one: its kind and the rules it must not use. */
function buildCtx(s: CtxSource, trial: { kind: TrialKind; blockRules: readonly string[] } = { kind: 'counted', blockRules: [] }): CreateContext {
  return {
    ...DEFAULT_CONTEXT,
    maxCols: s.platform.maxCols,
    maxRows: s.platform.maxRows ?? DEFAULT_CONTEXT.maxRows,
    livesLeft: s.lives,
    trialKind: trial.kind,
    blockRules: trial.blockRules,
    recent: s.recent ?? [],
    roundSeed: s.roundSeed ?? DEFAULT_CONTEXT.roundSeed,
  }
}

/** The level past which this game's puzzle stops changing on this screen. */
function levelCap(gameId: BrainGameId, s: Pick<State, 'platform' | 'lives'>): number {
  const def = brainGame(gameId).def
  return def.maxLevel ? def.maxLevel(buildCtx(s)) : Infinity
}

function createTrial(gameId: BrainGameId, level: number, seed: number, ctx: CreateContext, recentSigs: string[]) {
  const def = brainGame(gameId).def
  const rng = createRng(seed)
  let round = def.create(level, rng, ctx)
  for (let i = 0; i < 6 && recentSigs.includes(def.signature(round)); i++) round = def.create(level, rng, ctx)
  const info = def.trialInfo?.(round)
  const recent: RecentTrial = { level, kind: info?.kind ?? '', ...(info?.carry !== undefined ? { carry: info.carry } : {}) }
  return { round, sig: def.signature(round) as string, recent }
}

/** A rule (or board change) already met: stored, or met earlier in this round. */
function seenTag(s: Pick<State, 'seenMask' | 'seenAdded'>, tag: string): boolean {
  const info = mechanicInfo(tag)
  return !info || hasBit(s.seenMask, info.bit) || s.seenAdded.includes(tag)
}

/**
 * The rules a new trial must not use (§2.4). Match Pairs' probe boards gate like counted trials, so
 * the first one can open with the no-preview card (it still counts as probe board 1).
 */
function gateRules(s: Pick<State, 'gameId' | 'seenMask' | 'seenAdded' | 'cardsShown' | 'cardAt' | 'counted' | 'probe'>, kind: TrialKind): readonly string[] {
  const asKind: TrialKind = s.probe && kind === 'placement' ? 'counted' : kind
  return blockedRules(s.gameId, (tag) => seenTag(s, tag), asKind, { shown: s.cardsShown, countedSinceLast: s.cardAt === null ? null : s.counted - s.cardAt })
}

/** Setup (practice, placement, a rule card's trial) as opposed to play — kept out of a Today's Training slot. */
function isSetupTrial(s: Pick<State, 'trialKind'>): boolean {
  return s.trialKind !== 'counted'
}

/** `stats.setupMs` with the trial in play closed at `now` (paused time excluded). */
function setupThrough(s: Pick<State, 'gameId' | 'trialKind' | 'trialAt' | 'trialPausedMs' | 'stats'>, now: number, pausedMs: number): number {
  if (!isSetupTrial(s)) return s.stats.setupMs
  return Math.min(SETUP_CAP_MS, s.stats.setupMs + Math.max(0, now - s.trialAt - (pausedMs - s.trialPausedMs)))
}

/**
 * The span fast entry's jump: +2, but never past the game's next rule — Sequence's reverse rule is
 * at L4, so L3 + 2 is L4 (its card then comes on that trial).
 */
function fastJump(gameId: BrainGameId, level: number): number {
  const nextRule = MECHANICS.filter((m) => m.game === gameId && m.kind === 'rule' && !m.retired && m.from > level)
    .reduce((lo, m) => Math.min(lo, m.from), Infinity)
  return Math.min(level + 2, nextRule)
}

/** The level a placement trial is played at (Match Pairs' probe: its board's level). */
function placeLevel(s: Pick<State, 'place' | 'placeStart'> & Partial<Pick<State, 'probe'>>): number {
  if (s.probe) return s.probe.level
  if (!s.place) return 0
  return s.placeStart !== null && s.place.n === 0 ? s.placeStart : placementLevel(s.place)
}

/**
 * What a new trial introduces. A rule not met before stops the trial with a card (a trial must not
 * open on an unexplained rule with its clock running); a board change not met before gets a short
 * notice when the game is being played again (a first round has its practice and demo for that).
 */
function introduce(s: State, now: number): State {
  const def = brainGame(s.gameId).def
  const tags = def.mechanics(s.round)
  const seen = (tag: string) => seenTag(s, tag)
  if (s.trialKind === 'practice') {
    // Practice is level-one basics: a board it shows counts as met. A rule never does — its card
    // still comes the first time it counts.
    const fresh = tags.filter((t) => mechanicInfo(t)?.kind === 'board' && !seen(t))
    return fresh.length ? { ...s, seenAdded: [...s.seenAdded, ...fresh] } : s
  }
  let next = s
  const boards = tags.filter((t) => mechanicInfo(t)?.kind === 'board' && !seen(t))
  if (boards.length) {
    const announce = s.playedBefore && s.trialKind !== 'placement'
    next = { ...next, seenAdded: [...next.seenAdded, ...boards], toast: announce ? { tag: boards[boards.length - 1], id: s.trialId } : next.toast }
  }
  const rule = tags.find((t) => mechanicInfo(t)?.kind === 'rule' && !seen(t))
  if (rule) {
    next = {
      ...next,
      intro: { tag: rule },
      introLeft: 1,
      trialKind: 'intro',
      paused: true,
      pausedAt: now,
      // The round's card budget (§2.4).
      cardsShown: s.cardsShown + 1,
      cardAt: s.counted,
    }
  }
  return next
}

/** Chance of a right answer by guessing, for placement's model. */
function guessRate(view: RoundView): number {
  if (view.kind === 'choice') return 1 / Math.max(2, view.options.length)
  return 0.02
}

function trialLimit(s: Pick<State, 'gameId' | 'round' | 'timing' | 'trialKind'>): number | null {
  const base = scaledLimit(brainGame(s.gameId).def.timeLimitMs(s.round), s.timing)
  // The trial right after a rule card is played at twice the time: it is for learning the rule.
  return base === null ? null : s.trialKind === 'intro' ? base * 2 : base
}

/** Where the staircase takes over from a placement: a quarter of the posterior's spread below its mean (the game's plan). */
function handoverK(gameId: BrainGameId): number {
  return zestPlan(gameId).handoverK
}

/**
 * Number Hunt's graded placement evidence (§2.3): a board cleared in at most half its time says
 * twice as much (and allows a bigger step after it); a timeout with 80% of the numbers found, half.
 * The input clock already leaves paused time out (resume moves its start).
 */
function placementWeight(state: State, round: State['round'], outcome: RoundOutcome, rt: number | null, timedOut: boolean): number {
  if (!zestPlan(state.gameId).graded) return 1
  if (outcome.correct) {
    const limit = trialLimit({ ...state, round })
    return limit !== null && rt !== null && rt / limit <= 0.5 ? 2 : 1
  }
  return timedOut && outcome.accuracy >= 0.8 ? 0.5 : 1
}

/**
 * One Match Pairs probe board (§2.7) — a placement board: no lives, no score, no round stats. A
 * clean clear (at most one informed miss) goes +3 to the next board; a clear with more stops; a
 * failed board stops. After at most four boards the staircase takes over half a level below the
 * last board actually passed (L2 if none passed), unsure (sd 2) — the plan's rule. It used to take
 * over half a level below the level the passes had REACHED (the failed board, or a messy pass + 1),
 * which put an average 70-year-old 2.5 levels and a slow 75-year-old 2 levels above their own
 * level for round 1: 69-72% right, one round in five over before 8 boards (persona simulation).
 */
function judgeProbe(state: State, round: State['round'], outcome: RoundOutcome, timedOut: boolean, base: Omit<TrialResult, 'practice' | 'points' | 'levelAfter'>): State {
  const probe = state.probe as NonNullable<State['probe']>
  const cap = levelCap(state.gameId, state)
  const board = probe.board + 1
  const clean = outcome.correct && (outcome.informedMisses ?? 0) <= 1
  const level = probe.level + PROBE.clean
  const passed = probe.passed || outcome.correct
  // A placement board even when a rule card opened it (no level-up fx, and it is saved as a placement trial).
  const res = { ...base, kind: 'placement' as const, practice: false, points: 0 }
  const common = {
    ...state,
    round,
    timedOut,
    voidRun: 0,
    introLeft: state.trialKind === 'intro' ? Math.max(0, state.introLeft - 1) : state.introLeft,
    placementTrials: state.placementTrials + 1,
  }
  if (clean && board < PROBE.boards && level <= cap) {
    return { ...common, probe: { board, level, passed }, result: { ...res, levelAfter: level } }
  }
  // The last board passed: this one, or (it failed) the clean pass before it, which was PROBE.clean lower.
  const lastPassed = outcome.correct ? probe.level : probe.passed ? probe.level - PROBE.clean : null
  const start = lastPassed === null ? Math.min(cap, PROBE.none) : Math.max(GROUP_RULES[state.group].min, Math.min(cap, lastPassed) - 0.5)
  return {
    ...common,
    probe: null,
    placed: true,
    sd: PROBE.sd,
    result: { ...res, levelAfter: start },
    // The handover is where this round's own climb starts.
    stats: { ...state.stats, levelStart: start, levelEnd: start, bestLevel: start },
  }
}

function judge(state: State, round: State['round'], now: number, timedOut: boolean): State {
  const next = judgeTrial(state, round, now, timedOut)
  return next.result && !state.result ? { ...next, resultAt: now, revealSkipped: false } : next
}

function judgeTrial(state: State, round: State['round'], now: number, timedOut: boolean): State {
  const def = brainGame(state.gameId).def
  const outcome = def.outcome(round)
  if (!outcome || state.result) return { ...state, round, timedOut }
  const rules = GROUP_RULES[state.group]
  const kind = state.trialKind
  const base = { correct: outcome.correct, accuracy: outcome.correct ? 1 : outcome.void ? 0 : outcome.accuracy, timedOut, void: false, kind, livesLost: 0, levelBefore: state.level }

  if (outcome.void) {
    // A trial that could not count: no life, no level change, replaced by a fresh one.
    return {
      ...state,
      round,
      timedOut,
      voidRun: state.voidRun + 1,
      result: { ...base, correct: false, void: true, practice: kind === 'practice' || kind === 'intro', points: 0, levelAfter: state.level },
    }
  }

  const rt = state.inputStartedAt === null ? null : now - state.inputStartedAt

  if (kind === 'practice') {
    const practiceDone = state.practiceDone + 1
    const practiceStreak = outcome.correct ? state.practiceStreak + 1 : 0
    // Fast-track: two right in a row (after at least two tries) is enough practice.
    const practiceLeft = practiceDone >= 2 && practiceStreak >= 2 ? 0 : Math.max(0, state.practiceLeft - 1)
    return {
      ...state,
      round,
      timedOut,
      voidRun: 0,
      practiceDone,
      practiceStreak,
      practiceLeft,
      result: { ...base, practice: true, points: 0, levelAfter: state.level },
    }
  }

  // Match Pairs' probe boards, the first one included even when a rule card opened it.
  if (state.probe && (kind === 'placement' || kind === 'intro')) return judgeProbe(state, round, outcome, timedOut, base)

  if (kind === 'intro') {
    return { ...state, round, timedOut, voidRun: 0, introLeft: Math.max(0, state.introLeft - 1), result: { ...base, practice: true, points: 0, levelAfter: state.level } }
  }

  const median = recentMedian(state.correctRts)
  const fast = outcome.correct && rt !== null && median !== null && rt < median
  const cap = levelCap(state.gameId, state)

  // Points: base by difficulty, a speed bonus against the player's own median, the run.
  // Whole points per trial, split so the parts add up to exactly what the trial scored.
  const rawBase = outcome.correct ? 10 * Math.max(1, state.level) : 0
  const points = outcome.correct ? roundPoints(state.level, true, fast, state.stats.streak) : 0
  const basePts = Math.round(rawBase)
  const speedPts = fast ? Math.round(rawBase * 1.25) - basePts : 0
  const comboPts = points - basePts - speedPts
  const streak = outcome.correct ? state.stats.streak + 1 : 0
  const score = {
    ...state.stats.score,
    base: state.stats.score.base + basePts,
    speed: state.stats.score.speed + speedPts,
    combo: state.stats.score.combo + comboPts,
  }
  const statsCommon = {
    ...state.stats,
    trials: state.stats.trials + 1,
    correct: state.stats.correct + (outcome.correct ? 1 : 0),
    points: state.stats.points + points,
    streak,
    bestStreak: Math.max(state.stats.bestStreak, streak),
    score,
  }
  const correctRts = outcome.correct && rt !== null ? [...state.correctRts, rt].slice(-20) : state.correctRts

  if (kind === 'placement' && state.place) {
    const view = def.view(round)
    const place = updatePlacement(state.place, state.level, outcome.correct, guessRate(view), placementWeight(state, round, outcome, rt, timedOut))
    const finished = placementDone(place)
    const handover = finished ? placementHandover(place, handoverK(state.gameId)) : null
    const levelAfter = Math.min(cap, handover ? handover.level : placementLevel(place))
    return {
      ...state,
      round,
      timedOut,
      voidRun: 0,
      correctRts,
      place: finished ? null : place,
      placed: state.placed || finished,
      placementTrials: state.placementTrials + 1,
      sd: handover ? Math.max(SKILL[state.group].floor, Math.min(SKILL[state.group].sd0, handover.sd)) : state.sd,
      result: { ...base, practice: false, points, levelAfter },
      // The handover is where this round's own climb starts: probes before it are not progress.
      stats: handover
        ? { ...statsCommon, levelStart: levelAfter, levelEnd: levelAfter, bestLevel: levelAfter }
        : { ...statsCommon, levelEnd: levelAfter, bestLevel: Math.max(state.stats.bestLevel, levelAfter) },
    }
  }

  // Counted: the staircase, both steps scaled by how unsure the game still is (and by the game's own
  // step scale — catalog `steps`; scaling both keeps the target).
  const steps = brainGame(state.gameId).steps
  const k = stepMultiplier(state.group, state.sd, steps?.kMax) * (steps?.scale ?? 1)
  // Span fast entry: a pass jumps two lengths (never past the next rule); the first miss is a probe —
  // one length back, no chance spent — and ordinary Corsi takes over.
  const fastEntry = state.group === 'span' && state.fastEntry
  const levelAfter = fastEntry
    ? outcome.correct
      ? Math.min(cap, fastJump(state.gameId, state.level))
      : Math.max(rules.min, state.level - 1)
    : Math.min(cap, stepLevel(state.group, state.level, outcome.correct, outcome.accuracy, k))
  const dir: 1 | -1 = outcome.correct ? 1 : -1
  const reversal = state.group !== 'span' && state.lastDir !== 0 && dir !== state.lastDir
  const upRun = outcome.correct ? state.upRun + 1 : 0
  // In a relaxed-timing mode a timeout still moves the level down but costs no chance (EVIDENCE §4.3).
  const forgivenTimeout = timedOut && state.timing !== 1
  let livesLost = rules.lives > 0 ? outcome.livesSpent ?? (outcome.correct || forgivenTimeout ? 0 : 1) : 0
  let lives: number
  if (state.group === 'span') {
    livesLost = outcome.correct || forgivenTimeout || fastEntry ? 0 : 1
    lives = outcome.correct ? rules.lives : Math.max(0, state.lives - livesLost)
  } else {
    lives = Math.max(0, state.lives - livesLost)
  }
  const flawless = state.gameId === 'schulte' && outcome.correct && (outcome.livesSpent ?? 0) === 0 && (round as { n: number }).n >= 5
  return {
    ...state,
    round,
    timedOut,
    lives,
    voidRun: 0,
    trialInRound: state.trialInRound + 1,
    counted: state.counted + 1,
    countedCorrect: state.countedCorrect + (outcome.correct ? 1 : 0),
    // Only lengths actually passed count (a fast-entry jump skips lengths it never showed).
    spanPassed: state.group === 'span' && outcome.correct ? Math.max(state.spanPassed, state.level) : state.spanPassed,
    sd: state.group === 'span' ? state.sd : nextSd(state.group, state.sd, reversal, upRun),
    upRun,
    fastEntry: fastEntry && outcome.correct,
    reversals: reversal ? [...state.reversals, state.level] : state.reversals,
    lastDir: dir,
    livesLostTotal: state.livesLostTotal + livesLost,
    misses: state.misses + (outcome.correct ? 0 : 1),
    flawlessHunt: state.flawlessHunt || flawless,
    correctRts,
    result: { ...base, practice: false, points, livesLost, levelAfter },
    stats: {
      ...statsCommon,
      levelEnd: levelAfter,
      bestLevel: Math.max(state.stats.bestLevel, state.group === 'span' ? (outcome.correct ? state.level : state.stats.bestLevel) : levelAfter),
    },
  }
}

function reducer(state: State, action: Action): State {
  const def = brainGame(state.gameId).def
  switch (action.type) {
    case 'advance':
      return state.result || state.over ? state : judge(state, def.advance(state.round), action.now, state.timedOut)
    case 'tap':
      if (state.result || state.over || state.paused || !def.acceptsInput(state.round)) return state
      return judge(state, def.tap(state.round, action.index), action.now, false)
    case 'timeout': {
      if (state.result || state.over || state.paused) return state
      // A timer is a request, not a verdict: only a deadline that has really passed counts.
      const limit = trialLimit(state)
      if (limit !== null && state.inputStartedAt !== null && action.now < state.inputStartedAt + limit - 50) return state
      return judge(state, def.timeout(state.round), action.now, true)
    }
    case 'inputStarted':
      return state.inputStartedAt === null ? { ...state, inputStartedAt: action.now } : state
    case 'next': {
      const rules = GROUP_RULES[state.group]
      const endPractice = state.trialKind === 'practice' && state.practiceLeft === 0
      const lives = endPractice ? rules.lives : state.lives
      const kind: TrialKind = state.practiceLeft > 0 ? 'practice' : state.introLeft > 0 ? 'intro' : state.place || state.probe ? 'placement' : 'counted'
      const cap = levelCap(state.gameId, state)
      // Practice and rule-intro trials hold the level; placement (and Match Pairs' probe) picks its
      // own; counted trials take the stored level.
      const counted = kind === 'counted' ? (endPractice && state.seedLevel !== null ? state.seedLevel : action.level) : state.level
      const level = Math.min(cap, kind === 'placement' ? placeLevel(state) : counted)
      // The trial that just ended, closed for the setup clock; then the unseen rules this one must not use.
      const setupMs = setupThrough(state, action.now, state.pausedMs)
      const ctx = buildCtx({ ...state, lives }, { kind, blockRules: gateRules(state, kind) })
      const { round, sig, recent } = createTrial(state.gameId, level, action.seed, ctx, state.recentSigs)
      const fresh: State = {
        ...state,
        round,
        trialId: state.trialId + 1,
        level,
        lives,
        trialKind: kind,
        intro: null,
        practiceLeft: endPractice ? 0 : state.practiceLeft,
        inputStartedAt: null,
        timedOut: false,
        result: null,
        resultAt: null,
        revealSkipped: false,
        recentSigs: [...state.recentSigs, sig].slice(-RECENT_SIGS),
        recent: [...state.recent, recent].slice(-2),
        trialAt: action.now,
        trialPausedMs: state.pausedMs,
        stats: endPractice ? { ...state.stats, setupMs, levelStart: level, levelEnd: level, bestLevel: level } : { ...state.stats, setupMs },
      }
      return introduce(fresh, action.now)
    }
    case 'end': {
      if (state.over) return state
      const held = state.paused && state.pausedAt !== null ? action.now - state.pausedAt : 0
      const activeMs = Math.max(0, action.now - state.stats.startedAt - state.pausedMs - held)
      const setupMs = Math.min(activeMs, setupThrough(state, action.now, state.pausedMs + held))
      const cleared = action.reason === 'cap' && state.counted > 0 && state.countedCorrect / state.counted >= 0.5
      // Round bonuses: reaching the end, and doing it without losing a chance (a game without
      // chances has no such bonus).
      const clear = cleared ? Math.round(state.stats.score.base * 0.1) : 0
      const clean = cleared && GROUP_RULES[state.group].lives > 0 && state.livesLostTotal === 0 && state.counted >= 10 ? Math.round(state.stats.score.base * 0.1) : 0
      return {
        ...state,
        over: true,
        paused: false,
        intro: null,
        stats: {
          ...state.stats,
          endedBy: action.reason,
          activeMs,
          setupMs,
          cleared,
          placement: state.placementTrials > 0 ? (state.placed ? 'done' : 'partial') : 'none',
          points: state.stats.points + clear + clean,
          score: { ...state.stats.score, clear, clean },
        },
      }
    }
    case 'pause': {
      if (state.over || state.paused) return state
      return { ...state, paused: true, pausedAt: action.now }
    }
    case 'resume': {
      if (!state.paused || state.intro) return state
      const held = state.pausedAt === null ? 0 : action.now - state.pausedAt
      return {
        ...state,
        paused: false,
        pausedAt: null,
        pausedMs: state.pausedMs + held,
        inputStartedAt: state.inputStartedAt === null ? null : state.inputStartedAt + held,
      }
    }
    case 'ackIntro': {
      if (!state.intro) return state
      const seenAdded = state.seenAdded.includes(state.intro.tag) ? state.seenAdded : [...state.seenAdded, state.intro.tag]
      const held = state.pausedAt === null ? 0 : action.now - state.pausedAt
      return {
        ...state,
        intro: null,
        seenAdded,
        paused: false,
        pausedAt: null,
        pausedMs: state.pausedMs + held,
      }
    }
    case 'skipReveal':
      // A miss's worked answer (a choice view's `stimulus.reveal`) or a right pattern's rule, once it
      // has been up long enough to be seen: on to the next trial now.
      if (!state.result || state.over || state.paused || state.revealSkipped) return state
      if (!missReveal(state) && !ruleReveal(state)) return state
      if (state.resultAt === null || action.now - state.resultAt < REVEAL_SKIP_AFTER_MS) return state
      return { ...state, revealSkipped: true }
    case 'best':
      return {
        ...state,
        finalized: true,
        stats: { ...state.stats, isNewBest: action.isNewBest, tierUp: action.tierUp, achievements: action.achievements, suggestRelax: action.suggestRelax },
      }
  }
}

/** A missed choice trial whose view shows the worked answer (math's line, a pattern's rule): it stays up longer. */
function missReveal(s: Pick<State, 'gameId' | 'round' | 'result'>): boolean {
  if (!s.result || s.result.correct || s.result.void) return false
  const view = brainGame(s.gameId).def.view(s.round) as RoundView
  return view.kind === 'choice' && view.stimulus.reveal !== undefined
}

/**
 * A right answer whose view shows the row's rule (Number Pattern's gap labels and line colours):
 * it stays up 1.3s instead of 0.7 (GAMES_DIFFICULTY_PLAN §3.2, 1.2–1.5s), skippable like a miss.
 */
function ruleReveal(s: Pick<State, 'gameId' | 'round' | 'result'>): boolean {
  if (!s.result || !s.result.correct || s.result.void) return false
  const view = brainGame(s.gameId).def.view(s.round) as RoundView
  return view.kind === 'choice' && (view.stimulus.reveal?.gaps?.length ?? 0) > 0
}

function storeMeta(): BrainMeta {
  return (useBrainStore.getState() as { meta?: BrainMeta }).meta ?? emptyMeta()
}

function init({ gameId, platform }: { gameId: BrainGameId; platform: PlatformContext }): State {
  const progress = useBrainStore.getState().progress
  const meta = storeMeta()
  const entry = brainGame(gameId)
  const group = entry.group
  const rules = GROUP_RULES[group]
  const gp = gameProgress(progress, gameId)
  const est = meta.sk[gameId]
  const today = dayNumber(localDayKey())
  const daysAway = est && est.day > 0 ? Math.max(0, today - est.day) : 0
  const practiced = progress.practiced.includes(gameId)
  const practiceDone = meta.practice[gameId] ?? 0
  const practiceLeft = practiced ? 0 : Math.max(0, PRACTICE_TRIALS - practiceDone)
  const roundSeed = randomSeed()
  const base = {
    platform,
    lives: rules.lives,
    roundSeed,
    recent: [] as RecentTrial[],
  }
  const cap = levelCap(gameId, base)
  // Never played — or an estimate re-opened (saved with n = 0: a placement left part-way, or a v1
  // estimate moved to the v2 scale), which places again from where it stands.
  const neverPlayed = (gp.rounds === 0 && !est) || (est !== undefined && est.n === 0)
  // A record from before skill estimates was climbed on the old, slow ladder (+0.15 a trial), so it
  // usually sits far below the player: placement re-finds the level once, starting from that record
  // (progress.ts has already moved it to the v2 scale).
  const legacy = gp.rounds > 0 && !est && group !== 'span'
  // Span games re-enter fast (§2.6): a first round, a return after two weeks, or a re-opened estimate.
  const fastEntry = group === 'span' && (neverPlayed || daysAway >= FAST_ENTRY_AFTER_DAYS)

  let level = gp.level
  let sd = est ? sdAfterDays(group, est.sd, daysAway) : legacySd(group)
  let place: PlacementState | null = null
  let placeStart: number | null = null
  let seedLevel: number | null = null
  let probe: State['probe'] = null
  if (neverPlayed || legacy) {
    if (group === 'span') {
      // Flash Grid starts at L1 (3 cells), Sequence at L2 (forward 4) — or, from the other span game
      // (the same skill family), two lengths below the longest it has passed (its estimate; bestLevel
      // can be a length that was failed), converted through that game's lengths.
      const other: BrainGameId = gameId === 'memoryGrid' ? 'sequence' : 'memoryGrid'
      const og = progress.games[other]
      const oe = meta.sk[other]
      const passed = oe && oe.n > 0 ? oe.mu : og && og.rounds > 0 ? og.bestLevel - 1 : null
      const floor = gameId === 'sequence' ? 2 : rules.min
      const otherLength = passed === null ? null : brainGame(other).def.spanLength?.(Math.round(passed), buildCtx(base)) ?? Math.round(passed) + 2
      seedLevel = otherLength === null ? floor : Math.max(floor, otherLength - 2 - 2)
    } else if (gameId === 'pairs') {
      // A board takes too long for a placement series: a ladder of up to four probe boards (§2.7).
      probe = { board: 0, level: Math.min(cap, PROBE.start), passed: false }
      sd = PROBE.sd
      level = practiceLeft > 0 ? rules.min : probe.level
    } else {
      // One path (§2.3): a re-opened estimate's level, else the pre-estimate record's, else a
      // cross-game guess. Unseen rules are blocked in placement (ctx.blockRules), so no rule ceiling.
      const seed = est && est.n === 0 ? est.mu : legacy ? gp.level : crossGameSeed(meta, gameId)
      const plan = zestPlan(gameId)
      place = startPlacement({
        lo: rules.min,
        hi: Math.min(plan.hi, cap),
        mu0: seed === null ? 3 : Math.max(3, seed),
        sigma0: 9,
        target: 0.85,
        slope: 2,
        maxMove: 3,
        minTrials: plan.minTrials,
        maxTrials: plan.maxTrials,
        tailMass: plan.tailMass,
        hotMove: plan.hotMove,
        hotAfter: plan.hotAfter,
      })
      // Nothing known: the first placement trial is never above practice level + 2.
      if (seed === null) placeStart = 3
      sd = SKILL[group].sd0
      level = practiceLeft > 0 ? rules.min : placeLevel({ place, placeStart })
    }
  } else if (est) {
    // The last round already set the start (with its drop, or none after a strong clear); only
    // days away add to it — the start falls with the grown uncertainty, the bigger steps re-find it.
    level = Math.min(gp.level, est.mu) - Math.max(0, 0.5 * (sd - est.sd))
  }
  if (seedLevel !== null) {
    // Practice is level-one basics; the seeded start comes after it.
    level = practiceLeft > 0 ? rules.min : seedLevel
    if (practiceLeft === 0) seedLevel = null
  }
  level = Math.min(cap, Math.max(rules.min, level))
  const trialKind: TrialKind = practiceLeft > 0 ? 'practice' : place || probe ? 'placement' : 'counted'
  const trialSeed = randomSeed()
  const blockRules = gateRules({ gameId, seenMask: meta.seen, seenAdded: [], cardsShown: 0, cardAt: null, counted: 0, probe }, trialKind)
  const ctx = buildCtx(base, { kind: trialKind, blockRules })
  const { round, sig, recent } = createTrial(gameId, level, trialSeed, ctx, [])
  const now = Date.now()
  const state: State = {
    gameId,
    group,
    platform,
    timing: progress.settings.timing,
    round,
    trialId: 1,
    level,
    startLevel: level,
    trialKind,
    trialInRound: 0,
    counted: 0,
    countedCorrect: 0,
    spanPassed: 0,
    seedLevel,
    practiceLeft,
    practiceDone,
    practiceStreak: 0,
    introLeft: 0,
    intro: null,
    toast: null,
    seenAdded: [],
    seenMask: meta.seen,
    playedBefore: gp.rounds > 0,
    place,
    placed: false,
    placementTrials: 0,
    sd,
    reversals: [],
    lastDir: 0,
    livesLostTotal: 0,
    misses: 0,
    flawlessHunt: false,
    inputStartedAt: null,
    timedOut: false,
    result: null,
    lives: rules.lives,
    over: false,
    finalized: false,
    paused: false,
    pausedAt: null,
    pausedMs: 0,
    voidRun: 0,
    recentSigs: [sig],
    // The speed bonus compares with the player's own median, carried between rounds.
    correctRts: meta.rt[gameId] ? Array.from({ length: 5 }, () => meta.rt[gameId] as number) : [],
    stats: {
      trials: 0,
      correct: 0,
      points: 0,
      streak: 0,
      bestStreak: 0,
      levelStart: level,
      levelEnd: level,
      bestLevel: level,
      startedAt: now,
      activeMs: 0,
      setupMs: 0,
      endedBy: null,
      cleared: false,
      placement: 'none',
      isNewBest: false,
      score: { base: 0, speed: 0, combo: 0, clear: 0, clean: 0 },
      tierUp: null,
      achievements: [],
      suggestRelax: false,
    },
    placeStart,
    resultAt: null,
    revealSkipped: false,
    roundSeed,
    recent: [recent],
    cardsShown: 0,
    cardAt: null,
    upRun: 0,
    fastEntry,
    probe,
    trialAt: now,
    trialPausedMs: 0,
  }
  return introduce(state, now)
}

/** Everything a finished round writes: the estimate, the next start, tier, achievements. */
function finishRound(s: State) {
  const store = useBrainStore.getState()
  const progress = store.progress
  const meta = storeMeta()
  const group = s.group
  const id = s.gameId
  const theta = roundEstimate(s.reversals)
  const est = meta.sk[id]
  const levelEnd = s.stats.levelEnd
  const short = s.counted < SHORT_ROUND[group] && !s.placed
  const accuracy = s.stats.trials > 0 ? s.stats.correct / s.stats.trials : 0
  const countedAccuracy = s.counted > 0 ? s.countedCorrect / s.counted : 0
  // A span round always ends on its chances (the Corsi stop rule: two misses at one length), usually
  // within 5-7 trials — for every player, the sharpest too. That is the test working, not a struggle:
  // counted as one, it offered relaxed timing after almost every memory round from the second on
  // (persona simulation: 52-99% of rounds), and relaxed timing never lengthens their exposures anyway.
  const earlyWipe = group !== 'span' && s.stats.endedBy === 'lives' && s.counted < 8
  const wipes = s.counted === 0 && !s.placed ? meta.wipes[id] ?? 0 : earlyWipe ? (meta.wipes[id] ?? 0) + 1 : 0

  // The estimate: the round's reversal mean, else a step toward where the round ended.
  let mu: number
  if (group === 'span') mu = Math.max(est?.mu ?? 0, s.spanPassed) || Math.max(GROUP_RULES.span.min, s.startLevel - 1)
  else if (theta !== null) mu = theta
  else if (est && !s.placed) mu = est.mu + 0.5 * (levelEnd - est.mu)
  else mu = levelEnd

  // Where the next round starts.
  const stored = gameProgress(progress, id).level
  let nextStart: number | undefined
  if ((s.counted === 0 && s.placementTrials === 0) || ((s.place || s.probe) && s.counted === 0)) nextStart = undefined
  else if (short) nextStart = s.startLevel
  else if (group === 'span') nextStart = restartLevel(group, stored, s.spanPassed || s.startLevel)
  else nextStart = startFromEstimate(group, mu, s.sd, { momentum: s.stats.cleared && countedAccuracy >= 0.9, mercy: wipes >= 2 })

  // Tier — from a settled estimate, never from a lucky spike or a placement series alone.
  const oldTier = meta.tier[id] ?? 0
  let tierValue: number | null = null
  const span1 = meta.span1[id] ?? 0
  let span2 = meta.span2[id] ?? 0
  if (group === 'span') {
    // Only lengths actually passed this round count — never the length it merely opened at.
    span2 = Math.max(span2, Math.min(span1, s.spanPassed))
    tierValue = span2
  } else if (s.counted > 0) {
    const settled = theta ?? (s.stats.cleared && s.misses <= 1 ? levelEnd - 1 : null)
    if (settled !== null) tierValue = settled
  }
  const reached = tierValue === null ? 0 : tierFor(id, tierValue)
  const newTier = Math.max(oldTier, reached)
  const tierUp = newTier > oldTier ? newTier : null

  const today = dayNumber(localDayKey())
  const median = recentMedian(s.correctRts)
  // A placement (or Match Pairs' probe) stopped part-way: keep what it found so far, and run it again
  // next time from there.
  const interrupted =
    s.placementTrials > 0 && s.counted === 0 ? (s.place ? placementHandover(s.place, handoverK(id)) : s.probe ? { level: s.probe.level } : null) : null
  // Finished = no practice trial left (two right in a row, or all four) — not merely two tried.
  const practiceFinished = !progress.practiced.includes(id) && s.practiceDone > 0 && s.practiceLeft === 0
  const updated = (m: BrainMeta): BrainMeta => {
    const seen = s.seenAdded.reduce((mask, tag) => {
      const info = mechanicInfo(tag)
      return info ? setBit(mask, info.bit) : mask
    }, m.seen)
    return {
      ...m,
      seen,
      sk: interrupted
        ? { ...m.sk, [id]: { mu: interrupted.level, sd: SKILL[group].sd0, n: 0, day: today } }
        : short
          ? // Too short to say anything: the estimate stands (only its trial count grows).
            m.sk[id] ? { ...m.sk, [id]: { ...m.sk[id]!, n: m.sk[id]!.n + s.counted } } : m.sk
          : s.counted + s.placementTrials > 0
          ? { ...m.sk, [id]: { mu, sd: s.sd, n: (m.sk[id]?.n ?? 0) + s.counted + s.placementTrials, day: today } }
          : m.sk,
      tier: newTier > 0 ? { ...m.tier, [id]: newTier } : m.tier,
      practice: { ...m.practice, [id]: Math.max(m.practice[id] ?? 0, s.practiceDone) },
      wipes: { ...m.wipes, [id]: wipes },
      rt: median !== null ? { ...m.rt, [id]: Math.round(median) } : m.rt,
      span1: group === 'span' && s.counted > 0 ? { ...m.span1, [id]: s.spanPassed } : m.span1,
      span2: group === 'span' ? { ...m.span2, [id]: span2 } : m.span2,
    }
  }
  const updateMeta = (store as { updateMeta?: (fn: (m: BrainMeta) => BrainMeta) => void }).updateMeta
  updateMeta?.(updated)
  if (practiceFinished) store.practiced(id)

  const roundEntry = s.stats.trials > 0 ? { level: levelEnd, accuracy } : undefined
  const { isNewBest } = store.finishRun(id, s.stats.points, nextStart === undefined ? undefined : { id, level: nextStart }, roundEntry)

  // Achievements, against progress and tiers as they stand after this round.
  const metaAfter = updated(meta)
  const achievements = earnedByRound(
    {
      gameId: id,
      endedBy: s.stats.endedBy,
      cleared: s.stats.cleared,
      trials: s.counted,
      correct: s.countedCorrect,
      // A game without lives would count its misses for "without losing a chance".
      livesLost: GROUP_RULES[group].lives > 0 ? s.livesLostTotal : s.misses,
      bestStreak: s.stats.bestStreak,
      spanLength: group === 'span' && s.spanPassed > 0 ? brainGame(id).def.spanLength?.(s.spanPassed, buildCtx(s)) ?? s.spanPassed + 2 : 0,
      flawlessHunt: s.flawlessHunt,
    },
    useBrainStore.getState().progress,
    metaAfter,
  )
  if (achievements.length) updateMeta?.((m) => ({ ...m, ach: achievements.reduce((mask, a) => setBit(mask, achievementBit(a)), m.ach) }))

  return { isNewBest, tierUp, achievements, suggestRelax: wipes >= 2 && s.timing === 1 }
}

export interface RoundOptions {
  /**
   * Play time this round may use (paused time excluded). When it is up, the round ends after the
   * trial in play with `endedBy: 'time'`. Today's Training gives each game a few minutes.
   */
  timeBudgetMs?: number
}

export function useBrainRound(gameId: BrainGameId, platform: PlatformContext, options: RoundOptions = {}) {
  const budget = useRef(options.timeBudgetMs)
  const [state, dispatch] = useReducer(reducer, { gameId, platform }, init)
  const store = useBrainStore
  const def = brainGame(state.gameId).def
  const rules = GROUP_RULES[state.group]
  // A game whose trial is a whole puzzle may end its rounds sooner (catalog `roundCap`: Code Break's five codes).
  const roundCap = brainGame(state.gameId).roundCap ?? rules.roundCap
  const busy = state.result !== null || state.over
  const pending = busy || state.paused ? null : def.pendingMs(state.round)
  const accepts = !busy && !state.paused && def.acceptsInput(state.round)
  const limit = trialLimit(state)
  const stateRef = useRef(state)
  stateRef.current = state
  const view: RoundView = def.view(state.round)

  // Time passing inside a trial: memorise phases, sequence flashes, flipping a pair back.
  // A pause keeps what was left of the phase (no free study time).
  const phase = useRef<{ round: unknown; armedAt: number; wait: number; left: number | null } | null>(null)
  useEffect(() => {
    if (pending === null) return
    const prior = phase.current
    const wait = prior && prior.round === state.round && prior.left !== null ? prior.left : pending
    const armed = { round: state.round as unknown, armedAt: Date.now(), wait, left: null as number | null }
    phase.current = armed
    const t = setTimeout(() => dispatch({ type: 'advance', now: Date.now() }), wait)
    return () => {
      clearTimeout(t)
      armed.left = Math.max(0, armed.wait - (Date.now() - armed.armedAt))
    }
  }, [pending, state.round])

  // The input clock starts the first time the trial takes input (never while a rule card is up).
  useEffect(() => {
    if (accepts && state.inputStartedAt === null) dispatch({ type: 'inputStarted', now: Date.now() })
  }, [accepts, state.inputStartedAt])

  useEffect(() => {
    if (state.inputStartedAt === null || busy || limit === null || state.paused) return
    const left = state.inputStartedAt + limit - Date.now()
    const t = setTimeout(() => dispatch({ type: 'timeout', now: Date.now() }), Math.max(0, left))
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.trialId, state.inputStartedAt, busy, state.paused])

  // A rule met is remembered at once — a player who quits right after its card is not shown it again.
  const seenCount = state.seenAdded.length
  useEffect(() => {
    if (seenCount === 0) return
    const tags = stateRef.current.seenAdded
    const updateMeta = (store.getState() as { updateMeta?: (fn: (m: BrainMeta) => BrainMeta) => void }).updateMeta
    updateMeta?.((m) => ({
      ...m,
      seen: tags.reduce((mask, tag) => {
        const info = mechanicInfo(tag)
        return info ? setBit(mask, info.bit) : mask
      }, m.seen),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenCount])

  // The round is open from its first screen: the store holds this game still against a cloud copy
  // arriving mid-round (practice and rule-card trials keep it open too).
  useEffect(() => {
    if (!state.over) store.getState().beginRound?.(state.gameId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.trialId])

  // A judged trial is saved once (counted and placement trials; practice and intro trials are not).
  useEffect(() => {
    const result = state.result
    if (!result || result.void || result.practice) return
    const s = stateRef.current
    store.getState().record(s.gameId, { level: result.levelAfter, correct: result.correct, points: result.points })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result])

  // Practice is saved as it goes, not at the round's end: a tab closed mid-practice resumes where
  // it was, and a finished practice is never asked for again (the round may never reach its end).
  useEffect(() => {
    const result = state.result
    if (!result || result.void || result.kind !== 'practice') return
    const s = stateRef.current
    const st = store.getState()
    st.updateMeta((m) => ((m.practice[s.gameId] ?? 0) >= s.practiceDone ? m : { ...m, practice: { ...m.practice, [s.gameId]: s.practiceDone } }))
    if (s.practiceLeft === 0) st.practiced(s.gameId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result])

  // Then the answer shows for a beat, and the next trial comes — or the round ends.
  useEffect(() => {
    const result = state.result
    if (!result || state.over || state.paused) return
    const s = stateRef.current
    const delay = state.revealSkipped
      ? 0
      : result.void
        ? REVEAL.void
        : result.correct
          ? ruleReveal(s)
            ? REVEAL.rightWithRule
            : REVEAL.right
          : missReveal(s)
            ? REVEAL.wrongWithReveal
            : REVEAL.wrong
    const t = setTimeout(() => {
      const cur = stateRef.current
      if (result.void && cur.voidRun >= END_AFTER_VOIDS) return dispatch({ type: 'end', reason: 'void', now: Date.now() })
      if (result.kind === 'counted' && !result.void) {
        if (rules.lives > 0 && cur.lives <= 0) return dispatch({ type: 'end', reason: 'lives', now: Date.now() })
        if (roundCap !== null && cur.counted >= roundCap) return dispatch({ type: 'end', reason: 'cap', now: Date.now() })
      }
      // The slot's time is up: this trial was the last (never mid-trial, never during practice
      // left unfinished — practice is short and is what makes the game playable). Setup time is not
      // play time, and a board game's placement (or probe) always runs to its handover.
      const now = Date.now()
      const played = now - cur.stats.startedAt - cur.pausedMs - setupThrough(cur, now, cur.pausedMs)
      const placing = cur.place !== null || cur.probe !== null
      if (budget.current !== undefined && played >= budget.current && cur.practiceLeft === 0 && !placing) return dispatch({ type: 'end', reason: 'time', now })
      const progress = store.getState().progress
      dispatch({ type: 'next', level: gameProgress(progress, cur.gameId).level, seed: randomSeed(), now: Date.now() })
    }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result, state.paused, state.revealSkipped])

  // The round is over: write its end once.
  useEffect(() => {
    if (!state.over) return
    const out = finishRound(stateRef.current)
    dispatch({ type: 'best', ...out })
  }, [state.over])

  const tap = useCallback((index: number) => dispatch({ type: 'tap', index, now: Date.now() }), [])
  const stop = useCallback(() => dispatch({ type: 'end', reason: 'stop', now: Date.now() }), [])
  const pause = useCallback(() => dispatch({ type: 'pause', now: Date.now() }), [])
  const resume = useCallback(() => dispatch({ type: 'resume', now: Date.now() }), [])
  const ackIntro = useCallback(() => dispatch({ type: 'ackIntro', now: Date.now() }), [])
  const skipReveal = useCallback(() => dispatch({ type: 'skipReveal', now: Date.now() }), [])

  const meta = (store.getState() as { meta?: BrainMeta }).meta
  return {
    gameId: state.gameId,
    group: state.group,
    trialId: state.trialId,
    level: displayLevel(state.result ? state.result.levelAfter : state.level),
    view,
    tap,
    stop,
    pause,
    resume,
    /** Paused by the player (a rule card is not a pause: see `intro`). */
    paused: state.paused && !state.intro,
    /** Pausing is not offered under a rule card. */
    canPause: !state.over && !state.intro,
    /** A rule met for the first time: the platform shows its card (mechanics.<copy>) and calls ackIntro. */
    intro: state.intro ? { tag: state.intro.tag, copy: mechanicInfo(state.intro.tag)?.copy ?? state.intro.tag } : null,
    ackIntro,
    /** A bigger board: a short notice the platform shows between trials. */
    toast: state.toast ? { id: state.toast.id, tag: state.toast.tag, copy: mechanicInfo(state.toast.tag)?.copy ?? state.toast.tag } : null,
    trialKind: state.trialKind,
    /**
     * Placement is running ("finding your start" — never a test or a score), including a rule card's
     * trial met during it: the level stays hidden until the staircase takes over.
     */
    placing: state.trialKind === 'placement' || (state.trialKind === 'intro' && (state.place !== null || state.probe !== null)),
    result: state.result,
    lives: state.lives,
    maxLives: rules.lives,
    practice: state.trialKind === 'practice' || state.trialKind === 'intro',
    practiceDone: state.practiceDone,
    practiceTotal: PRACTICE_TRIALS,
    over: state.over,
    /** The round is over AND its end is recorded — report `stats` to the caller on this, not on `over`. */
    done: state.over && state.finalized,
    stats: state.stats,
    trialInRound: state.counted,
    roundCap,
    /** The game's best tier before this round (0-6). */
    tier: meta?.tier[state.gameId] ?? 0,
    /** The taps that answer this trial — for tests and automated play-throughs; never drawn. */
    solution: busy || state.paused ? null : def.solution(state.round),
    /** Present while the input clock runs; platforms animate a bar from it. */
    timer:
      state.inputStartedAt !== null && !busy && limit !== null && !state.paused
        ? { startedAt: state.inputStartedAt, limitMs: limit }
        : null,
    /**
     * On with the next trial now — taken from 500ms after the result: a missed choice trial's worked
     * answer (`stimulus.reveal`, up 2.4s) or a right pattern's rule. A tap on the board, Space / Enter.
     */
    skipReveal,
  }
}

export type BrainRound = ReturnType<typeof useBrainRound>
