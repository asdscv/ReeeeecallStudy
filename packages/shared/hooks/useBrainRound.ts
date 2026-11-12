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
  recentSigs: string[]
  correctRts: number[]
  voids: number
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
  | { type: 'end'; reason: 'lives' | 'cap' | 'stop' }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'best'; isNewBest: boolean }

const RECENT_SIGS = 12
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

function judge(state: State, round: State['round'], now: number, timedOut: boolean): State {
  const def = brainGame(state.gameId).def
  const outcome = def.outcome(round)
  if (!outcome || state.result) return { ...state, round, timedOut }
  const rules = GROUP_RULES[state.group]

  if (outcome.void) {
    const voids = state.voids + 1
    const tooMany = voids >= 3 && voids / (voids + state.trialInRound) > 0.2
    return {
      ...state,
      round,
      timedOut,
      voids,
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
      practiceLeft: Math.max(0, state.practiceLeft - 1),
      result: { correct: outcome.correct, timedOut, void: false, practice: true, points: 0, livesLost: 0, levelBefore: state.level, levelAfter: state.level },
    }
  }

  const median = recentMedian(state.correctRts)
  const fast = outcome.correct && rt !== null && median !== null && rt < median
  const levelAfter = stepLevel(state.group, state.level, outcome.correct, outcome.accuracy, state.trialInRound)
  // In a relaxed-timing mode a timeout still moves the level down but costs no life.
  const forgivenTimeout = timedOut && state.timing !== 1
  let livesLost = outcome.livesSpent ?? (outcome.correct || forgivenTimeout ? 0 : 1)
  let lives: number
  if (state.group === 'span') {
    lives = outcome.correct ? rules.lives : Math.max(0, state.lives - 1)
    livesLost = outcome.correct ? 0 : 1
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
    case 'timeout':
      return state.result || state.over ? state : judge(state, def.timeout(state.round), action.now, true)
    case 'exposed':
      if (state.result || state.over || !def.exposed) return state
      return judge(state, def.exposed(state.round, action.actualMs, action.frameMs), action.now, false)
    case 'inputStarted':
      return state.inputStartedAt === null ? { ...state, inputStartedAt: action.now } : state
    case 'next': {
      const rules = GROUP_RULES[state.group]
      const lives = action.endPractice ? rules.lives : state.lives
      const practice = !action.endPractice && state.practiceLeft > 0
      const ctx = buildCtx({ ...state, lives }, action.variant)
      const { round, sig } = newTrial(state.gameId, action.level, action.seed, ctx, state.recentSigs)
      return {
        ...state,
        round,
        trialId: state.trialId + 1,
        level: action.level,
        lives,
        practiceLeft: action.endPractice ? 0 : state.practiceLeft,
        trialIsPractice: practice,
        inputStartedAt: null,
        timedOut: false,
        result: null,
        recentSigs: [...state.recentSigs, sig].slice(-RECENT_SIGS),
        stats: action.endPractice ? { ...state.stats, levelStart: action.level, levelEnd: action.level, bestLevel: action.level } : state.stats,
      }
    }
    case 'end':
      return state.over ? state : { ...state, over: true, paused: false, stats: { ...state.stats, endedBy: action.reason } }
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
  const level = gameProgress(progress, gameId).level
  const practiceLeft = progress.practiced.includes(gameId) ? 0 : PRACTICE_TRIALS
  const base = {
    platform,
    centerOnly: progress.settings.centerOnly,
    lives: rules.lives,
    minExposureMs: platform.minExposureMs,
  }
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
    recentSigs: [sig],
    correctRts: [],
    voids: 0,
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
  useEffect(() => {
    if (pending === null) return
    const t = setTimeout(() => dispatch({ type: 'advance', now: Date.now() }), pending)
    return () => clearTimeout(t)
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
      if (!result.practice && !result.void) {
        if (cur.lives <= 0) return dispatch({ type: 'end', reason: 'lives' })
        if (rules.roundCap !== null && cur.trialInRound >= rules.roundCap) return dispatch({ type: 'end', reason: 'cap' })
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
    const next = counted ? { id: s.gameId, level: restartLevel(s.group, s.stats.levelEnd, s.stats.bestLevel) } : undefined
    const { isNewBest } = store.getState().finishRun(s.gameId, s.stats.points, next)
    dispatch({ type: 'best', isNewBest })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.over])

  const tap = useCallback((index: number) => dispatch({ type: 'tap', index, now: Date.now() }), [])
  const reportExposure = useCallback(
    (actualMs: number, frameMs: number) => dispatch({ type: 'exposed', actualMs, frameMs, now: Date.now() }),
    [],
  )
  const stop = useCallback(() => dispatch({ type: 'end', reason: 'stop' }), [])
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
    /** Present while the input clock runs; platforms animate a bar from it. */
    timer:
      state.inputStartedAt !== null && !busy && limit !== null && !state.paused
        ? { startedAt: state.inputStartedAt, limitMs: limit }
        : null,
  }
}

export type BrainRound = ReturnType<typeof useBrainRound>
