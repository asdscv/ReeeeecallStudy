import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  type BrainGameId,
  type CreateContext,
  type GameGroup,
  type RoundView,
  type TimingMode,
  GROUP_RULES,
  PRACTICE_TRIALS,
  QUICK_EYE_LADDER_MS,
  brainGame,
  createRng,
  displayLevel,
  gameProgress,
  randomSeed,
  recentMedian,
  restartLevel,
  roundPoints,
  scaledLimit,
  stepLevel,
} from '../lib/brain-games'
import { useBrainStore } from '../stores/brain-store'

/**
 * One round of one game — trials until the lives run out, the round's cap is reached, or the
 * player stops. Web and mobile only draw `view` and call `tap` / `reportExposure`; every timer and
 * every rule lives here, so the two platforms cannot drift on how long a memorise phase lasts or
 * what a miss costs. The rules themselves are in lib/brain-games/rules.ts.
 */
export interface PlatformContext {
  /** Widest grid with cells ≥ 56dp on this screen (see maxColsFor). */
  maxCols: number
  /** Shortest Quick Eye exposure this platform shows reliably. */
  minExposureMs: number
  /** Quick Eye slots per ring. */
  ringSlots: number[]
}

export interface TrialResult {
  correct: boolean
  timedOut: boolean
  /** The trial did not count (dropped frames) and is being replaced. */
  void: boolean
  practice: boolean
  points: number
  livesLost: number
  levelBefore: number
  levelAfter: number
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
  endedBy: 'lives' | 'cap' | 'stop' | null
  isNewBest: boolean
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
  trialInRound: number
  practiceLeft: number
  trialIsPractice: boolean
  inputStartedAt: number | null
  timedOut: boolean
  result: TrialResult | null
  lives: number
  over: boolean
  /** The round's end has been recorded (best score, next start level) — `stats` is final. */
  finalized: boolean
  /** Paused by the player: every clock stops; the input clock resumes where it was. */
  paused: boolean
  pausedAt: number | null
  /** Total paused time so far, for the round's active time. */
  pausedMs: number
  /** Voided trials in a row. After a few, Quick Eye accepts the real exposure; after more, the round ends. */
  voidRun: number
  recentSigs: string[]
  correctRts: number[]
  /** Voids from mismatched frames since the floor last moved (stalls and hidden tabs don't count). */
  frameVoids: number
  minExposureMs: number
  stats: RoundStats
}

type Action =
  | { type: 'advance'; now: number }
  | { type: 'tap'; index: number; now: number }
  | { type: 'timeout'; now: number }
  | { type: 'inputStarted'; now: number }
  | { type: 'exposed'; actualMs: number; frameMs: number; now: number }
  | { type: 'next'; level: number; variant: number; seed: number; endPractice: boolean }
  | { type: 'end'; reason: 'lives' | 'cap' | 'stop'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'best'; isNewBest: boolean }

const RECENT_SIGS = 12
/** Voids in a row after which Quick Eye takes the measured exposure as it is, and then ends the round. */
const LENIENT_AFTER_VOIDS = 5
const END_AFTER_VOIDS = 8
const REVEAL = { right: 700, wrong: 1500, quickEyeRight: 900, quickEyeWrong: 1400, void: 250 }

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

/** The level past which this game's puzzle stops changing on this screen (see BrainGameDef.maxLevel). */
function levelCap(gameId: BrainGameId, s: Pick<State, 'platform' | 'centerOnly' | 'lives' | 'minExposureMs'>): number {
  const def = brainGame(gameId).def
  return def.maxLevel ? def.maxLevel(buildCtx(s, 1)) : Infinity
}

function newTrial(gameId: BrainGameId, level: number, seed: number, ctx: CreateContext, recentSigs: string[]) {
  const def = brainGame(gameId).def
  const rng = createRng(seed)
  let round = def.create(level, rng, ctx)
  for (let i = 0; i < 6 && recentSigs.includes(def.signature(round)); i++) round = def.create(level, rng, ctx)
  return { round, sig: def.signature(round) as string }
}

/** The next exposure floor when too many trials on this device are being voided. */
function raiseFloor(ms: number): number {
  const ladder = [...QUICK_EYE_LADDER_MS].reverse()
  return ladder.find((x) => x > ms) ?? ms
}

function judge(state: State, round: State['round'], now: number, timedOut: boolean, frameVoid = false): State {
  const def = brainGame(state.gameId).def
  const outcome = def.outcome(round)
  if (!outcome || state.result) return { ...state, round, timedOut }
  const rules = GROUP_RULES[state.group]

  if (outcome.void) {
    // Only a dropped-frame void says the display cannot hold this exposure. A stalled or hidden tab
    // says nothing about the device, so it neither counts nor raises the floor. After a raise the
    // count starts again, so the floor moves one step per three bad frames, not on every void.
    const frameVoids = state.frameVoids + (frameVoid ? 1 : 0)
    const tooMany = frameVoid && frameVoids >= 3 && frameVoids / (frameVoids + state.trialInRound) > 0.2
    return {
      ...state,
      round,
      timedOut,
      voidRun: state.voidRun + 1,
      frameVoids: tooMany ? 0 : frameVoids,
      minExposureMs: tooMany ? raiseFloor(state.minExposureMs) : state.minExposureMs,
      result: { correct: false, timedOut, void: true, practice: state.trialIsPractice, points: 0, livesLost: 0, levelBefore: state.level, levelAfter: state.level },
    }
  }

  const rt = state.inputStartedAt === null ? null : now - state.inputStartedAt
  if (state.trialIsPractice) {
    return {
      ...state,
      round,
      timedOut,
      voidRun: 0,
      practiceLeft: Math.max(0, state.practiceLeft - 1),
      result: { correct: outcome.correct, timedOut, void: false, practice: true, points: 0, livesLost: 0, levelBefore: state.level, levelAfter: state.level },
    }
  }

  const median = recentMedian(state.correctRts)
  const fast = outcome.correct && rt !== null && median !== null && rt < median
  const levelAfter = Math.min(levelCap(state.gameId, state), stepLevel(state.group, state.level, outcome.correct, outcome.accuracy, state.trialInRound))
  // In a relaxed-timing mode a timeout still moves the level down but costs no life — except a span
  // trial with nothing entered: waiting out a length the player cannot recall would otherwise loop
  // at that length forever, since a miss never moves a span level.
  const forgivenTimeout = timedOut && state.timing !== 1 && (state.group !== 'span' || outcome.accuracy > 0)
  let livesLost = outcome.livesSpent ?? (outcome.correct || forgivenTimeout ? 0 : 1)
  let lives: number
  if (state.group === 'span') {
    // A relaxed-timing timeout costs no chance here either; the length still does not move up.
    livesLost = outcome.correct || forgivenTimeout ? 0 : 1
    lives = outcome.correct ? rules.lives : Math.max(0, state.lives - livesLost)
  } else {
    lives = Math.max(0, state.lives - livesLost)
  }
  const points = roundPoints(state.level, outcome.correct, fast, state.stats.streak)
  const streak = outcome.correct ? state.stats.streak + 1 : 0
  return {
    ...state,
    round,
    timedOut,
    lives,
    voidRun: 0,
    trialInRound: state.trialInRound + 1,
    correctRts: outcome.correct && rt !== null ? [...state.correctRts, rt].slice(-20) : state.correctRts,
    result: { correct: outcome.correct, timedOut, void: false, practice: false, points, livesLost, levelBefore: state.level, levelAfter },
    stats: {
      ...state.stats,
      trials: state.stats.trials + 1,
      correct: state.stats.correct + (outcome.correct ? 1 : 0),
      points: state.stats.points + points,
      streak,
      bestStreak: Math.max(state.stats.bestStreak, streak),
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
      // A timer is a request, not a verdict: one armed before a pause (or before a blocking dialog
      // that a resume followed) can fire late. Only a deadline that has really passed counts.
      const limit = scaledLimit(def.timeLimitMs(state.round), state.timing)
      if (limit !== null && state.inputStartedAt !== null && action.now < state.inputStartedAt + limit - 50) return state
      return judge(state, def.timeout(state.round), action.now, true)
    }
    case 'exposed':
      if (state.result || state.over || !def.exposed) return state
      return judge(state, def.exposed(state.round, action.actualMs, action.frameMs, state.voidRun >= LENIENT_AFTER_VOIDS), action.now, false, true)
    case 'inputStarted':
      return state.inputStartedAt === null ? { ...state, inputStartedAt: action.now } : state
    case 'next': {
      const rules = GROUP_RULES[state.group]
      const lives = action.endPractice ? rules.lives : state.lives
      const practice = !action.endPractice && state.practiceLeft > 0
      const ctx = buildCtx({ ...state, lives }, action.variant)
      const level = Math.min(levelCap(state.gameId, state), action.level)
      const { round, sig } = newTrial(state.gameId, level, action.seed, ctx, state.recentSigs)
      return {
        ...state,
        round,
        trialId: state.trialId + 1,
        level,
        lives,
        practiceLeft: action.endPractice ? 0 : state.practiceLeft,
        trialIsPractice: practice,
        inputStartedAt: null,
        timedOut: false,
        result: null,
        recentSigs: [...state.recentSigs, sig].slice(-RECENT_SIGS),
        stats: action.endPractice ? { ...state.stats, levelStart: level, levelEnd: level, bestLevel: level } : state.stats,
      }
    }
    case 'end': {
      if (state.over) return state
      const held = state.paused && state.pausedAt !== null ? action.now - state.pausedAt : 0
      const activeMs = Math.max(0, action.now - state.stats.startedAt - state.pausedMs - held)
      return { ...state, over: true, paused: false, stats: { ...state.stats, endedBy: action.reason, activeMs } }
    }
    case 'pause': {
      // Not mid-exposure: a Quick Eye stimulus is a few frames long and pausing it would void it.
      const view = def.view(state.round)
      if (state.over || state.paused || (view.kind === 'quickEye' && view.phase === 'stimulus')) return state
      return { ...state, paused: true, pausedAt: action.now }
    }
    case 'resume': {
      if (!state.paused) return state
      const held = state.pausedAt === null ? 0 : action.now - state.pausedAt
      return {
        ...state,
        paused: false,
        pausedAt: null,
        pausedMs: state.pausedMs + held,
        inputStartedAt: state.inputStartedAt === null ? null : state.inputStartedAt + held,
      }
    }
    case 'best':
      return { ...state, finalized: true, stats: { ...state.stats, isNewBest: action.isNewBest } }
  }
}

function init({ gameId, platform }: { gameId: BrainGameId; platform: PlatformContext }): State {
  const progress = useBrainStore.getState().progress
  const entry = brainGame(gameId)
  const rules = GROUP_RULES[entry.group]
  const stored = gameProgress(progress, gameId).level
  const practiceLeft = progress.practiced.includes(gameId) ? 0 : PRACTICE_TRIALS
  const base = {
    platform,
    centerOnly: progress.settings.centerOnly,
    lives: rules.lives,
    minExposureMs: platform.minExposureMs,
  }
  // A level earned on a wider screen (or before a cap existed) starts at this screen's ceiling.
  const level = Math.min(levelCap(gameId, base), stored)
  const { round, sig } = newTrial(gameId, level, randomSeed(), buildCtx(base, progress.quickEye.variant), [])
  return {
    gameId,
    group: entry.group,
    platform,
    timing: progress.settings.timing,
    centerOnly: base.centerOnly,
    round,
    trialId: 1,
    level,
    trialInRound: 0,
    practiceLeft,
    trialIsPractice: practiceLeft > 0,
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
    correctRts: [],
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
      startedAt: Date.now(),
      activeMs: 0,
      endedBy: null,
      isNewBest: false,
    },
  }
}

export function useBrainRound(gameId: BrainGameId, platform: PlatformContext) {
  const [state, dispatch] = useReducer(reducer, { gameId, platform }, init)
  const store = useBrainStore
  const def = brainGame(state.gameId).def
  const rules = GROUP_RULES[state.group]
  const busy = state.result !== null || state.over
  const pending = busy || state.paused ? null : def.pendingMs(state.round)
  const accepts = !busy && def.acceptsInput(state.round)
  const limit = scaledLimit(def.timeLimitMs(state.round), state.timing)
  const stateRef = useRef(state)
  stateRef.current = state
  const view: RoundView = def.view(state.round)

  // Time passing inside a trial: memorise phases, sequence flashes, Quick Eye's fixation and mask.
  // A pause keeps what was left of the phase: resuming must not replay a whole memorise phase, or
  // pausing (or a phone call) would buy unlimited study time.
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

  // A Quick Eye stimulus the platform never reported (a hidden tab, a stalled renderer) is voided.
  const stalled = !busy && view.kind === 'quickEye' && view.phase === 'stimulus'
  useEffect(() => {
    if (!stalled || view.kind !== 'quickEye') return
    const t = setTimeout(() => dispatch({ type: 'timeout', now: Date.now() }), view.exposureMs + 2500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stalled, state.trialId])

  // The input clock starts the first time the trial takes input, and runs once per trial.
  useEffect(() => {
    if (accepts && state.inputStartedAt === null) dispatch({ type: 'inputStarted', now: Date.now() })
  }, [accepts, state.inputStartedAt])

  useEffect(() => {
    if (state.inputStartedAt === null || busy || limit === null || state.paused) return
    const left = state.inputStartedAt + limit - Date.now()
    const t = setTimeout(() => dispatch({ type: 'timeout', now: Date.now() }), Math.max(0, left))
    return () => clearTimeout(t)
    // The limit is fixed for a trial; re-arming on every tap would be wrong. Resuming from a pause
    // moves `inputStartedAt`, which re-arms it with the time that was left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.trialId, state.inputStartedAt, busy, state.paused])

  // A judged trial is saved once, the moment it is judged.
  useEffect(() => {
    const result = state.result
    if (!result || result.void || result.practice) return
    const s = stateRef.current
    const outcome = def.outcome(s.round)
    store.getState().record(s.gameId, { level: result.levelAfter, correct: result.correct, points: result.points, shownMs: outcome?.shownMs })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result])

  // Then the answer shows for a beat, and the next trial comes — or the round ends.
  useEffect(() => {
    const result = state.result
    if (!result || state.over || state.paused) return
    const s = stateRef.current
    const isQuickEye = s.gameId === 'quickEye'
    const delay = result.void ? REVEAL.void : result.correct ? (isQuickEye ? REVEAL.quickEyeRight : REVEAL.right) : isQuickEye ? REVEAL.quickEyeWrong : REVEAL.wrong
    const t = setTimeout(() => {
      const cur = stateRef.current
      // A device whose flashes never come out right (or a stimulus that never reports) must not
      // keep the round going forever on trials that do not count.
      if (result.void && cur.voidRun >= END_AFTER_VOIDS) return dispatch({ type: 'end', reason: 'cap', now: Date.now() })
      if (!result.practice && !result.void) {
        if (cur.lives <= 0) return dispatch({ type: 'end', reason: 'lives', now: Date.now() })
        if (rules.roundCap !== null && cur.trialInRound >= rules.roundCap) return dispatch({ type: 'end', reason: 'cap', now: Date.now() })
      }
      const endPractice = result.practice && cur.practiceLeft === 0
      if (endPractice) store.getState().practiced(cur.gameId)
      const progress = store.getState().progress
      // Practice and void trials leave the level where it was; a counted trial takes the stored
      // level, which Quick Eye's variant ladder may just have eased back.
      const level = result.practice || result.void ? cur.level : gameProgress(progress, cur.gameId).level
      dispatch({ type: 'next', level, variant: progress.quickEye.variant, seed: randomSeed(), endPractice })
    }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result, state.paused])

  // The round is over: keep its score, and set where the next round starts — a little below where
  // this one finished, never back to the floor.
  useEffect(() => {
    if (!state.over) return
    const s = stateRef.current
    const counted = s.stats.trials > 0
    // From the STORED level, not the round's last one: when Quick Eye's next variant opened on the
    // final trial, the store already holds the eased level and the round's would undo the easing.
    const stored = gameProgress(store.getState().progress, s.gameId).level
    const next = counted ? { id: s.gameId, level: restartLevel(s.group, stored, s.stats.bestLevel) } : undefined
    const round = counted ? { level: s.stats.levelEnd, accuracy: s.stats.correct / s.stats.trials } : undefined
    const { isNewBest } = store.getState().finishRun(s.gameId, s.stats.points, next, round)
    dispatch({ type: 'best', isNewBest })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.over])

  const tap = useCallback((index: number) => dispatch({ type: 'tap', index, now: Date.now() }), [])
  const reportExposure = useCallback(
    (actualMs: number, frameMs: number) => dispatch({ type: 'exposed', actualMs, frameMs, now: Date.now() }),
    [],
  )
  const stop = useCallback(() => dispatch({ type: 'end', reason: 'stop', now: Date.now() }), [])
  const pause = useCallback(() => dispatch({ type: 'pause', now: Date.now() }), [])
  const resume = useCallback(() => dispatch({ type: 'resume', now: Date.now() }), [])

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
    paused: state.paused,
    /** Pausing is not offered mid-exposure. */
    canPause: !state.over && !(view.kind === 'quickEye' && view.phase === 'stimulus'),
    result: state.result,
    lives: state.lives,
    maxLives: rules.lives,
    practice: state.trialIsPractice,
    practiceDone: PRACTICE_TRIALS - state.practiceLeft,
    practiceTotal: PRACTICE_TRIALS,
    over: state.over,
    /** The round is over AND its end is recorded — report `stats` to the caller on this, not on `over`. */
    done: state.over && state.finalized,
    stats: state.stats,
    trialInRound: state.trialInRound,
    roundCap: rules.roundCap,
    /** The taps that answer this trial — for tests and automated play-throughs; never drawn. */
    solution: busy ? null : def.solution(state.round),
    /** Present while the input clock runs; platforms animate a bar from it. */
    timer:
      state.inputStartedAt !== null && !busy && limit !== null && !state.paused
        ? { startedAt: state.inputStartedAt, limitMs: limit }
        : null,
  }
}

export type BrainRound = ReturnType<typeof useBrainRound>
