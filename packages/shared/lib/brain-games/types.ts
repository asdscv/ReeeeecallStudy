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
  // The four thinking games (owner 2026-11-13: «합찾기 숫자야구 숫자만들기 가능한가?», «미로찾기는
  // 어때? 드래그하면서 할 수 있도록»). Views below: SetMatchView, CodeBreakView, MakeNumberView, MazeView.
  | 'setMatch'
  | 'codeBreak'
  | 'makeNumber'
  | 'mazeRun'

/**
 * Games removed from the product (Quick Eye, by the owner 2026-11-13). Their ids live on only where
 * a table is append-only (mechanics.ts bits, achievements.ts bits) and in old saves, which are read
 * and merged without complaint (progress.ts, meta.ts, sync.ts) but drive nothing on screen.
 */
export type RetiredGameId = 'quickEye'

export type BrainSkill = 'memory' | 'attention' | 'speed' | 'reasoning'

/**
 * Which adaptive rule a game follows (see rules.ts): span tasks follow the standard Corsi stop rule,
 * everything else tracks 85% correct.
 */
export type GameGroup = 'span' | 'speed'

/**
 * Colour Word's inks: six basic colour names chosen to stay apart in colour-vision deficiency
 * (no red, no green, no yellow — theme.ts INK_COLORS; owner 2026-11-13).
 */
export type BrainColor = 'blue' | 'orange' | 'purple' | 'black' | 'brown' | 'gray'

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
  /** Degrees. Only Odd One Out's mirror boards set it (every cell turned, the odd one mirrored). */
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

// ── The thinking games' views (2026-11-13) ──────────────────────────────────────
//
// Every tap is still `tap(index)`: each view hands out the index each button sends, so the hook,
// the demo and the solver test need nothing new. Indices never collide within a view. Targets are
// for older players: buttons and cards ≥ 56dp (maze cells ≥ 44dp, walls drawn as lines with no
// gaps), digits and numbers ≥ 28pt, colour never the only cue (theme.ts SET_COLORS).

/** Set Match card shapes. A trial uses three of the four (SET's rule needs three values per attribute). */
export type SetShape = 'circle' | 'triangle' | 'square' | 'diamond'
/**
 * Set Match card colours — Okabe–Ito blue, vermillion and black, drawn on a white card face
 * (theme.ts SET_COLORS: every pair stays ≥ 38 CIEDE2000 apart under protan, deutan and tritan
 * simulation, each ≥ 3:1 against the card). Never red against green.
 */
export type SetColor = 'blue' | 'vermillion' | 'black'
/** Solid, striped (hatched) or outline — a pattern, so fill never depends on colour. */
export type SetFill = 'solid' | 'striped' | 'outline'
export type SetAttribute = 'shape' | 'color' | 'fill' | 'count'

export interface SetCard {
  shape: SetShape
  color: SetColor
  fill: SetFill
  /** How many shapes the card shows. */
  count: 1 | 2 | 3
}

/**
 * Set Match (합 찾기): find three cards where every attribute is all the same or all different.
 * `tap(i)` toggles card i (0-based, reading order, `cols` across); the third pick submits. A wrong
 * triple ends the trial. At the top levels a board may hold no set: `extra` («없음») is then the
 * answer, its index `cards.length`.
 */
export interface SetMatchView {
  kind: 'setMatch'
  prompt: PromptView
  cols: number
  rows: number
  /**
   * In reading order. `tone`: 'idle', 'lit' (picked); once over, 'correct' (the set — the player's
   * when right, else the one that was there), 'wrong' (picked, not in it), 'missed' (in it, not picked).
   */
  cards: { card: SetCard; tone: CellTone }[]
  /**
   * The attributes that change from card to card this trial, for the rule strip («모양·개수»).
   * Every other attribute is the same on every card (low levels: black, solid).
   */
  vary: readonly SetAttribute[]
  /** Cards picked so far, 0-2 while playing (the third submits). */
  picked: number
  locked: boolean
  /** «없음» (no set on this board) — only on boards from the «없음» rule on. `tone` once over, as for GridView.extra. */
  extra?: { key: string; index: number; tone?: CellTone }
  /** Once over: the set that was there (three card indices; [] when there was none). */
  answer?: number[]
  /** Once over after a wrong triple: the attributes that were neither all the same nor all different. */
  broken?: SetAttribute[]
}

export interface CodeBreakGuess {
  digits: number[]
  /** Right digit in the right place. */
  strikes: number
  /** Right digit in the wrong place. */
  balls: number
}

/**
 * Code Break (숫자 야구): deduce a secret code from strike/ball feedback. Untimed; the budget is
 * guesses. Type a guess on the keypad, then submit; the trial ends solved or out of guesses.
 */
export interface CodeBreakView {
  kind: 'codeBreak'
  prompt: PromptView
  /** Digits in the code. */
  length: number
  /** The digits the code is made of, ascending. */
  pool: number[]
  /** Digits may repeat in the code (a rule card); otherwise every digit is different. */
  repeats: boolean
  /** Every guess so far, oldest first. */
  guesses: CodeBreakGuess[]
  maxGuesses: number
  /** The guess being typed (≤ length digits). */
  entry: number[]
  /** The keypad, one key per pool digit. Disabled while the entry is full or (no repeats) the digit is already in it. */
  keys: { digit: number; index: number; disabled: boolean }[]
  /** Deletes the entry's last digit. */
  del: { index: number; disabled: boolean }
  /** Enabled once the entry has `length` digits. */
  submit: { index: number; disabled: boolean }
  /** The player's own notes: digits crossed out, tap to toggle. Never judged, kept for the whole trial. */
  notes: { digit: number; index: number; crossed: boolean }[]
  locked: boolean
  /** Once over: the code, and whether it was found. */
  secret?: number[]
  solved?: boolean
}

export type MakeOp = '+' | '−' | '×' | '÷' | '(' | ')'

export type MakeToken = { kind: 'num'; value: number; tile: number } | { kind: 'op'; op: MakeOp }

/**
 * Make the Number (숫자 만들기): build an expression that comes to `target`, every tile used exactly
 * once, by tapping tiles and operators. Judged in exact rational arithmetic (games/make-number.ts
 * evaluate) — no float error, × and ÷ before + and −, brackets first. Buttons the expression cannot
 * take next are disabled (a number after a number, `)` with nothing open). A wrong submit costs a
 * try and leaves the expression to fix; out of tries or time, the trial is over.
 */
export interface MakeNumberView {
  kind: 'makeNumber'
  prompt: PromptView
  target: number
  /**
   * 'fixed' (L1-9): the numbers stay in the order shown and place themselves — the expression starts
   * with the first one, and each sign tapped brings the next (draw it as `8 □ 3 □ 4 = 9`, the tiles
   * never tappable). 'any' (L10+): tap tiles and operators in any order.
   */
  order: 'fixed' | 'any'
  /** `disabled`: used already, or the expression wants an operator next (always, in fixed order). */
  tiles: { value: number; index: number; used: boolean; disabled: boolean }[]
  /** The operators this level offers: + − first, × ÷ and brackets as their rules arrive. */
  ops: { op: MakeOp; index: number; disabled: boolean }[]
  undo: { index: number; disabled: boolean }
  clear: { index: number; disabled: boolean }
  /** Enabled once every tile is used and the expression is complete. */
  submit: { index: number; disabled: boolean }
  /** What has been tapped so far. */
  expression: MakeToken[]
  /** The complete expression's exact value ('22', '3/4') — low levels only, as a help. */
  preview?: string
  /** Submits left in this trial (dots, never hearts). */
  tries: { left: number; total: number }
  /** After a wrong submit: what that expression came to ('22'). */
  lastValue?: string
  locked: boolean
  /**
   * Once over after a miss: one way to make it, tokens separated by single spaces, numbers as plain
   * digits ('( 8 − 2 ) × 4 = 24'); platforms format numbers and wrap before an operator.
   */
  reveal?: { lines: string[] }
}

/** A maze cell's walls, as bits of `MazeView.walls[i]`. */
export const MAZE_WALL = { top: 1, right: 2, bottom: 4, left: 8 } as const

/**
 * Maze Run (미로 찾기): from the start, along the corridors, to the goal (after the keys, in order).
 *
 * Input: `tap(cell)`. The player DRAGS from the path's end (web pointer events, mobile
 * react-native-gesture-handler Pan): the platform sends each cell the finger enters — the nearest
 * neighbour of the path's end — and a tap on a neighbour moves too (accessibility). A neighbour
 * through an open side extends the path; the cell before the end, or any earlier path cell, cuts
 * the path back to it (backtracking erases). Through a wall: nothing in a visible maze; in a hidden
 * one it is a bump — the wall flashes (`bump`) and one of the maze's forgiven bumps is spent
 * (`budget`, dots — never hearts: a slip of the finger must not cost a chance, EVIDENCE §5); the same
 * wall again before moving is free; one bump past the budget ends the trial as a miss (one chance,
 * as any miss). Anything else is ignored.
 *
 * Cells are never under 44dp (56dp in a hidden maze): the board is at most games/maze-run.ts
 * mazeFit(ctx, minCell) — past what fits the maze is capped, never drawn smaller. Colours:
 * games/maze-run.ts MAZE_COLORS (Okabe–Ito; shapes and the key numbers carry the meaning).
 */
export interface MazeView {
  kind: 'maze'
  prompt: PromptView
  cols: number
  rows: number
  /**
   * Per cell (reading order), the walls the player may see now (MAZE_WALL bits; both sides of a
   * wall agree, the outer border is always walled). Everything in a visible maze, during the
   * preview and once over; in a hidden maze after the preview, the outer border only (a bump
   * flashes its wall through `bump`).
   */
  walls: number[]
  start: number
  goal: number
  /**
   * Collect in `order` (1, 2, …) before the goal opens: stepping on the next key takes it, and it
   * stays taken when the path is cut back (keys sit in dead ends; the way back out retraces the path).
   */
  keys: { cell: number; order: number; taken: boolean }[]
  /** Every key taken: reaching the goal now ends the trial. */
  goalOpen: boolean
  /** The player's path: the start first, the current cell last. */
  path: number[]
  /** 'preview': walls on show, no input (`showBar` counts it down); 'play'; 'done'. */
  phase: 'preview' | 'play' | 'done'
  showBar?: { ms: number }
  /** The walls hide after the preview (a memory maze — a rule card). */
  hidden: boolean
  /**
   * The wall just bumped (hidden maze), to flash as a thick line with a shake until the next move:
   * the cell the player was on and the MAZE_WALL bit.
   */
  bump?: { cell: number; side: number }
  /**
   * A hidden maze's forgiven bumps: `left` of `total` (3 → 1 up the ladder). Drawn as dots with
   * «부딪힘 N번까지» — never as hearts: they are the maze's, not the round's chances.
   */
  budget?: { left: number; total: number }
  locked: boolean
  /** Once over after a miss: the way through (start, keys, goal) and every wall. */
  answer?: { path: number[]; walls: number[] }
}

export type RoundView = GridView | ChoiceView | SetMatchView | CodeBreakView | MakeNumberView | MazeView

export interface RoundOutcome {
  correct: boolean
  /** 0..1, how much of the round was right — softens the level drop on a near miss. */
  accuracy: number
  /** The trial did not count: it costs no life, moves no level and is replaced by a fresh one. */
  void?: boolean
  /**
   * Lives this trial spends, when not simply one-per-wrong-answer: Number Hunt spends one per tap
   * on the wrong number (a slow but clean grid costs none).
   */
  livesSpent?: number
  /** Match Pairs: mismatches made against cards already seen — the probe ladder reads it. */
  informedMisses?: number
  /**
   * Mistakes made inside the trial that did not end it on their own: Make the Number's wrong
   * submits, Maze Run's bumps into hidden walls (the maze's own budget — they spend no lives).
   */
  mistakes?: number
  /** Code Break: guesses used (solved or not). */
  guesses?: number
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
