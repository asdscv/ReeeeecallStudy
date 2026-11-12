import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  type BrainGameId,
  type RoundView,
  MIX_BURST,
  brainGame,
  createRng,
  displayLevel,
  gameProgress,
  nextLevel,
  pickNextGame,
  randomSeed,
  roundPoints,
} from '../lib/brain-games'
import { useBrainStore } from '../stores/brain-store'

/**
 * The game loop both platforms run: generate a round at the player's level, run its clock,
 * judge it, move the level, and start the next — forever, until the player stops.
 *
 * Platforms only draw `view` and call `tap`. Every timer lives here so web and mobile cannot
 * drift on how long a memorise phase lasts or when a round times out.
 */
export type BrainMode = BrainGameId | 'mix'

export interface RoundResult {
  correct: boolean
  timedOut: boolean
  points: number
  levelBefore: number
  levelAfter: number
}

export interface SessionStats {
  rounds: number
  correct: number
  points: number
  streak: number
  bestStreak: number
  /** Level each game was at when this session first played it, and where it is now. */
  levels: Partial<Record<BrainGameId, { start: number; now: number }>>
}

interface State {
  mode: BrainMode
  gameId: BrainGameId
  // Each game's round state is private to that game.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  round: any
  roundId: number
  level: number
  inputStartedAt: number | null
  timedOut: boolean
  result: RoundResult | null
  burst: number
  recentGames: BrainGameId[]
  recentSigs: string[]
  stats: SessionStats
}

type Action =
  | { type: 'advance'; now: number }
  | { type: 'tap'; index: number; now: number }
  | { type: 'timeout'; now: number }
  | { type: 'inputStarted'; now: number }
  | { type: 'next'; gameId: BrainGameId; level: number; seed: number }

const REVEAL_RIGHT_MS = 700
const REVEAL_WRONG_MS = 1500
/** A generated round identical to one of the last few is regenerated. */
const RECENT_SIGS = 12

function newRound(gameId: BrainGameId, level: number, seed: number, recentSigs: string[]) {
  const def = brainGame(gameId).def
  const rng = createRng(seed)
  let round = def.create(level, rng)
  for (let i = 0; i < 6 && recentSigs.includes(def.signature(round)); i++) round = def.create(level, rng)
  return { round, sig: def.signature(round) as string }
}

function judge(state: State, round: State['round'], now: number, timedOut: boolean): State {
  const def = brainGame(state.gameId).def
  const outcome = def.outcome(round)
  if (!outcome || state.result) return { ...state, round, timedOut }
  const limit = def.timeLimitMs(round)
  const usedShare = state.inputStartedAt === null ? 1 : Math.min(1, (now - state.inputStartedAt) / limit)
  const streak = outcome.correct ? state.stats.streak + 1 : 0
  const levelAfter = nextLevel(state.level, outcome, usedShare)
  const points = roundPoints(state.level, outcome, usedShare, state.stats.streak)
  const prior = state.stats.levels[state.gameId]
  return {
    ...state,
    round,
    timedOut,
    result: { correct: outcome.correct, timedOut, points, levelBefore: state.level, levelAfter },
    stats: {
      rounds: state.stats.rounds + 1,
      correct: state.stats.correct + (outcome.correct ? 1 : 0),
      points: state.stats.points + points,
      streak,
      bestStreak: Math.max(state.stats.bestStreak, streak),
      levels: { ...state.stats.levels, [state.gameId]: { start: prior?.start ?? state.level, now: levelAfter } },
    },
  }
}

function reducer(state: State, action: Action): State {
  const def = brainGame(state.gameId).def
  switch (action.type) {
    case 'advance':
      return state.result ? state : judge(state, def.advance(state.round), action.now, state.timedOut)
    case 'tap':
      if (state.result || !def.acceptsInput(state.round)) return state
      return judge(state, def.tap(state.round, action.index), action.now, false)
    case 'timeout':
      return state.result ? state : judge(state, def.timeout(state.round), action.now, true)
    case 'inputStarted':
      return state.inputStartedAt === null ? { ...state, inputStartedAt: action.now } : state
    case 'next': {
      const { round, sig } = newRound(action.gameId, action.level, action.seed, state.recentSigs)
      const sameGame = action.gameId === state.gameId
      return {
        ...state,
        gameId: action.gameId,
        round,
        roundId: state.roundId + 1,
        level: action.level,
        inputStartedAt: null,
        timedOut: false,
        result: null,
        burst: sameGame ? state.burst + 1 : 1,
        recentGames: sameGame ? state.recentGames : [...state.recentGames, action.gameId].slice(-4),
        recentSigs: [...state.recentSigs, sig].slice(-RECENT_SIGS),
      }
    }
  }
}

function init(mode: BrainMode): State {
  const progress = useBrainStore.getState().progress
  const gameId = mode === 'mix' ? pickNextGame(progress, [], createRng(randomSeed())) : mode
  const level = gameProgress(progress, gameId).level
  const { round, sig } = newRound(gameId, level, randomSeed(), [])
  return {
    mode,
    gameId,
    round,
    roundId: 1,
    level,
    inputStartedAt: null,
    timedOut: false,
    result: null,
    burst: 1,
    recentGames: [gameId],
    recentSigs: [sig],
    stats: { rounds: 0, correct: 0, points: 0, streak: 0, bestStreak: 0, levels: {} },
  }
}

export function useBrainSession(mode: BrainMode) {
  const [state, dispatch] = useReducer(reducer, mode, init)
  const record = useBrainStore((s) => s.record)
  const def = brainGame(state.gameId).def
  const pending = state.result ? null : def.pendingMs(state.round)
  const accepts = !state.result && def.acceptsInput(state.round)
  const stateRef = useRef(state)
  stateRef.current = state

  // Time passing inside a round: memorise phases, sequence flashes, a mismatched pair flipping back.
  useEffect(() => {
    if (pending === null) return
    const t = setTimeout(() => dispatch({ type: 'advance', now: Date.now() }), pending)
    return () => clearTimeout(t)
  }, [pending, state.round])

  // The input clock starts the first time the round takes input, and runs once per round.
  useEffect(() => {
    if (accepts && state.inputStartedAt === null) dispatch({ type: 'inputStarted', now: Date.now() })
  }, [accepts, state.inputStartedAt])

  useEffect(() => {
    if (state.inputStartedAt === null || state.result) return
    const limit = def.timeLimitMs(state.round)
    const left = state.inputStartedAt + limit - Date.now()
    const t = setTimeout(() => dispatch({ type: 'timeout', now: Date.now() }), Math.max(0, left))
    return () => clearTimeout(t)
    // The limit is fixed for a round; re-arming on every tap would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundId, state.inputStartedAt, state.result])

  // A judged round: save it, show the answer for a beat, then the next round.
  useEffect(() => {
    const result = state.result
    if (!result) return
    record(state.gameId, { level: result.levelAfter, correct: result.correct, points: result.points })
    const t = setTimeout(() => {
      const s = stateRef.current
      const progress = useBrainStore.getState().progress
      const rng = createRng(randomSeed())
      const gameId =
        s.mode === 'mix' && s.burst >= MIX_BURST ? pickNextGame(progress, s.recentGames, rng) : s.gameId
      dispatch({ type: 'next', gameId, level: gameProgress(progress, gameId).level, seed: randomSeed() })
    }, result.correct ? REVEAL_RIGHT_MS : REVEAL_WRONG_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.result])

  const tap = useCallback((index: number) => dispatch({ type: 'tap', index, now: Date.now() }), [])

  const view: RoundView = def.view(state.round)
  return {
    mode: state.mode,
    gameId: state.gameId,
    roundId: state.roundId,
    level: displayLevel(state.result ? state.result.levelAfter : state.level),
    view,
    tap,
    result: state.result,
    timedOut: state.timedOut,
    /** Present while the input clock runs; platforms animate a bar from it. */
    timer:
      state.inputStartedAt !== null && !state.result
        ? { startedAt: state.inputStartedAt, limitMs: def.timeLimitMs(state.round) as number }
        : null,
    stats: state.stats,
  }
}
