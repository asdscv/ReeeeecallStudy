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
 * them differs: Quick Eye is a speed-of-processing task tracked at 80% correct in 20-trial legs with
 * no lives, span tasks follow the standard Corsi stop rule, and everything else tracks 85%.
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

/**
 * A cell label's ink when colour is only noise (Odd One Out's colour-noise boards) or marks a
 * second series (Number Hunt's alternation). Chosen by brightness, never red against green.
 */
export type CellInk = 'neutral' | 'amber' | 'cyan'

export interface CellView {
  label?: string
  tone: CellTone
  /** Degrees. Only the odd-one-out rotation rounds set it. */
  rotate?: number
  /** Drawn mirrored (scaleX(-1)), applied before `rotate`. */
  mirror?: boolean
  ink?: CellInk
  /** A rounded outline round the label — the second Number Hunt series (colour is never the only cue). */
  boxed?: boolean
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
  /**
   * A full-width button under the grid (Odd One Out's «없음»). Tapping it is `tap(index)`;
   * `index` is `cells.length`, so it never collides with a cell. `tone` once the trial is over, as
   * for a cell: 'correct' (picked, right) · 'wrong' (picked, there was an odd one) · 'missed' (it
   * was right and not picked — the board shows «없었어요»).
   */
  extra?: { key: string; index: number; tone?: CellTone }
  /** A small chip by the prompt: literal text, or a `brain` key with params; amber marks the second series. */
  chip?: { text?: string; key?: string; params?: Record<string, string | number>; ink?: 'neutral' | 'amber' }
  /** Flash Grid's waves shown so far (●○○), or Match Pairs' cards open in a set of three (2/3). */
  progress?: { kind: 'waves'; done: number; total: number } | { kind: 'set'; open: number; size: number }
  /** A countdown bar for a memorise phase, this long (static under reduced motion). */
  showBar?: { ms: number }
  /** A header badge, a `brain` key (거꾸로 / 비슷한 그림). */
  badge?: { key: string }
  /** Match Pairs' miss budget, drawn as dots — never as hearts (they are not lives). */
  budget?: { left: number; total: number }
  /** Odd One Out after a miss: the odd cell next to a typical one, both upright. */
  missChip?: { odd: CellView; common: CellView }
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
    /**
     * An expression as tokens: numbers are drawn with Intl.NumberFormat(locale), and a line only
     * wraps between tokens (before an operator). Takes the place of `text` when set.
     */
    tokens?: (number | string)[]
    /** Number Pattern's row as tiles; `null` marks the gap. */
    terms?: (number | null)[]
    /** Color Word's cue lead: the cue is up, the word is not shown yet. */
    hidden?: boolean
    /** Color Word: which rule this trial asks for — the cue strip. */
    cue?: 'ink' | 'word'
    /** Color Word's frame lure: a ring in a third colour, never the answer. */
    frame?: BrainColor
    /**
     * Shown only once the trial is over. `lines`: worked lines under the stimulus, tokens separated
     * by single spaces, numbers as plain digits (the platform formats them and wraps before an
     * operator): '6 + 4 × 7 → 6 + 28 = 34'. `highlight`: a [start, end) range of `lines[0]`'s tokens —
     * the part done first. `gaps[i]`: the label after term i, drawn between tile i and tile i+1
     * ('+3'; '' for none). `groups[i]`: the line (0-2) term i belongs to — its tile and gap label take
     * that line's colour and border. `prompt`: one line under the stimulus; string params that are
     * `brain` keys are translated (`{ color: 'colors.purple' }`). Platforms draw `lines`, `highlight`
     * and `prompt` after a miss only; a right answer fills the gap and shows `gaps` / `groups`.
     */
    reveal?: { lines?: string[]; highlight?: [number, number]; gaps?: string[]; groups?: number[]; prompt?: PromptView }
  }
  /**
   * `value`: a numeric option (drawn with Intl.NumberFormat); the engine has already sorted numeric
   * options ascending. `color`: the label's ink, drawn as ink on a white tile.
   */
  options: { text?: string; textKey?: string; value?: number; color?: BrainColor }[]
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
 * Quick Eye's stage groups (games/quick-eye.ts QE_PLACES): which tint the field takes and which
 * colour the reveal uses. Internal ids — never shown as names.
 */
export type QePlaceId = 'dock' | 'shore' | 'pines' | 'tea' | 'lake'

/**
 * Quick Eye — a briefly flashed display, answered afterwards.
 *
 * The platform owns the exposure: in `stimulus` it shows everything for `exposureMs`, counted in
 * display frames (never setTimeout), then calls `reportExposure` with what it actually showed.
 */
export interface QuickEyeView {
  kind: 'quickEye'
  phase: 'fixation' | 'stimulus' | 'mask' | 'answerCenter' | 'answerLocation' | 'done'
  /** The variant this trial was built on (practice: 1). */
  variant: number
  /** The stage group, for the field tint and the reveal colour (QE_FIELD_TINT, QE_REVEAL_ART). */
  place: QePlaceId
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
  /** Done: the picked direction was one off the target's (around the circle) — "right next to it". Display only. */
  nearMiss?: boolean
  /** Done: the trial did not count (dropped frames, a stalled screen) — no reveal, it is replaced. */
  void?: boolean
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
  /** Match Pairs: mismatches made against cards already seen — the probe ladder reads it. */
  informedMisses?: number
}

/**
 * What a trial is for. 'practice' and 'placement' trials never use an unseen rule; 'intro' is the
 * unscored trial right after a rule card; 'counted' is everything else.
 */
export type TrialKind = 'practice' | 'intro' | 'placement' | 'counted'

/** One of the round's last trials, as `BrainGameDef.trialInfo` described it, with its level. */
export interface RecentTrial {
  level: number
  kind: string
  carry?: string
}

/** What a game may use, besides its level, to build a round. */
export interface CreateContext {
  /** The widest grid that keeps every cell ≥ 56dp on this screen. */
  maxCols: number
  /** The tallest grid that keeps every cell ≥ 56dp on this screen (see maxRowsFor). */
  maxRows: number
  /**
   * Rule tags (mechanics.ts) this trial must NOT use: unseen rules the round is not introducing
   * now. The game swaps in that level's non-rule content at the same clock.
   */
  blockRules: readonly string[]
  trialKind: TrialKind
  /** The round's last ≤ 2 trials, oldest first — for variety rules and Color Word's carry-over. */
  recent: readonly RecentTrial[]
  /** Fixed for the whole round (Color Word's colour subset). */
  roundSeed: number
  /** Quick Eye's current variant (1-based). Other games ignore it. */
  variant: number
  /**
   * The shortest exposure this platform can show reliably. Both platforms start at two 60Hz frames
   * (33ms); the round raises it when this device keeps dropping frames.
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
  maxRows: 7,
  blockRules: [],
  trialKind: 'counted',
  recent: [],
  roundSeed: 1,
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

/** The tallest grid that keeps cells at least 56 tall with 8 gaps, for a board this tall. */
export function maxRowsFor(boardHeight: number): number {
  return Math.max(3, Math.min(7, Math.floor((boardHeight + 8) / (56 + 8))))
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
  /**
   * The taps that answer what is being asked right now, in order (only the first is certain to
   * stay right — a pairs board changes after each flip). Null while nothing is being asked. The
   * how-to-play demo plays from it, and the tests use it to play every game through.
   */
  solution(s: S): number[] | null
  /**
   * The rules and board changes (mechanics.ts tags) this generated trial uses, read right after
   * create() — so the round can introduce a rule the first time it actually appears.
   */
  mechanics(s: S): readonly string[]
  /**
   * Quick Eye only: the platform reports how long the stimulus was really on screen. `lenient`
   * accepts any real exposure (after repeated voids on a device whose frames never match exactly).
   */
  exposed?(s: S, actualMs: number, frameMs: number, lenient?: boolean): S
  /**
   * The level past which this game's puzzle stops changing on this screen. The staircase stops
   * there, so the level means the same task everywhere and never climbs on an unchanged puzzle.
   */
  maxLevel?(ctx: CreateContext): number
  /**
   * What kind of trial this is (a band, a board kind, a rule) and, for Color Word, the word it
   * showed — read right after create(); the round passes the last two back as `ctx.recent`.
   */
  trialInfo?(s: S): { kind: string; carry?: string }
  /** Span games: the length a level means on this screen (achievements count lengths). */
  spanLength?(level: number, ctx: CreateContext): number
}
