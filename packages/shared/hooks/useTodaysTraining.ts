import { useCallback, useEffect, useRef, useState } from 'react'
import { type AchievementId, type BrainGameId, type BrainMeta, type PlanSlot, achievementBit, createRng, dayDiff, earnedBySession, emptyMeta, localDayKey, planTodaysSession, plannedMinutes, setBit, todaysPlanSeed } from '../lib/brain-games'
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
  /** Time actually played in this slot and in the session (paused and between-games time excluded). */
  slotActiveMs: number
  activeMs: number
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
    slots: (() => {
      const progress = useBrainStore.getState().progress
      return planTodaysSession(progress, createRng(todaysPlanSeed(progress, localDayKey())))
    })(),
    slotIndex: 0,
    slotActiveMs: 0,
    activeMs: 0,
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
  const [achievements, setAchievements] = useState<AchievementId[]>([])

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
      const activeMs = s.activeMs + stats.activeMs
      // Setup (practice, placement, rule-card trials — a first day's) is not the game's play time:
      // it does not eat the slot. The session's minutes still count it.
      const slotActiveMs = s.slotActiveMs + Math.max(0, stats.activeMs - stats.setupMs)
      if (stats.endedBy === 'stop') return { ...s, totals, activeMs, slotActiveMs, phase: 'quit' }
      const now = Date.now()
      const slot = s.slots[s.slotIndex]
      const rounds = s.roundsInSlot + 1
      const left = slot.minutes * 60_000 - slotActiveMs
      // Another round only when it ended early (chances out) with a real stretch of the slot left.
      if (stats.endedBy !== 'time' && rounds < slot.maxRounds && left > 45_000) {
        return { ...s, totals, activeMs, slotActiveMs, roundsInSlot: rounds, roundKey: s.roundKey + 1 }
      }
      if (s.slotIndex + 1 < s.slots.length) return { ...s, totals, activeMs, slotActiveMs, phase: 'between' }
      return { ...s, totals, activeMs, slotActiveMs, phase: 'done', finishedAt: now }
    })
  }, [])

  // Recorded here, once, not inside the state updater above: an updater must be pure (React runs
  // it twice in development), and a session counted twice is a course step the player never did.
  const recorded = useRef(false)
  useEffect(() => {
    if (state.phase !== 'done' || recorded.current) return
    recorded.current = true
    // Minutes actually played — a session left paused through a phone call, or sitting on the
    // "next game" screen overnight, must not record hours. Capped at half again the plan.
    const minutes = Math.min(state.activeMs / 60_000, plannedMinutes(state.slots) * 1.5)
    const store = useBrainStore.getState()
    const today = localDayKey()
    // Days since the last session before this one (for "back again" — never framed as a gap punished).
    const lastDay = store.progress.sessions.recentDays.filter((d) => d < today).slice(-1)[0]
    const daysAway = lastDay ? dayDiff(lastDay, today) : 0
    store.completeSession(minutes, state.slots.map((slot) => slot.gameId))
    const after = useBrainStore.getState()
    const meta = (after as { meta?: BrainMeta }).meta ?? emptyMeta()
    const earned = earnedBySession(after.progress, today, meta, daysAway)
    if (earned.length) {
      const updateMeta = (after as { updateMeta?: (fn: (m: BrainMeta) => BrainMeta) => void }).updateMeta
      updateMeta?.((m) => ({ ...m, ach: earned.reduce((mask, a) => setBit(mask, achievementBit(a)), m.ach) }))
      setAchievements(earned)
    }
  }, [state.phase, state.activeMs, state.slots])

  /** From the "next game" screen into the next slot. */
  const continueSession = useCallback(() => {
    setState((s) =>
      s.phase !== 'between'
        ? s
        : { ...s, phase: 'playing', slotIndex: s.slotIndex + 1, roundsInSlot: 0, slotActiveMs: 0, roundKey: s.roundKey + 1 },
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
    /** Play time left in this game's slot — the round in play gets it as its time budget. */
    slotBudgetMs: slot ? Math.max(15_000, slot.minutes * 60_000 - state.slotActiveMs) : undefined,
    startedAt: state.startedAt,
    /** Minutes actually played so far. */
    activeMinutes: state.activeMs / 60_000,
    /** Achievements the finished session earned (first session, a week at 3/3, the core course, a comeback). */
    achievements,
    onRoundOver,
    continueSession,
  }
}
