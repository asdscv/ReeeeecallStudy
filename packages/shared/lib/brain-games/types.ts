import type { Rng } from './rng'

export type BrainGameId =
  | 'memoryGrid'
  | 'sequence'
  | 'pairs'
  | 'schulte'
  | 'oddOneOut'
  | 'stroop'
  | 'math'
  | 'series'

export type BrainSkill = 'memory' | 'attention' | 'speed' | 'reasoning'

export type BrainColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange'

/**
 * How a cell is drawn. Platforms map tones to their own colours — the engine says what a cell
 * MEANS (lit for memorising, the right answer, the wrong tap), not how it looks.
 */
export type CellTone =
  | 'idle'
  | 'lit'
  | 'correct'
  | 'wrong'
  | 'missed'
  | 'faceDown'
  | 'faceUp'
  | 'matched'
  | 'done'

export interface CellView {
  label?: string
  tone: CellTone
  /** Degrees. Only the odd-one-out rotation rounds set it. */
  rotate?: number
}

export interface PromptView {
  /** Key in the `brain` namespace. */
  key: string
  params?: Record<string, string | number>
}

export interface GridView {
  kind: 'grid'
  cols: number
  rows: number
  cells: CellView[]
  prompt: PromptView
  /** Cells are not tappable while the engine is showing something to memorise. */
  locked: boolean
}

export interface ChoiceView {
  kind: 'choice'
  prompt: PromptView
  stimulus: {
    /** Literal text (numbers, expressions). */
    text?: string
    /** `brain` namespace key, for words that must be translated (colour names). */
    textKey?: string
    color?: BrainColor
  }
  options: { text?: string; textKey?: string }[]
  /** Set once the round is over, so the platform can mark the right and the picked option. */
  picked?: number
  correctIndex?: number
}

export type RoundView = GridView | ChoiceView

export interface RoundOutcome {
  correct: boolean
  /** 0..1, how much of the round was right — softens the level drop on a near miss. */
  accuracy: number
}

/**
 * One game, as a pure state machine. Platforms own the clock and the drawing; the game owns
 * what a round is, what a tap means and when it is over.
 *
 *   create → (pendingMs → advance)* → tap* → outcome
 *
 * `pendingMs` is how the engine asks for time to pass: a memorise phase, the next flash of a
 * sequence, flipping a mismatched pair back. The platform waits that long and calls `advance`.
 */
export interface BrainGameDef<S> {
  id: BrainGameId
  create(level: number, rng: Rng): S
  pendingMs(s: S): number | null
  advance(s: S): S
  acceptsInput(s: S): boolean
  tap(s: S, index: number): S
  /** Called when the input clock runs out. */
  timeout(s: S): S
  outcome(s: S): RoundOutcome | null
  /** Input time limit in ms, counted from when `acceptsInput` first turns true. */
  timeLimitMs(s: S): number
  view(s: S): RoundView
  /** Identity of the generated puzzle, so a session can refuse an immediate repeat. */
  signature(s: S): string
}
