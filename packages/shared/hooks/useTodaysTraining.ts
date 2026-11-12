import { useCallback, useEffect, useRef, useState } from 'react'
import { type BrainGameId, type PlanSlot, createRng, planTodaysSession, plannedMinutes, randomSeed } from '../lib/brain-games'
import { useBrainStore } from '../stores/brain-store'
import type { RoundStats } from './useBrainRound'

/**
 * Today's Training: a bounded session of four games, run one after another.
 *
 * Each game has a time slot. When a round ends (lives or its cap) and more than a minute of the
 * slot is left, another round of the same game starts; otherwise the session moves on, with a
 * short "next game" screen between games so the player controls the pace. Finishing the last slot
 * records the session — sessions are the unit the course counts. Stopping part-way keeps every
 * round's progress but does not count as a session.
 */
export type TrainingPhase = 'playing' | 'between' | 'done' | 'quit'

export interface TrainingTotals {
  rounds: number
  trials: number
  correct: number
  points: number
  /** Level each game had when the session first played it, and where it finished. */
  levels: Partial<Record<BrainGameId, { start: number; end: number }>>
}

interface TrainingState {
  slots: PlanSlot[]
  slotIndex: number
  slotStartedAt: number
  roundsInSlot: number
  roundKey: number
  phase: TrainingPhase
  startedAt: number
  finishedAt: number | null
  totals: TrainingTotals
}

function init(): TrainingState {
  const now = Date.now()
  return {
    slots: planTodaysSession(useBrainStore.getState().progress, createRng(randomSeed())),
    slotIndex: 0,
    slotStartedAt: now,
    roundsInSlot: 0,
    roundKey: 1,
    phase: 'playing',
    startedAt: now,
    finishedAt: null,
    totals: { rounds: 0, trials: 0, correct: 0, points: 0, levels: {} },
  }
}

export function useTodaysTraining() {
  const [state, setState] = useState(init)

  const onRoundOver = useCallback((gameId: BrainGameId, stats: RoundStats) => {
    setState((s) => {
      if (s.phase !== 'playing') return s
      const prior = s.totals.levels[gameId]
      const totals: TrainingTotals = {
        rounds: s.totals.rounds + 1,
        trials: s.totals.trials + stats.trials,
        correct: s.totals.correct + stats.correct,
        points: s.totals.points + stats.points,
        levels: { ...s.totals.levels, [gameId]: { start: prior?.start ?? stats.levelStart, end: stats.levelEnd } },
      }
      if (stats.endedBy === 'stop') return { ...s, totals, phase: 'quit' }
      const now = Date.now()
      const slot = s.slots[s.slotIndex]
      const rounds = s.roundsInSlot + 1
      const left = slot.minutes * 60_000 - (now - s.slotStartedAt)
      if (rounds < slot.maxRounds && left > 60_000) {
        return { ...s, totals, roundsInSlot: rounds, roundKey: s.roundKey + 1 }
      }
      if (s.slotIndex + 1 < s.slots.length) return { ...s, totals, phase: 'between' }
      return { ...s, totals, phase: 'done', finishedAt: now }
    })
  }, [])

  // Recorded here, once, not inside the state updater above: an updater must be pure (React runs
  // it twice in development), and a session counted twice is a course step the player never did.
  const recorded = useRef(false)
  useEffect(() => {
    if (state.phase !== 'done' || recorded.current) return
    recorded.current = true
    useBrainStore.getState().completeSession(
      ((state.finishedAt ?? Date.now()) - state.startedAt) / 60_000,
      state.slots.map((slot) => slot.gameId),
    )
  }, [state.phase, state.finishedAt, state.startedAt, state.slots])

  /** From the "next game" screen into the next slot. */
  const continueSession = useCallback(() => {
    setState((s) =>
      s.phase !== 'between'
        ? s
        : { ...s, phase: 'playing', slotIndex: s.slotIndex + 1, roundsInSlot: 0, slotStartedAt: Date.now(), roundKey: s.roundKey + 1 },
    )
  }, [])

  const slot = state.slots[state.slotIndex]
  const next = state.phase === 'between' ? state.slots[state.slotIndex + 1] : null
  return {
    phase: state.phase,
    slots: state.slots,
    slotIndex: state.slotIndex,
    slot,
    /** The slot after this one, while the "next game" screen shows. */
    next,
    roundKey: state.roundKey,
    totals: state.totals,
    plannedMinutes: plannedMinutes(state.slots),
    startedAt: state.startedAt,
    onRoundOver,
    continueSession,
  }
}
