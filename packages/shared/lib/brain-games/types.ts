import type { Rng } from './rng'

export type BrainGameId =
  | 'quickEye'
  | 'memoryGrid'
  | 'sequence'
  | 'pairs'
  | 'schulte'
  | 'oddOneOut'
  | 'stroop'
  | 'math'
  | 'series'

export type BrainSkill = 'memory' | 'attention' | 'speed' | 'reasoning'

/**
 * Which adaptive rule a game follows (see rules.ts). The groups exist because the research behind
 * them differs: Quick Eye is a speed-of-processing task tracked at 80% correct with five misses
 * allowed, span tasks follow the standard Corsi stop rule, and everything else tracks 85%.
 */
export type GameGroup = 'quickEye' | 'span' | 'speed'

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

/**
 * A position on the Quick Eye field: ring 0 (inner) to 2 (outer), and a slot counted clockwise
 * from 12 o'clock among that ring's `ringSlots` slots.
 */
export interface FieldSlot {
  ring: number
  slot: number
}

/**
 * Quick Eye — a briefly flashed display, answered afterwards.
 *
 * The platform owns the exposure: in `stimulus` it shows everything for `exposureMs`, counted in
 * display frames (never setTimeout), then calls `reportExposure` with what it actually showed.
 */
export interface QuickEyeView {
  kind: 'quickEye'
  phase: 'fixation' | 'stimulus' | 'mask' | 'answerCenter' | 'answerLocation' | 'done'
  prompt: PromptView
  exposureMs: number
  /** Shape ids (see shapePair) shown in the centre box: one, or two for same/different. */
  center: string[]
  /** The two centre answers offered — icon ids, or 'same'/'different'. */
  centerOptions: string[]
  /** Present from variant 2: where the target star sits. */
  target: FieldSlot | null
  distractors: FieldSlot[]
  /** Slots per ring for this round, so the platform can place `target` and `distractors`. */
  ringSlots: number[]
  /** Whether this variant asks for the target's direction (0-7) at all. */
  asksLocation: boolean
  /** After the answer: what was picked and what was right, for feedback. */
  pickedCenter?: number
  correctCenter?: number
  pickedDirection?: number
  correctDirection?: number
}

export type RoundView = GridView | ChoiceView | QuickEyeView

export interface RoundOutcome {
  correct: boolean
  /** 0..1, how much of the round was right — softens the level drop on a near miss. */
  accuracy: number
  /**
   * The trial did not count — a dropped frame or a backgrounded app made the exposure unreliable.
   * It costs no life, moves no level and is replaced by a fresh one.
   */
  void?: boolean
  /**
   * Lives this trial spends, when not simply one-per-wrong-answer: Number Hunt spends one per tap
   * on the wrong number (a slow but clean grid costs none).
   */
  livesSpent?: number
  /** Quick Eye: the exposure actually shown, ms, for its threshold estimate. */
  shownMs?: number
}

/** What a game may use, besides its level, to build a round. */
export interface CreateContext {
  /** The widest grid that keeps every cell ≥ 56dp on this screen. */
  maxCols: number
  /** Quick Eye's current variant (1-based). Other games ignore it. */
  variant: number
  /**
   * The shortest exposure this platform can show reliably. Web counts display frames and goes
   * down to one 60Hz frame (17ms); React Native's JS clock is jittery, so it starts at 33ms.
   */
  minExposureMs: number
  /**
   * Quick Eye field slots per ring, inner to outer. A phone's inner ring is too short for 16
   * stimuli without overlapping the centre box, so it carries only the 8 radial positions.
   */
  ringSlots: number[]
  /** Quick Eye "centre only" setting — for players whose visual field makes the periphery unfair. */
  centerOnly: boolean
  /** Lives left in the round, for games that spend them inside one puzzle (Number Hunt). */
  livesLeft: number
}

export const DEFAULT_CONTEXT: CreateContext = {
  maxCols: 7,
  variant: 1,
  minExposureMs: 33,
  ringSlots: [16, 16, 16],
  centerOnly: false,
  livesLeft: 3,
}

/** The widest grid that keeps cells at least 56 wide with 8 gaps, for a board this wide. */
export function maxColsFor(boardWidth: number): number {
  return Math.max(3, Math.min(7, Math.floor((boardWidth + 8) / (56 + 8))))
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
  create(level: number, rng: Rng, ctx: CreateContext): S
  pendingMs(s: S): number | null
  advance(s: S): S
  acceptsInput(s: S): boolean
  tap(s: S, index: number): S
  /** Called when the input clock runs out. */
  timeout(s: S): S
  outcome(s: S): RoundOutcome | null
  /** Input time limit in ms, counted from when `acceptsInput` first turns true. Null = none. */
  timeLimitMs(s: S): number | null
  view(s: S): RoundView
  /** Identity of the generated puzzle, so a session can refuse an immediate repeat. */
  signature(s: S): string
  /** Quick Eye only: the platform reports how long the stimulus was really on screen. */
  exposed?(s: S, actualMs: number, frameMs: number): S
}
