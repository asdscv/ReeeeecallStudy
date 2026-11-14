import { createRng } from './rng'
import { brainGame } from './catalog'
import { DEFAULT_CONTEXT, type BrainGameId, type CreateContext, type RoundView } from './types'

/**
 * The how-to-play demo: the real engine playing one easy round by itself, as a list of frames.
 * Platforms draw each frame with their real board and move a pointer to `tap` — so the demo can
 * never disagree with the game it explains.
 */
export interface DemoFrame {
  view: RoundView
  /** How long the frame stays up. */
  holdMs: number
  /** A tap the pointer makes on this frame (cell / option index). */
  tap?: number
}

/** The level and seed each demo uses — chosen so the demo round is short and readable. */
const DEMO_SETUP: Record<BrainGameId, { level: number; seed: number }> = {
  oddOneOut: { level: 1, seed: 3 },
  schulte: { level: 1, seed: 5 },
  memoryGrid: { level: 1, seed: 11 },
  sequence: { level: 1, seed: 2 },
  series: { level: 1, seed: 4 },
  pairs: { level: 1, seed: 9 },
  stroop: { level: 1, seed: 7 },
  math: { level: 1, seed: 8 },
  setMatch: { level: 1, seed: 3 },
  // 41 → 1 strike, 21 → 1 ball, 42: both answers shown before the code (games/code-break.ts).
  codeBreak: { level: 1, seed: 6 },
  makeNumber: { level: 1, seed: 2 },
  // A 4×4 maze from the bottom-left corner with one fork and four turns (games/maze-run.ts).
  mazeRun: { level: 1, seed: 6 },
}

const TAP_HOLD_MS = 650
const LOOK_HOLD_MS = 1100
const RESULT_HOLD_MS = 1400

export function buildDemo(gameId: BrainGameId, ctx: Partial<CreateContext> = {}): DemoFrame[] {
  const def = brainGame(gameId).def
  const setup = DEMO_SETUP[gameId]
  const context: CreateContext = { ...DEFAULT_CONTEXT, maxCols: 4, ...ctx }
  // Demonstrate the full first rule; the one-item foundation is played before this in practice.
  let s = def.create(Math.max(1.01, setup.level), createRng(setup.seed), context)
  const frames: DemoFrame[] = []
  for (let guard = 0; guard < 200; guard++) {
    if (def.outcome(s)) {
      frames.push({ view: def.view(s), holdMs: RESULT_HOLD_MS })
      break
    }
    const view = def.view(s)
    const pending = def.pendingMs(s)
    if (pending !== null) {
      frames.push({ view, holdMs: Math.min(pending, 1600) })
      s = def.advance(s)
      continue
    }
    const taps = def.solution(s)
    if (!taps || taps.length === 0 || !def.acceptsInput(s)) break
    // A beat to read the question before the first answer.
    if (!frames.some((f) => f.tap !== undefined)) frames.push({ view, holdMs: LOOK_HOLD_MS })
    frames.push({ view, holdMs: TAP_HOLD_MS, tap: taps[0] })
    s = def.tap(s, taps[0])
  }
  return frames
}
