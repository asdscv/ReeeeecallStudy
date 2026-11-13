import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  type AchievementId,
  type BrainGameId,
  type BrainMeta,
  type CreateContext,
  type GameGroup,
  type PlacementState,
  type QuickEyeKnob,
  type RoundView,
  type TimingMode,
  GROUP_RULES,
  PRACTICE_TRIALS,
  QUICK_EYE_LADDER_MS,
  SKILL,
  TIERS,
  achievementBit,
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
  placementCeiling,
  placementDone,
  placementLevel,
  placementResult,
  quickEyeBase,
  quickEyeHold,
  quickEyeIndex,
  quickEyeKnob,
  quickEyeSpeedGauge,
  quickEyeStage,
  quickEyeTierStage,
  QUICK_EYE_HOLD_NEED,
  exposureMsFor,
  randomSeed,
  recentMedian,
  restartLevel,
  roundEstimate,
  roundPoints,
  scaledLimit,
  sdAfterDays,
  setBit,
  shrinkSd,
  startFromEstimate,
  startPlacement,
  stepLevel,
  stepMultiplier,
  tierFor,
  updatePlacement,
} from '../lib/brain-games'
import { useBrainStore } from '../stores/brain-store'

/**
 * One round of one game — trials until the chances run out, the round's cap is reached, or the
 * player stops. Web and mobile only draw `view` and call `tap` / `reportExposure`; every timer and
 * every rule lives here, so the two platforms cannot drift.
 *
 * The game logic of a round, in order:
 *   practice (first time only; ends after 2 right in a row) → placement (a game never played:
 *   finds the level in ~8 trials, no chances spent) → counted trials (the staircase, its steps
 *   scaled by how unsure the game still is) → round end (the round's estimate, the next start,
 *   tier, achievements, score bonuses).
 * A rule the player has not met yet stops its first trial with a card, and that trial is unscored;
 * a bigger board gets a short notice. See lib/brain-games/{rules,skill,placement,mechanics,tiers}.ts.
 *
 * Quick Eye on top of that: practice is the centre alone (variant 1) at 500 → 400 → 333 → 267ms;
 * every record then plays from variant 2, and a new rule's four unscored trials step the exposure
 * down from three levels easier to the player's own; placement (6-10 trials, opening at 267ms)
 * sends a player who could not yet place the star to variant 1, without saying so. No lives: a leg
 * of 20 counted trials. A stage reached shows a short interstitial between trials (`stageUp`, the
 * round paused); the answer's reveal can be skipped after 500ms. Nothing is shown, sounded or
 * counted up while the display is being measured (`quiet`: fixation, stimulus, mask).
 */
export interface PlatformContext {
  /** Widest grid with cells ≥ 56dp on this screen (see maxColsFor). */
  maxCols: number
  /** Shortest Quick Eye exposure this platform shows reliably. */
  minExposureMs: number
  /** Quick Eye slots per ring. */
  ringSlots: number[]
}

/** practice: first-time tutorial · intro: right after a new-rule card · placement: finding the start · counted: the real thing. */
export type TrialKind = 'practice' | 'intro' | 'placement' | 'counted'

export interface TrialResult {
  correct: boolean
  /** 0..1 — Quick Eye: 0.5 when only one of its two answers was right (the run is kept, not grown). */
  accuracy: number
  timedOut: boolean
  /** The trial did not count (dropped frames) and is being replaced. */
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
   * 'void': the round stopped itself after many trials in a row that could not count (a stalled
   * screen). 'time': its time budget (a Today's Training slot) ran out — it ends after the trial in
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
  /** Quick Eye: counted trials in order — both answers right, one of two, neither (the leg bar). Empty for other games. */
  legMarks: LegMark[]
  /** Quick Eye: counted trials after which the shown speed level rose (the flash got shorter). */
  rungUps: number
  /**
   * Quick Eye: the stage (as shown) the round ended on, when higher than the one it started on — set
   * with the end, so a stage passed on the last trial (no interstitial came) still reaches the summary.
   */
  stageReached: number | null
}

export type LegMark = 'ok' | 'half' | 'miss'

/** Quick Eye moved to a higher stage between trials: a short interstitial, the round paused. */
export interface StageUp {
  /** Stages as shown ("Stage N"): the variant, or the centre task's stage on the centre-only setting. */
  from: number
  to: number
  /** The variant now played — for a preview board (buildDemo('quickEye', { variant })). */
  variant: number
  /** The one new thing (`quickEye.knob.<knob>`), or null. */
  knob: QuickEyeKnob | null
  /** A new rule's card comes right after (show no preview — the card explains it). */
  ruleFollows: boolean
  /** Changes with every stage-up (a key for the overlay and its fx). */
  id: number
}

interface State {
  gameId: BrainGameId
  group: GameGroup
  platform: PlatformContext
  timing: TimingMode
  centerOnly: boolean
  // Each game's state is private to that game.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  round: any
  trialId: number
  level: number
  /** Where this round started (restored when a round is too short to say anything). */
  startLevel: number
  variant: number
  startVariant: number
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
  /** Unscored trials still to come after a new-rule card (Quick Eye: 4 per new stage, its protocol). */
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
  lenient: boolean
  recentSigs: string[]
  correctRts: number[]
  frameVoids: number
  minExposureMs: number
  stats: RoundStats
  /** Quick Eye: the level a never-played placement opens at (267ms, where a rule card's ramp ends); null = the placement's own pick. */
  placeStart: number | null
  /** Quick Eye placement: trials that asked where the star was, and how many were placed right. */
  placeLoc: { ok: number; n: number }
  /** Quick Eye: a stage reached, shown between trials (the round is paused under it). */
  stageUp: StageUp | null
  /** When the trial's result came in (the reveal can be skipped REVEAL_SKIP_AFTER_MS later). */
  resultAt: number | null
  revealSkipped: boolean
}

type Action =
  | { type: 'advance'; now: number }
  | { type: 'tap'; index: number; now: number }
  | { type: 'timeout'; now: number }
  | { type: 'inputStarted'; now: number }
  | { type: 'exposed'; actualMs: number; frameMs: number; now: number }
  | { type: 'next'; level: number; variant: number; seed: number; now: number }
  | { type: 'end'; reason: 'lives' | 'cap' | 'stop' | 'void' | 'time'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'ackIntro'; now: number }
  | { type: 'ackStageUp'; now: number }
  | { type: 'skipReveal'; now: number }
  | { type: 'best'; isNewBest: boolean; tierUp: number | null; achievements: AchievementId[]; suggestRelax: boolean; stageReached: number | null }

const RECENT_SIGS = 12
const LENIENT_AFTER_VOIDS = 5
const END_AFTER_VOIDS = 8
/**
 * How long a trial's answer stays up. Quick Eye's reveal shows the scene that flashed, so it stays
 * longer — longest after a miss, which has the most to show — and can be skipped after
 * REVEAL_SKIP_AFTER_MS. Flash onsets stay ≥ 1.5s apart even then (mask + skip + fixation). A voided
 * trial (only Quick Eye voids) has no mask and no answer, so its pause is what keeps the next flash
 * ≥ 1s after it (EVIDENCE §2.3: flash + 500 + the 500ms fixation; at 250 a 33ms flash came back
 * ~780ms later).
 */
const REVEAL = { right: 700, wrong: 1500, quickEyeRight: 1000, quickEyeHalf: 1400, quickEyeWrong: 1600, void: 500 }
const REVEAL_SKIP_AFTER_MS = 500
/** The stage-up interstitial clears itself after this (or on a tap: ackStageUp). */
const STAGE_UP_MS = 2000
/** Quick Eye's practice exposures (ladder levels): 500, 400, 333, 267ms — two right in a row end it. */
const QE_PRACTICE_LEVELS = [0, 1, 2, 3] as const
/** Quick Eye's placement opens at 267ms (ladder level 3). */
const QE_PLACE_START = 3
/** Rounds this short (counted trials) say too little to move the next start. */
const SHORT_ROUND = { speed: 5, quickEye: 5, span: 2 }

function buildCtx(s: Pick<State, 'platform' | 'centerOnly' | 'lives' | 'minExposureMs'>, variant: number): CreateContext {
  return {
    maxCols: s.platform.maxCols,
    ringSlots: s.platform.ringSlots,
    minExposureMs: s.minExposureMs,
    centerOnly: s.centerOnly,
    livesLeft: s.lives,
    variant,
  }
}

/** The level past which this game's puzzle stops changing on this screen — from the platform's floor. */
function levelCap(gameId: BrainGameId, s: Pick<State, 'platform' | 'centerOnly' | 'lives'>): number {
  const def = brainGame(gameId).def
  return def.maxLevel ? def.maxLevel(buildCtx({ ...s, minExposureMs: s.platform.minExposureMs }, 1)) : Infinity
}

function createTrial(gameId: BrainGameId, level: number, seed: number, ctx: CreateContext, recentSigs: string[]) {
  const def = brainGame(gameId).def
  const rng = createRng(seed)
  let round = def.create(level, rng, ctx)
  for (let i = 0; i < 6 && recentSigs.includes(def.signature(round)); i++) round = def.create(level, rng, ctx)
  return { round, sig: def.signature(round) as string }
}

/** Quick Eye's practice trial: the centre alone, a step shorter each try. */
function qePracticeLevel(practiceDone: number): number {
  return QE_PRACTICE_LEVELS[Math.max(0, Math.min(QE_PRACTICE_LEVELS.length - 1, practiceDone))]
}

/**
 * Quick Eye's unscored trials after a rule card: from three levels easier than the player's level
 * down to it — L−3, L−2, L−1, L (never below 0). `introLeft` counts this trial.
 */
function qeIntroLevel(level: number, introLeft: number): number {
  return Math.max(0, level - 3 + Math.max(0, 4 - introLeft))
}

/** The level a placement trial is played at. */
function placeLevel(s: Pick<State, 'place' | 'placeStart'>): number {
  if (!s.place) return 0
  return s.placeStart !== null && s.place.n === 0 ? s.placeStart : placementLevel(s.place)
}

/**
 * A Quick Eye trial that just opened with a rule card is played again, the same trial (same seed,
 * same context), at the first of the easier exposures. The flash's length is the only difference.
 */
function easeIntroTrial(s: State, seed: number, ctx: CreateContext, sigsBefore: string[]): State {
  if (s.gameId !== 'quickEye' || !s.intro) return s
  const { round, sig } = createTrial(s.gameId, qeIntroLevel(s.level, 4), seed, ctx, sigsBefore)
  return { ...s, round, recentSigs: [...sigsBefore, sig].slice(-RECENT_SIGS) }
}

/** The stage a Quick Eye trial shows ("Stage N"). */
function shownStage(s: Pick<State, 'centerOnly'>, variant: number): number {
  return quickEyeStage(variant, s.centerOnly)
}

/**
 * What a new trial introduces. A rule not met before stops the trial with a card (a trial must not
 * open on an unexplained rule with its clock running); a board change not met before gets a short
 * notice when the game is being played again (a first round has its practice and demo for that).
 */
function introduce(s: State, now: number): State {
  const def = brainGame(s.gameId).def
  const tags = def.mechanics(s.round)
  const seen = (tag: string) => {
    const info = mechanicInfo(tag)
    return !info || hasBit(s.seenMask, info.bit) || s.seenAdded.includes(tag)
  }
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
      introLeft: s.gameId === 'quickEye' ? 4 : 1,
      trialKind: 'intro',
      paused: true,
      pausedAt: now,
    }
  }
  return next
}

/** The next exposure floor when too many trials on this device are being voided. */
function raiseFloor(ms: number): number {
  const ladder = [...QUICK_EYE_LADDER_MS].reverse()
  return ladder.find((x) => x > ms) ?? ms
}

/** Chance of a right answer by guessing, for placement's model. */
function guessRate(view: RoundView): number {
  if (view.kind === 'choice') return 1 / Math.max(2, view.options.length)
  if (view.kind === 'quickEye') return 1 / (view.centerOptions.length * (view.asksLocation ? 8 : 1))
  return 0.02
}

function trialLimit(s: Pick<State, 'gameId' | 'round' | 'timing' | 'trialKind'>): number | null {
  const base = scaledLimit(brainGame(s.gameId).def.timeLimitMs(s.round), s.timing)
  // The trial right after a rule card is played at twice the time: it is for learning the rule.
  return base === null ? null : s.trialKind === 'intro' ? base * 2 : base
}

function judge(state: State, round: State['round'], now: number, timedOut: boolean, frameVoid = false): State {
  const next = judgeTrial(state, round, now, timedOut, frameVoid)
  return next.result && !state.result ? { ...next, resultAt: now, revealSkipped: false } : next
}

function judgeTrial(state: State, round: State['round'], now: number, timedOut: boolean, frameVoid: boolean): State {
  const def = brainGame(state.gameId).def
  const outcome = def.outcome(round)
  if (!outcome || state.result) return { ...state, round, timedOut }
  const rules = GROUP_RULES[state.group]
  const kind = state.trialKind
  const qe = state.gameId === 'quickEye'
  const base = { correct: outcome.correct, accuracy: outcome.correct ? 1 : outcome.void ? 0 : outcome.accuracy, timedOut, void: false, kind, livesLost: 0, levelBefore: state.level }

  if (outcome.void) {
    // Only a dropped-frame void says the display cannot hold this exposure; a stalled or hidden tab
    // says nothing about the device, so it neither counts nor raises the floor.
    const frameVoids = state.frameVoids + (frameVoid ? 1 : 0)
    const tooMany = frameVoid && frameVoids >= 3 && frameVoids / (frameVoids + state.trialInRound) > 0.2
    return {
      ...state,
      round,
      timedOut,
      voidRun: state.voidRun + 1,
      lenient: state.lenient || state.voidRun + 1 >= LENIENT_AFTER_VOIDS,
      frameVoids: tooMany ? 0 : frameVoids,
      minExposureMs: tooMany ? raiseFloor(state.minExposureMs) : state.minExposureMs,
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

  if (kind === 'intro') {
    return { ...state, round, timedOut, voidRun: 0, introLeft: Math.max(0, state.introLeft - 1), result: { ...base, practice: true, points: 0, levelAfter: state.level } }
  }

  const median = recentMedian(state.correctRts)
  const fast = outcome.correct && rt !== null && median !== null && rt < median && state.gameId !== 'quickEye'
  const cap = levelCap(state.gameId, state)

  // Points: base by difficulty, a speed bonus against the player's own median, the run.
  // Whole points per trial, split so the parts add up to exactly what the trial scored.
  // Quick Eye: by stage and speed level (quickEyeBase), never by speed of answer.
  const rawBase = outcome.correct ? (qe ? quickEyeBase(state.variant, state.level) : 10 * Math.max(1, state.level)) : 0
  const points = outcome.correct ? (qe ? Math.round(rawBase * (1 + Math.min(state.stats.streak, 10) * 0.1)) : roundPoints(state.level, true, fast, state.stats.streak)) : 0
  const basePts = Math.round(rawBase)
  const speedPts = fast ? Math.round(rawBase * 1.25) - basePts : 0
  const comboPts = points - basePts - speedPts
  // Quick Eye: one of its two answers right keeps the run (neither grows it nor breaks it).
  const half = qe && !outcome.correct && outcome.accuracy === 0.5
  const streak = outcome.correct ? state.stats.streak + 1 : half ? state.stats.streak : 0
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
    const place = updatePlacement(state.place, state.level, outcome.correct, guessRate(view))
    const finished = placementDone(place)
    const handover = finished ? placementResult(place) : null
    const levelAfter = Math.min(cap, handover ? handover.level : placementLevel(place))
    const asked = view.kind === 'quickEye' && view.asksLocation
    return {
      ...state,
      round,
      timedOut,
      voidRun: 0,
      correctRts,
      placeLoc: asked && view.kind === 'quickEye' ? { ok: state.placeLoc.ok + (view.pickedDirection === view.correctDirection ? 1 : 0), n: state.placeLoc.n + 1 } : state.placeLoc,
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

  // Counted: the staircase, both steps scaled by how unsure the game still is.
  const k = stepMultiplier(state.group, state.sd)
  const levelAfter = Math.min(cap, stepLevel(state.group, state.level, outcome.correct, outcome.accuracy, k))
  const dir: 1 | -1 = outcome.correct ? 1 : -1
  const reversal = state.group !== 'span' && state.lastDir !== 0 && dir !== state.lastDir
  // In a relaxed-timing mode a timeout still moves the level down but costs no chance (EVIDENCE §4.3).
  // A game without lives (Quick Eye) never spends one.
  const forgivenTimeout = timedOut && state.timing !== 1
  let livesLost = rules.lives > 0 ? outcome.livesSpent ?? (outcome.correct || forgivenTimeout ? 0 : 1) : 0
  let lives: number
  if (state.group === 'span') {
    livesLost = outcome.correct || forgivenTimeout ? 0 : 1
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
    spanPassed: state.group === 'span' && outcome.correct ? Math.max(state.spanPassed, state.level) : state.spanPassed,
    sd: state.group === 'span' ? state.sd : shrinkSd(state.group, state.sd, reversal),
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
      legMarks: qe ? [...state.stats.legMarks, outcome.correct ? 'ok' : half ? 'half' : 'miss'] : state.stats.legMarks,
      rungUps: state.stats.rungUps + (qe && exposureMsFor(levelAfter) < exposureMsFor(state.level) ? 1 : 0),
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
    case 'exposed':
      if (state.result || state.over || !def.exposed) return state
      return judge(state, def.exposed(state.round, action.actualMs, action.frameMs, state.lenient), action.now, false, !state.lenient)
    case 'inputStarted':
      return state.inputStartedAt === null ? { ...state, inputStartedAt: action.now } : state
    case 'next': {
      const rules = GROUP_RULES[state.group]
      const qe = state.gameId === 'quickEye'
      const endPractice = state.trialKind === 'practice' && state.practiceLeft === 0
      const lives = endPractice ? rules.lives : state.lives
      const kind: TrialKind = state.practiceLeft > 0 ? 'practice' : state.introLeft > 0 ? 'intro' : state.place ? 'placement' : 'counted'
      const cap = levelCap(state.gameId, state)
      // Practice and rule-intro trials hold the level; placement picks its own; counted trials take
      // the stored level (which Quick Eye's stage ladder may just have eased back).
      const counted = kind === 'counted' ? (endPractice && state.seedLevel !== null ? state.seedLevel : action.level) : state.level
      const level = Math.min(cap, kind === 'placement' && state.place ? placeLevel(state) : counted)
      // A new Quick Eye stage re-opens the estimate so the new stage is found fast, and its
      // reversals start afresh: the old stage's never stand for the new one.
      const newStage = action.variant > state.variant
      const sd = newStage ? Math.max(state.sd, 1.5) : state.sd
      // Quick Eye's practice is the centre alone at its own exposures; its intro trials ease in.
      const trialVariant = qe && kind === 'practice' ? 1 : action.variant
      const trialLevel = !qe ? level : kind === 'practice' ? qePracticeLevel(state.practiceDone) : kind === 'intro' ? qeIntroLevel(level, state.introLeft) : level
      const ctx = buildCtx({ ...state, lives }, trialVariant)
      const { round, sig } = createTrial(state.gameId, trialLevel, action.seed, ctx, state.recentSigs)
      const fresh: State = {
        ...state,
        round,
        trialId: state.trialId + 1,
        level,
        variant: action.variant,
        sd,
        reversals: newStage ? [] : state.reversals,
        lastDir: newStage ? 0 : state.lastDir,
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
        stats: endPractice ? { ...state.stats, levelStart: level, levelEnd: level, bestLevel: level } : state.stats,
      }
      const introduced = easeIntroTrial(introduce(fresh, action.now), action.seed, ctx, state.recentSigs)
      // A Quick Eye stage reached (never during placement, which feeds no stage window): a short
      // interstitial between trials, the round paused under it. Only a stage that shows as one —
      // on the centre-only setting stages 1-9 look the same.
      const stageTo = qe ? shownStage(state, action.variant) : 0
      if (!qe || !newStage || kind === 'placement' || kind === 'practice' || stageTo <= shownStage(state, state.variant)) return introduced
      return {
        ...introduced,
        stageUp: {
          from: shownStage(state, state.variant),
          to: stageTo,
          variant: action.variant,
          knob: quickEyeKnob(action.variant, state.centerOnly),
          ruleFollows: introduced.intro !== null,
          id: introduced.trialId,
        },
        paused: true,
        pausedAt: introduced.pausedAt ?? action.now,
      }
    }
    case 'end': {
      if (state.over) return state
      const held = state.paused && state.pausedAt !== null ? action.now - state.pausedAt : 0
      const activeMs = Math.max(0, action.now - state.stats.startedAt - state.pausedMs - held)
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
        stageUp: null,
        stats: {
          ...state.stats,
          endedBy: action.reason,
          activeMs,
          cleared,
          placement: state.placementTrials > 0 ? (state.placed ? 'done' : 'partial') : 'none',
          points: state.stats.points + clear + clean,
          score: { ...state.stats.score, clear, clean },
        },
      }
    }
    case 'pause': {
      // Not mid-exposure: a Quick Eye stimulus is a few frames long and pausing it would void it.
      const view = def.view(state.round)
      if (state.over || state.paused || (view.kind === 'quickEye' && view.phase === 'stimulus')) return state
      return { ...state, paused: true, pausedAt: action.now }
    }
    case 'resume': {
      if (!state.paused || state.intro || state.stageUp) return state
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
      // Still under a stage-up interstitial: the round stays paused until that clears too.
      if (state.stageUp) return { ...state, intro: null, seenAdded }
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
    case 'ackStageUp': {
      if (!state.stageUp) return state
      // A new rule's card follows: the round stays paused under it (its time still not played time).
      if (state.intro) return { ...state, stageUp: null }
      const held = state.pausedAt === null ? 0 : action.now - state.pausedAt
      return { ...state, stageUp: null, paused: false, pausedAt: null, pausedMs: state.pausedMs + held }
    }
    case 'skipReveal':
      // Quick Eye's reveal, once it has been up long enough to be seen: on to the next trial now.
      if (state.gameId !== 'quickEye' || !state.result || state.over || state.paused || state.revealSkipped) return state
      if (state.resultAt === null || action.now - state.resultAt < REVEAL_SKIP_AFTER_MS) return state
      return { ...state, revealSkipped: true }
    case 'best':
      return {
        ...state,
        finalized: true,
        stats: { ...state.stats, isNewBest: action.isNewBest, tierUp: action.tierUp, achievements: action.achievements, suggestRelax: action.suggestRelax, stageReached: action.stageReached },
      }
  }
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
  const base = {
    platform,
    centerOnly: progress.settings.centerOnly,
    lives: rules.lives,
    minExposureMs: platform.minExposureMs,
  }
  const cap = levelCap(gameId, base)
  // Never played — or a placement left part-way (saved with n = 0), which starts again from where it got.
  const neverPlayed = (gp.rounds === 0 && !est) || (est !== undefined && est.n === 0)
  // A record from before skill estimates was climbed on the old, slow ladder (+0.15 a trial), so it
  // usually sits far below the player: placement re-finds the level once, starting from that record.
  const legacy = gp.rounds > 0 && !est && group !== 'span' && gameId !== 'pairs'
  const seenFn = (bit: number) => hasBit(meta.seen, bit)

  let level = gp.level
  let sd = est ? sdAfterDays(group, est.sd, daysAway) : legacySd(group)
  let place: PlacementState | null = null
  let placeStart: number | null = null
  let seedLevel: number | null = null
  if (neverPlayed || legacy) {
    if (group === 'span') {
      // Seed from the other span game: the same skill family, so start two lengths below the
      // longest it has passed (its estimate; bestLevel can be a length that was failed).
      const other: BrainGameId = gameId === 'memoryGrid' ? 'sequence' : 'memoryGrid'
      const og = progress.games[other]
      const oe = meta.sk[other]
      const passed = oe && oe.n > 0 ? oe.mu : og && og.rounds > 0 ? og.bestLevel - 1 : null
      seedLevel = passed === null ? rules.min : Math.max(rules.min, Math.round(passed) - 2)
    } else if (gameId === 'pairs') {
      // A board takes too long for a placement series: start a little below a cross-game guess.
      const seed = crossGameSeed(meta, gameId)
      seedLevel = seed === null ? rules.min : Math.max(1, Math.min(10, seed - 2))
      sd = SKILL[group].floor * 2
    } else {
      const qe = gameId === 'quickEye'
      const seed = legacy ? gp.level : est && est.n === 0 ? est.mu : qe ? null : crossGameSeed(meta, gameId)
      // An old record already played past its rules (they had no cards then): no rule ceiling.
      const hi = qe ? Math.min(11, cap) : Math.min(TIERS[gameId][4], cap, legacy ? Infinity : placementCeiling(gameId, seenFn))
      place = startPlacement({
        lo: rules.min,
        hi,
        // Quick Eye starts near 267ms rather than 500ms; others at an easy level 3 unless a seed says more.
        mu0: seed ?? 3,
        sigma0: qe ? 3 : seed === null ? 9 : 6,
        target: qe ? 0.8 : 0.85,
        slope: qe ? 1 : 2,
        maxMove: qe ? 2 : 3,
        // A Number Hunt grid takes half a minute: five trials, not eight. Quick Eye's first round
        // already opens with practice and a rule card's four trials: six to ten.
        minTrials: gameId === 'schulte' ? 5 : qe ? 6 : 8,
        maxTrials: gameId === 'schulte' ? 5 : qe ? 10 : 12,
      })
      // A never-played Quick Eye opens its placement at 267ms exactly, where the periphery card's
      // ramp (500 → 400 → 333 → 267ms) ends.
      if (qe && seed === null) placeStart = QE_PLACE_START
      sd = SKILL[group].sd0
      level = practiceLeft > 0 ? rules.min : placeLevel({ place, placeStart })
    }
  } else if (est) {
    // The last round already set the start (with its drop, or none after a strong clear); only
    // days away add to it — the start falls with the grown uncertainty, the bigger steps re-find it.
    level = Math.min(gp.level, est.mu) - Math.max(0, 0.5 * (sd - est.sd))
  }
  // Quick Eye's redesigned field makes the same flash harder (no afterimage on a mid-grey field):
  // a returning player starts two steps easier, once, with the estimate re-opened so the bigger
  // steps re-find the level. The stage stays. Marked done by the field's notice (mechanics).
  const clearView = mechanicInfo('quickEye.clearView')
  if (gameId === 'quickEye' && !place && gp.rounds > 0 && clearView && !hasBit(meta.seen, clearView.bit)) {
    level -= 2
    sd = SKILL[group].sd0
  }
  if (seedLevel !== null) {
    // Practice is level-one basics; the seeded start comes after it.
    level = practiceLeft > 0 ? rules.min : seedLevel
    if (practiceLeft === 0) seedLevel = null
  }
  level = Math.min(cap, Math.max(rules.min, level))
  const trialKind: TrialKind = practiceLeft > 0 ? 'practice' : place ? 'placement' : 'counted'
  const qePractice = gameId === 'quickEye' && trialKind === 'practice'
  const trialSeed = randomSeed()
  const ctx = buildCtx(base, qePractice ? 1 : progress.quickEye.variant)
  const { round, sig } = createTrial(gameId, qePractice ? qePracticeLevel(practiceDone) : level, trialSeed, ctx, [])
  const now = Date.now()
  const state: State = {
    gameId,
    group,
    platform,
    timing: progress.settings.timing,
    centerOnly: base.centerOnly,
    round,
    trialId: 1,
    level,
    startLevel: level,
    variant: progress.quickEye.variant,
    startVariant: progress.quickEye.variant,
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
    lenient: false,
    recentSigs: [sig],
    // The speed bonus compares with the player's own median, carried between rounds.
    correctRts: meta.rt[gameId] ? Array.from({ length: 5 }, () => meta.rt[gameId] as number) : [],
    frameVoids: 0,
    minExposureMs: platform.minExposureMs,
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
      endedBy: null,
      cleared: false,
      placement: 'none',
      isNewBest: false,
      score: { base: 0, speed: 0, combo: 0, clear: 0, clean: 0 },
      tierUp: null,
      achievements: [],
      suggestRelax: false,
      legMarks: [],
      rungUps: 0,
      stageReached: null,
    },
    placeStart,
    placeLoc: { ok: 0, n: 0 },
    stageUp: null,
    resultAt: null,
    revealSkipped: false,
  }
  return easeIntroTrial(introduce(state, now), trialSeed, ctx, [])
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
  const earlyWipe = s.stats.endedBy === 'lives' && s.counted < 8
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
  if ((s.counted === 0 && s.placementTrials === 0) || (s.place && s.counted === 0)) nextStart = undefined
  else if (id === 'quickEye' && progress.quickEye.variant !== s.startVariant) nextStart = stored // the new stage's eased level stands
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
    if (settled !== null) tierValue = id === 'quickEye' ? quickEyeIndex(quickEyeTierStage(progress.quickEye.variant, progress.settings.centerOnly), settled) : settled
  }
  const reached = tierValue === null ? 0 : tierFor(id, tierValue)
  const newTier = Math.max(oldTier, reached)
  const tierUp = newTier > oldTier ? newTier : null

  const today = dayNumber(localDayKey())
  const median = recentMedian(s.correctRts)
  // A placement stopped part-way: keep what it found so far, and run it again next time from there.
  const interrupted = s.place && s.placementTrials > 0 && s.counted === 0 ? placementResult(s.place) : null
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
      // Without lives (Quick Eye) "without losing a chance" means without a miss.
      livesLost: GROUP_RULES[group].lives > 0 ? s.livesLostTotal : s.misses,
      bestStreak: s.stats.bestStreak,
      spanLength: group === 'span' && s.spanPassed > 0 ? s.spanPassed + 2 : 0,
      flawlessHunt: s.flawlessHunt,
    },
    useBrainStore.getState().progress,
    metaAfter,
  )
  if (achievements.length) updateMeta?.((m) => ({ ...m, ach: achievements.reduce((mask, a) => setBit(mask, achievementBit(a)), m.ach) }))

  const timed = id !== 'quickEye'
  const variantNow = useBrainStore.getState().progress.quickEye.variant
  const stageReached = id === 'quickEye' && shownStage(s, variantNow) > shownStage(s, s.startVariant) ? shownStage(s, variantNow) : null
  return { isNewBest, tierUp, achievements, suggestRelax: wipes >= 2 && timed && s.timing === 1, stageReached }
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
  const busy = state.result !== null || state.over
  const pending = busy || state.paused ? null : def.pendingMs(state.round)
  const accepts = !busy && !state.paused && def.acceptsInput(state.round)
  const limit = trialLimit(state)
  const stateRef = useRef(state)
  stateRef.current = state
  const view: RoundView = def.view(state.round)

  // Time passing inside a trial: memorise phases, sequence flashes, Quick Eye's fixation and mask.
  // A pause keeps what was left of the phase (no free study time); Quick Eye's fixation restarts in
  // full, so the flash never comes a moment after the pause screen closes.
  const phase = useRef<{ round: unknown; armedAt: number; wait: number; left: number | null } | null>(null)
  useEffect(() => {
    if (pending === null) return
    const prior = phase.current
    const keepsLeft = state.gameId !== 'quickEye'
    const wait = keepsLeft && prior && prior.round === state.round && prior.left !== null ? prior.left : pending
    const armed = { round: state.round as unknown, armedAt: Date.now(), wait, left: null as number | null }
    phase.current = armed
    const t = setTimeout(() => dispatch({ type: 'advance', now: Date.now() }), wait)
    return () => {
      clearTimeout(t)
      armed.left = Math.max(0, armed.wait - (Date.now() - armed.armedAt))
    }
  }, [pending, state.round, state.gameId])

  // A Quick Eye stimulus the platform never reported (a hidden tab, a stalled renderer) is voided.
  const stalled = !busy && !state.paused && view.kind === 'quickEye' && view.phase === 'stimulus'
  useEffect(() => {
    if (!stalled || view.kind !== 'quickEye') return
    const t = setTimeout(() => dispatch({ type: 'timeout', now: Date.now() }), view.exposureMs + 2500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stalled, state.trialId])

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
    const outcome = def.outcome(s.round)
    // Placement flashes stay out of Quick Eye's stage window: the protocol judges stages on the staircase.
    const shownMs = result.kind === 'counted' ? outcome?.shownMs : undefined
    store.getState().record(s.gameId, { level: result.levelAfter, correct: result.correct, points: result.points, shownMs })
    // Quick Eye's placement just handed over (its last trial clears `place`): a player it put at the
    // easiest flash who placed fewer than half the stars starts on the centre alone — variant 1,
    // with its own bar — rather than at a stage they cannot yet play. Never announced.
    if (
      s.gameId === 'quickEye' &&
      result.kind === 'placement' &&
      s.place === null &&
      !s.centerOnly &&
      s.variant === 2 &&
      result.levelAfter <= 0.5 &&
      s.placeLoc.n > 0 &&
      s.placeLoc.ok / s.placeLoc.n < 0.5
    ) {
      store.getState().setQuickEyeVariant?.(1)
    }
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
    const isQuickEye = s.gameId === 'quickEye'
    const delay = state.revealSkipped
      ? 0
      : result.void
        ? REVEAL.void
        : isQuickEye
          ? result.correct
            ? REVEAL.quickEyeRight
            : result.accuracy === 0.5
              ? REVEAL.quickEyeHalf
              : REVEAL.quickEyeWrong
          : result.correct
            ? REVEAL.right
            : REVEAL.wrong
    const t = setTimeout(() => {
      const cur = stateRef.current
      if (result.void && cur.voidRun >= END_AFTER_VOIDS) return dispatch({ type: 'end', reason: 'void', now: Date.now() })
      if (result.kind === 'counted' && !result.void) {
        // A game without lives (Quick Eye) ends only at its cap, its time budget or the player's stop.
        if (rules.lives > 0 && cur.lives <= 0) return dispatch({ type: 'end', reason: 'lives', now: Date.now() })
        if (rules.roundCap !== null && cur.counted >= rules.roundCap) return dispatch({ type: 'end', reason: 'cap', now: Date.now() })
      }
      // The slot's time is up: this trial was the last (never mid-trial, never during practice
      // left unfinished — practice is short and is what makes the game playable).
      const played = Date.now() - cur.stats.startedAt - cur.pausedMs
      if (budget.current !== undefined && played >= budget.current && cur.practiceLeft === 0) return dispatch({ type: 'end', reason: 'time', now: Date.now() })
      const progress = store.getState().progress
      dispatch({ type: 'next', level: gameProgress(progress, cur.gameId).level, variant: progress.quickEye.variant, seed: randomSeed(), now: Date.now() })
    }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result, state.paused, state.revealSkipped])

  // A stage-up interstitial clears itself (a tap clears it sooner: ackStageUp).
  useEffect(() => {
    if (!state.stageUp) return
    const t = setTimeout(() => dispatch({ type: 'ackStageUp', now: Date.now() }), STAGE_UP_MS)
    return () => clearTimeout(t)
  }, [state.stageUp])

  // The round is over: write its end once.
  useEffect(() => {
    if (!state.over) return
    const out = finishRound(stateRef.current)
    dispatch({ type: 'best', ...out })
  }, [state.over])

  const tap = useCallback((index: number) => dispatch({ type: 'tap', index, now: Date.now() }), [])
  const reportExposure = useCallback(
    (actualMs: number, frameMs: number) => dispatch({ type: 'exposed', actualMs, frameMs, now: Date.now() }),
    [],
  )
  const stop = useCallback(() => dispatch({ type: 'end', reason: 'stop', now: Date.now() }), [])
  const pause = useCallback(() => dispatch({ type: 'pause', now: Date.now() }), [])
  const resume = useCallback(() => dispatch({ type: 'resume', now: Date.now() }), [])
  const ackIntro = useCallback(() => dispatch({ type: 'ackIntro', now: Date.now() }), [])
  const ackStageUp = useCallback(() => dispatch({ type: 'ackStageUp', now: Date.now() }), [])
  const skipReveal = useCallback(() => dispatch({ type: 'skipReveal', now: Date.now() }), [])

  // Quick Eye's window, read reactively: "hold top speed n/14" moves the moment a trial is saved.
  const qeProgress = useBrainStore((st) => st.progress.quickEye)
  const isQuickEye = state.gameId === 'quickEye'
  const shownLevel = state.result ? state.result.levelAfter : state.level
  const qeCap = isQuickEye ? levelCap(state.gameId, state) : Infinity
  const speed = isQuickEye && state.trialKind === 'counted' ? quickEyeSpeedGauge(shownLevel, stepMultiplier(state.group, state.sd), qeCap) : null
  const held = speed?.atTop && qeProgress.variant === state.variant ? quickEyeHold(qeProgress.recentMs, qeProgress.recentOk, state.variant) : null

  const meta = (store.getState() as { meta?: BrainMeta }).meta
  return {
    gameId: state.gameId,
    group: state.group,
    trialId: state.trialId,
    level: displayLevel(state.result ? state.result.levelAfter : state.level),
    view,
    tap,
    reportExposure,
    stop,
    pause,
    resume,
    /** Paused by the player (a rule card or a stage-up is not a pause: see `intro`, `stageUp`). */
    paused: state.paused && !state.intro && !state.stageUp,
    /** Pausing is not offered mid-exposure, or under a rule card or a stage-up. */
    canPause: !state.over && !state.intro && !state.stageUp && !(view.kind === 'quickEye' && view.phase === 'stimulus'),
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
    placing: state.trialKind === 'placement' || (state.trialKind === 'intro' && state.place !== null),
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
    roundCap: rules.roundCap,
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
     * Quick Eye's display is being measured — fixation, stimulus, mask, the round running. Hold every
     * chip, count-up, toast, scenery animation, sound and vibration until it is false (the one
     * exception: the `fixation` fx's ready cue at its start).
     */
    quiet: isQuickEye && !busy && !state.paused && (view.kind === 'quickEye' && (view.phase === 'fixation' || view.phase === 'stimulus' || view.phase === 'mask')),
    /** Quick Eye: the stage as shown, "Stage N" (the trial's own — practice is stage 1). Null for other games. */
    stage: isQuickEye && view.kind === 'quickEye' ? shownStage(state, view.variant) : null,
    /**
     * Quick Eye's speed gauge, on counted trials only (null in practice, rule-card trials and
     * placement): `shown` speed level 0-11, `pips` 0-3 of 4 filled, `toNext` right answers until it
     * rises (`quickEye.gauge` {{count}}), `atTop` at the platform's shortest flash.
     */
    speed,
    /** At top speed: "hold top speed n/need" (`quickEye.hold`) — the evidence criterion's progress. Null otherwise. */
    hold: held ? { filled: Math.min(QUICK_EYE_HOLD_NEED, held.filled), need: QUICK_EYE_HOLD_NEED } : null,
    /** Quick Eye: the leg so far, one mark per counted trial (`roundCap` cells; no red for a miss). */
    legMarks: state.stats.legMarks,
    /** Quick Eye: a stage reached — show the interstitial while set; it clears itself after 2s, or call ackStageUp on a tap. */
    stageUp: state.stageUp,
    ackStageUp,
    /** Quick Eye: on with the next trial now — taken from 500ms after the result (a tap on the board, Space / Enter). */
    skipReveal,
  }
}

export type BrainRound = ReturnType<typeof useBrainRound>
