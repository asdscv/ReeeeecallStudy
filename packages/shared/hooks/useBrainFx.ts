import { useEffect, useRef } from 'react'
import { exposureMsFor, type CellTone, type RoundView } from '../lib/brain-games'
import type { BrainRound } from './useBrainRound'

/**
 * What just happened in a round, as events — the one source both platforms turn into sound,
 * haptics and motion, so web and mobile react to the same moments.
 *
 * Derived from the round's own state (its view and result), never from the tap handler: a tap
 * that the engine ignores makes no sound, and a timeout sounds like a miss.
 *
 * Quick Eye's measured frames stay clean: while the stimulus and the mask are up the only event is
 * 'stimulus' (silent, never felt), and 'fixation' — the ready cue — comes once as each fixation
 * starts running, 500ms before the flash.
 */
export type BrainFx =
  /** A memorise phase lit its cells (memory grid) or a pairs preview turned up. */
  | { kind: 'reveal' }
  /**
   * Flash Grid shows its cells in waves: one more wave lit (`index` from 0, of `total`). Sent instead
   * of 'reveal' and the per-cell 'flash' on a wave board.
   */
  | { kind: 'wave'; index: number; total: number }
  /** One tile of a sequence lit, `index` in the order shown (Simon-style tone per cell). */
  | { kind: 'flash'; cell: number; index: number }
  /** Quick Eye's stimulus is on screen. Never sounded or felt. */
  | { kind: 'stimulus' }
  /** Quick Eye's fixation started running (a new trial, or again after a pause): the ready cue. Not in the demo. */
  | { kind: 'fixation' }
  /**
   * A right tap inside a multi-tap trial; `step` counts the run of them since the last miss or
   * mismatch, for a rising pitch. `alt`: the cell is the second series (Number Hunt's boxed
   * numbers), which has a sound of its own.
   */
  | { kind: 'hit'; cell: number; step: number; alt?: boolean }
  /** A wrong tap inside a trial (Number Hunt costs a life for it). */
  | { kind: 'miss'; cell: number }
  /** A pairs card turned face up. */
  | { kind: 'flip'; cell: number }
  /** A pick on a choice board or Quick Eye's first answer. */
  | { kind: 'select' }
  /**
   * Odd One Out: the right answer was «없음» and the player picked it. Sent just BEFORE its
   * 'correct' (which still carries the streak and points): platforms give it its own sound in
   * place of the usual chime.
   */
  | { kind: 'noneCorrect' }
  | { kind: 'correct'; streak: number; points: number; practice: boolean }
  | { kind: 'wrong'; timedOut: boolean; practice: boolean }
  /** Quick Eye: a miss whose direction was one off the star's — sent INSTEAD of 'wrong' ("so close"). */
  | { kind: 'nearMiss'; practice: boolean }
  /** Quick Eye: a stage reached (the interstitial opens). `stage` as shown. */
  | { kind: 'stageUp'; stage: number; variant: number }
  | { kind: 'lifeLost'; left: number }
  | { kind: 'levelUp'; level: number }
  | { kind: 'void' }
  | { kind: 'roundEnd'; reason: 'lives' | 'cap' | 'stop' | 'void' | 'time' | null }
  | { kind: 'newBest' }

const HIT_TONES: readonly CellTone[] = ['correct', 'done', 'matched']

/**
 * A right answer on a board with a «없음» button that was the button: the engine marks it
 * 'correct'; without that mark, a right answer with no cell found says the same.
 */
function noneWasPicked(view: RoundView): boolean {
  if (view.kind !== 'grid' || !view.extra) return false
  if (view.extra.tone !== undefined) return view.extra.tone === 'correct'
  return !view.cells.some((c) => HIT_TONES.includes(c.tone))
}

export function useBrainFx(r: BrainRound, onFx: (fx: BrainFx) => void) {
  const emit = useRef(onFx)
  useEffect(() => {
    emit.current = onFx
  })
  const prev = useRef<{ trialId: number; tones: CellTone[]; phase: string | null; hits: number; flashes: number; lives: number | null; slips: number | null; fixating: boolean; lit: number; waves: number }>({
    trialId: -1,
    tones: [],
    phase: null,
    hits: 0,
    flashes: 0,
    lives: null,
    slips: null,
    fixating: false,
    lit: 0,
    waves: 0,
  })

  // Inside a trial: what the board did since the last render.
  useEffect(() => {
    const view = r.view
    const p = prev.current
    const fresh = p.trialId !== r.trialId
    if (fresh) {
      prev.current = { trialId: r.trialId, tones: [], phase: null, hits: 0, flashes: 0, lives: null, slips: null, fixating: false, lit: 0, waves: 0 }
    }
    const cur = prev.current
    if (view.kind === 'grid') {
      const tones = view.cells.map((c) => c.tone)
      const lit = tones.filter((t) => t === 'lit').length
      const faceUpAll = tones.every((t) => t === 'faceUp' || t === 'matched')
      // Flash Grid's waves: one sound per wave as it lights (the blank between waves lights nothing).
      const waves = view.progress?.kind === 'waves' ? view.progress : null
      if (waves) {
        if (lit > 0 && (fresh || cur.lit === 0)) emit.current({ kind: 'wave', index: Math.min(cur.waves++, Math.max(0, waves.total - 1)), total: waves.total })
      } else if (fresh || cur.tones.length !== tones.length) {
        if (lit > 1 || (r.gameId === 'pairs' && view.locked && faceUpAll)) emit.current({ kind: 'reveal' })
        else if (lit === 1) emit.current({ kind: 'flash', cell: tones.indexOf('lit'), index: cur.flashes++ })
      }
      cur.lit = lit
      let missed = false
      // A mismatch or a wrong tap ends the run of hits (the climbing pitch starts low again).
      let broke = false
      // Match Pairs: a mismatch costs a slip only when it went against what had been seen; turning
      // over unseen cards is exploring, and must not sound like a mistake.
      const slips = r.gameId === 'pairs' && typeof view.prompt.params?.lives === 'number' ? Number(view.prompt.params.lives) : null
      const pairSlip = slips !== null && cur.slips !== null && slips < cur.slips
      if (!fresh && cur.tones.length === tones.length) {
        tones.forEach((t, i) => {
          const was = cur.tones[i]
          if (t === was) return
          if (t === 'lit' && view.locked) {
            if (!waves) emit.current({ kind: 'flash', cell: i, index: cur.flashes++ })
          } else if (HIT_TONES.includes(t) && !HIT_TONES.includes(was)) {
            // Pairs: two cards turning "matched" together are one hit.
            if (!(t === 'matched' && tones.some((u, j) => j < i && u === 'matched' && cur.tones[j] !== 'matched'))) {
              emit.current({ kind: 'hit', cell: i, step: ++cur.hits, ...(view.cells[i].boxed ? { alt: true } : {}) })
            }
          } else if (t === 'wrong' && !r.result && !missed && (r.gameId !== 'pairs' || pairSlip)) {
            // A pairs mismatch turns two cards red at once: one miss.
            missed = true
            broke = true
            emit.current({ kind: 'miss', cell: i })
          } else if (t === 'wrong') broke = true
          // Only a card the player turned: a board ending by time shows every face at once.
          else if (t === 'faceUp' && was === 'faceDown' && !r.result) emit.current({ kind: 'flip', cell: i })
        })
      }
      cur.tones = tones
      cur.slips = slips
      // Number Hunt spends a life on each wrong tap, inside the grid.
      const lives = typeof view.prompt.params?.lives === 'number' && r.gameId === 'schulte' ? Number(view.prompt.params.lives) : null
      if (lives !== null && cur.lives !== null && lives < cur.lives) {
        broke = true
        // A second wrong tap on the same number leaves its tone unchanged; the lives still drop.
        if (!missed) emit.current({ kind: 'miss', cell: tones.indexOf('wrong') })
        // Practice and placement spend no chances: the miss shows, the heart does not go.
        if (!r.practice && !r.placing) emit.current({ kind: 'lifeLost', left: lives })
      }
      cur.lives = lives
      if (broke) cur.hits = 0
    } else if (view.kind === 'quickEye') {
      // The fixation counts from when it runs (not under a rule card, a stage-up or a pause).
      const fixating = r.quiet && view.phase === 'fixation'
      if (fixating && !cur.fixating) emit.current({ kind: 'fixation' })
      cur.fixating = fixating
      if (view.phase !== cur.phase) {
        if (view.phase === 'stimulus') emit.current({ kind: 'stimulus' })
        if (view.phase === 'answerLocation') emit.current({ kind: 'select' })
      }
      cur.phase = view.phase
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.view, r.trialId, r.quiet])

  // The trial's verdict.
  const lastResult = useRef<unknown>(null)
  useEffect(() => {
    const res = r.result
    if (!res || res === lastResult.current) return
    lastResult.current = res
    if (res.void) return emit.current({ kind: 'void' })
    if (res.correct && noneWasPicked(r.view)) emit.current({ kind: 'noneCorrect' })
    if (res.correct) emit.current({ kind: 'correct', streak: r.stats.streak, points: res.points, practice: res.practice })
    else if (r.view.kind === 'quickEye' && r.view.nearMiss) emit.current({ kind: 'nearMiss', practice: res.practice })
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

  // A Quick Eye stage reached: once per interstitial.
  const stageUpId = useRef<number | null>(null)
  useEffect(() => {
    const up = r.stageUp
    if (!up || up.id === stageUpId.current) return
    stageUpId.current = up.id
    emit.current({ kind: 'stageUp', stage: up.to, variant: up.variant })
  }, [r.stageUp])

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
