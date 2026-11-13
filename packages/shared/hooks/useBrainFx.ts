import { useEffect, useRef } from 'react'
import { exposureMsFor, type CellTone } from '../lib/brain-games'
import type { BrainRound } from './useBrainRound'

/**
 * What just happened in a round, as events — the one source both platforms turn into sound,
 * haptics and motion, so web and mobile react to the same moments.
 *
 * Derived from the round's own state (its view and result), never from the tap handler: a tap
 * that the engine ignores makes no sound, and a timeout sounds like a miss.
 */
export type BrainFx =
  /** A memorise phase lit its cells (memory grid) or a pairs preview turned up. */
  | { kind: 'reveal' }
  /** One tile of a sequence lit, `index` in the order shown (Simon-style tone per cell). */
  | { kind: 'flash'; cell: number; index: number }
  /** Quick Eye's stimulus is on screen. */
  | { kind: 'stimulus' }
  /** A right tap inside a multi-tap trial; `step` counts them, for a rising pitch. */
  | { kind: 'hit'; cell: number; step: number }
  /** A wrong tap inside a trial (Number Hunt costs a life for it). */
  | { kind: 'miss'; cell: number }
  /** A pairs card turned face up. */
  | { kind: 'flip'; cell: number }
  /** A pick on a choice board or Quick Eye's first answer. */
  | { kind: 'select' }
  | { kind: 'correct'; streak: number; points: number; practice: boolean }
  | { kind: 'wrong'; timedOut: boolean; practice: boolean }
  | { kind: 'lifeLost'; left: number }
  | { kind: 'levelUp'; level: number }
  | { kind: 'void' }
  | { kind: 'roundEnd'; reason: 'lives' | 'cap' | 'stop' | 'void' | null }
  | { kind: 'newBest' }

const HIT_TONES: readonly CellTone[] = ['correct', 'done', 'matched']

export function useBrainFx(r: BrainRound, onFx: (fx: BrainFx) => void) {
  const emit = useRef(onFx)
  useEffect(() => {
    emit.current = onFx
  })
  const prev = useRef<{ trialId: number; tones: CellTone[]; phase: string | null; hits: number; flashes: number; lives: number | null; slips: number | null }>({
    trialId: -1,
    tones: [],
    phase: null,
    hits: 0,
    flashes: 0,
    lives: null,
    slips: null,
  })

  // Inside a trial: what the board did since the last render.
  useEffect(() => {
    const view = r.view
    const p = prev.current
    const fresh = p.trialId !== r.trialId
    if (fresh) {
      prev.current = { trialId: r.trialId, tones: [], phase: null, hits: 0, flashes: 0, lives: null, slips: null }
    }
    const cur = prev.current
    if (view.kind === 'grid') {
      const tones = view.cells.map((c) => c.tone)
      const lit = tones.filter((t) => t === 'lit').length
      const faceUpAll = tones.every((t) => t === 'faceUp' || t === 'matched')
      if (fresh || cur.tones.length !== tones.length) {
        if (lit > 1 || (r.gameId === 'pairs' && view.locked && faceUpAll)) emit.current({ kind: 'reveal' })
        else if (lit === 1) emit.current({ kind: 'flash', cell: tones.indexOf('lit'), index: cur.flashes++ })
      }
      let missed = false
      // Match Pairs: a mismatch costs a slip only when it went against what had been seen; turning
      // over unseen cards is exploring, and must not sound like a mistake.
      const slips = r.gameId === 'pairs' && typeof view.prompt.params?.lives === 'number' ? Number(view.prompt.params.lives) : null
      const pairSlip = slips !== null && cur.slips !== null && slips < cur.slips
      if (!fresh && cur.tones.length === tones.length) {
        tones.forEach((t, i) => {
          const was = cur.tones[i]
          if (t === was) return
          if (t === 'lit' && view.locked) emit.current({ kind: 'flash', cell: i, index: cur.flashes++ })
          else if (HIT_TONES.includes(t) && !HIT_TONES.includes(was)) {
            // Pairs: two cards turning "matched" together are one hit.
            if (!(t === 'matched' && tones.some((u, j) => j < i && u === 'matched' && cur.tones[j] !== 'matched'))) {
              emit.current({ kind: 'hit', cell: i, step: ++cur.hits })
            }
          } else if (t === 'wrong' && !r.result && !missed && (r.gameId !== 'pairs' || pairSlip)) {
            // A pairs mismatch turns two cards red at once: one miss.
            missed = true
            emit.current({ kind: 'miss', cell: i })
          }
          // Only a card the player turned: a board ending by time shows every face at once.
          else if (t === 'faceUp' && was === 'faceDown' && !r.result) emit.current({ kind: 'flip', cell: i })
        })
      }
      cur.tones = tones
      cur.slips = slips
      // Number Hunt spends a life on each wrong tap, inside the grid.
      const lives = typeof view.prompt.params?.lives === 'number' && r.gameId === 'schulte' ? Number(view.prompt.params.lives) : null
      if (lives !== null && cur.lives !== null && lives < cur.lives) {
        // A second wrong tap on the same number leaves its tone unchanged; the lives still drop.
        if (!missed) emit.current({ kind: 'miss', cell: tones.indexOf('wrong') })
        // Practice and placement spend no chances: the miss shows, the heart does not go.
        if (!r.practice && !r.placing) emit.current({ kind: 'lifeLost', left: lives })
      }
      cur.lives = lives
    } else if (view.kind === 'quickEye') {
      if (view.phase !== cur.phase) {
        if (view.phase === 'stimulus') emit.current({ kind: 'stimulus' })
        if (view.phase === 'answerLocation') emit.current({ kind: 'select' })
      }
      cur.phase = view.phase
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.view, r.trialId])

  // The trial's verdict.
  const lastResult = useRef<unknown>(null)
  useEffect(() => {
    const res = r.result
    if (!res || res === lastResult.current) return
    lastResult.current = res
    if (res.void) return emit.current({ kind: 'void' })
    if (res.correct) emit.current({ kind: 'correct', streak: r.stats.streak, points: res.points, practice: res.practice })
    else emit.current({ kind: 'wrong', timedOut: res.timedOut, practice: res.practice })
    if (res.livesLost > 0 && r.gameId !== 'schulte') emit.current({ kind: 'lifeLost', left: r.lives })
    // Whole steps only: the staircase moves in tenths, and a fanfare every tenth would be noise.
    // Quick Eye: exactly when the flash gets shorter (its ladder steps on rounding, not on whole levels).
    const up =
      r.gameId === 'quickEye'
        ? exposureMsFor(res.levelAfter) < exposureMsFor(res.levelBefore)
        : Math.floor(res.levelAfter + 1e-9) > Math.floor(res.levelBefore + 1e-9)
    // Not during placement: its big early jumps are finding the start, not a level earned.
    if (!res.practice && res.kind !== 'placement' && up) emit.current({ kind: 'levelUp', level: Math.floor(res.levelAfter + 1e-9) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.result])

  const ended = useRef(false)
  useEffect(() => {
    if (r.over && !ended.current) {
      ended.current = true
      emit.current({ kind: 'roundEnd', reason: r.stats.endedBy })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.over])

  const best = useRef(false)
  useEffect(() => {
    if (r.done && r.stats.isNewBest && !best.current) {
      best.current = true
      emit.current({ kind: 'newBest' })
    }
  }, [r.done, r.stats.isNewBest])
}
