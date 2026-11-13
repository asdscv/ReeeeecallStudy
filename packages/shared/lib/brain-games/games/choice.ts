import type { BrainGameDef, ChoiceView, CreateContext, PromptView } from '../types'
import type { Rng } from '../rng'

/** The part every pick-one-answer game shares: options, the right one, the pick. */
export interface ChoiceState {
  prompt: PromptView
  /**
   * Passed to the view as it is (`tokens`, `terms`, `cue`, `frame` included) — except `reveal`,
   * which is only shown once the trial is over, and `hidden`, which the lead phase sets.
   */
  stimulus: ChoiceView['stimulus']
  /** Passed through, `value` and `color` included. Numeric options come sorted ascending. */
  options: ChoiceView['options']
  correctIndex: number
  limitMs: number
  picked: number | null
  timedOut: boolean
  sig: string
  /** Mechanics (mechanics.ts) this trial uses. */
  tags?: string[]
  /** Shown once the trial is over (the same as `stimulus.reveal`; either may carry it). */
  reveal?: ChoiceView['stimulus']['reveal']
  /** What kind of trial this is, reported as `trialInfo` (a band, a rule; Color Word's word as `carry`). */
  info?: { kind: string; carry?: string }
  /**
   * A lead before the answer phase: for this long the stimulus is hidden (the cue is up) and no
   * input is taken. The input clock starts after it.
   */
  leadMs?: number
  /** Set by choiceGame: 'lead' while `leadMs` runs, then 'answer'. */
  phase?: 'lead' | 'answer'
}

export function choiceGame(
  id: BrainGameDef<ChoiceState>['id'],
  create: (level: number, rng: Rng, ctx: CreateContext) => ChoiceState,
  opts: { maxLevel?: number } = {},
): BrainGameDef<ChoiceState> {
  const done = (s: ChoiceState) => s.picked !== null || s.timedOut
  const leading = (s: ChoiceState) => s.phase === 'lead' && !done(s)
  return {
    id,
    ...(opts.maxLevel !== undefined ? { maxLevel: () => opts.maxLevel as number } : {}),
    create(level, rng, ctx) {
      const s = create(level, rng, ctx)
      return { ...s, phase: s.leadMs !== undefined && s.leadMs > 0 ? 'lead' : 'answer' }
    },
    pendingMs: (s) => (leading(s) ? (s.leadMs as number) : null),
    advance: (s) => (leading(s) ? { ...s, phase: 'answer' } : s),
    acceptsInput: (s) => !done(s) && !leading(s),
    tap: (s, i) => (done(s) || leading(s) || i < 0 || i >= s.options.length ? s : { ...s, picked: i }),
    timeout: (s) => (done(s) ? s : { ...s, timedOut: true }),
    outcome(s) {
      if (!done(s)) return null
      const correct = s.picked === s.correctIndex
      return { correct, accuracy: correct ? 1 : 0 }
    },
    timeLimitMs: (s) => s.limitMs,
    view(s) {
      const { reveal: stimReveal, hidden: _hidden, ...stimulus } = s.stimulus
      const reveal = s.reveal ?? stimReveal
      return {
        kind: 'choice',
        prompt: s.prompt,
        stimulus: {
          ...stimulus,
          ...(leading(s) ? { hidden: true } : {}),
          ...(done(s) && reveal ? { reveal } : {}),
        },
        options: s.options,
        ...(done(s) ? { picked: s.picked ?? undefined, correctIndex: s.correctIndex } : {}),
      }
    },
    signature: (s) => s.sig,
    solution: (s) => (done(s) || leading(s) ? null : [s.correctIndex]),
    mechanics: (s) => s.tags ?? [],
    trialInfo: (s) => s.info ?? { kind: '' },
  }
}

/**
 * Plausible wrong answers around `answer`: off by one, off by the step, a digit slip. Distinct
 * and non-negative, so the right answer is never the only sensible-looking option.
 */
export function numericOptions(answer: number, rng: Rng, hints: number[] = []): { options: number[]; correctIndex: number } {
  const candidates = new Set<number>()
  const add = (v: number) => {
    if (Number.isFinite(v) && v >= 0 && v !== answer && Number.isInteger(v)) candidates.add(v)
  }
  hints.forEach(add)
  ;[1, -1, 2, -2, 10, -10].forEach((d) => add(answer + d))
  const digits = String(answer)
  if (digits.length >= 2) add(Number(digits.slice(0, -2) + digits.slice(-1) + digits.slice(-2, -1)))
  // Bounded: a non-finite answer (corrupt input) must not spin forever looking for neighbours.
  for (let spread = 3, tries = 0; candidates.size < 3 && tries < 200; spread += 2, tries++) add(answer + rng.int(-spread, spread))
  for (let k = 1; candidates.size < 3; k++) candidates.add(k * 1000 + candidates.size)
  const wrong = rng.sample([...candidates], 3)
  const options = rng.shuffle([answer, ...wrong])
  return { options, correctIndex: options.indexOf(answer) }
}

/** A wrong answer a real slip produces. A `trap` (the left-to-right result) is always offered, however far off. */
export interface NearMissError {
  v: number
  trap?: boolean
}

export interface NearMissOpts {
  /** Options in all, the answer included (default 4). */
  count?: number
  /**
   * Multi-digit add/subtract with an answer ≥ 50: at least two distractors end in the answer's
   * units digit, so the units column alone never gives the answer away.
   */
  sameUnits?: boolean
}

const FILL_STEPS = [1, 2, 10, 100] as const

/**
 * Near-miss options for a numeric answer, sorted ascending. The answer's sorted position is drawn
 * first, uniformly (redrawn among the feasible ones when a small answer has too little room
 * below), so neither "the middle option" nor "the odd one out" finds it. Distractors are built to
 * fit: the given errors first, then ±1/±2/±10/±100, then anything else in range. All are distinct
 * non-negative integers within ±max(20%, 20) of the answer — except traps, which are always
 * offered however far off. Gives up after 200 tries and falls back to `numericOptions` (sorted).
 */
export function nearMissOptions(
  answer: number,
  errors: readonly NearMissError[],
  rng: Rng,
  opts: NearMissOpts = {},
): { options: number[]; correctIndex: number } {
  const fallback = () => {
    const { options } = numericOptions(answer, rng, errors.map((e) => e.v))
    const sorted = options.slice().sort((a, b) => a - b)
    return { options: sorted, correctIndex: sorted.findIndex((v) => Object.is(v, answer)) }
  }
  if (!Number.isInteger(answer) || answer < 0) return fallback()
  const count = Math.max(2, Math.round(opts.count ?? 4))
  const band = Math.floor(Math.max(answer * 0.2, 20))
  const valid = (v: number) => Number.isInteger(v) && v >= 0 && v !== answer
  const inBand = (v: number) => valid(v) && Math.abs(v - answer) <= band
  // Every trap is offered (as far as there is room), on whichever side it falls.
  const traps = [...new Set(errors.filter((e) => e.trap && valid(e.v)).map((e) => e.v))].slice(0, count - 1)
  const trapsBelow = traps.filter((v) => v < answer)
  // What fits below: every in-band integer there (above there is always room), plus far traps.
  const roomBelow = Math.min(answer, band) + trapsBelow.filter((v) => !inBand(v)).length
  const feasible = (p: number) => p >= trapsBelow.length && count - 1 - p >= traps.length - trapsBelow.length && p <= roomBelow
  const ok = Array.from({ length: count }, (_, p) => p).filter(feasible)
  if (ok.length === 0) return fallback()
  const units = answer % 10

  for (let tries = 0; tries < 200; tries++) {
    const drawn = rng.int(0, count - 1)
    const p = feasible(drawn) ? drawn : rng.pick(ok)
    const below: number[] = []
    const above: number[] = []
    const room = (side: number[]) => (side === below ? p : count - 1 - p)
    const taken = (v: number) => below.includes(v) || above.includes(v)
    const add = (v: number, trap = false): boolean => {
      if (!(trap ? valid(v) : inBand(v)) || taken(v)) return false
      const side = v < answer ? below : above
      if (side.length >= room(side)) return false
      side.push(v)
      return true
    }
    traps.forEach((v) => add(v, true))
    const given = new Set(errors.filter((e) => !e.trap && add(e.v)).map((e) => e.v))
    for (const d of rng.shuffle(FILL_STEPS)) {
      add(answer + d)
      add(answer - d)
    }
    // Still short (a small answer, or errors that took the near steps): elsewhere in range, a few
    // random tries a side, then the nearest free values.
    for (const [side, sign] of [[below, -1], [above, 1]] as const) {
      for (let k = 0; k < 12 && side.length < room(side); k++) add(answer + sign * rng.int(3, band))
      for (let d = 3; d <= band && side.length < room(side); d++) add(answer + sign * d)
    }
    if (below.length + above.length < count - 1) continue

    if (opts.sameUnits) {
      const sharing = () => [...below, ...above].filter((v) => v % 10 === units).length
      // Swap a distractor for a same-units one on its own side (nearest first): fill before the
      // given errors, and never a trap.
      for (const keepGiven of [true, false]) {
        for (const side of [above, below]) {
          const sign = side === above ? 1 : -1
          for (let i = side.length - 1; i >= 0 && sharing() < 2; i--) {
            const v = side[i]
            if (traps.includes(v) || v % 10 === units || (keepGiven && given.has(v))) continue
            for (let k = 1; 10 * k <= band; k++) {
              const w = answer + sign * 10 * k
              if (inBand(w) && !taken(w)) {
                side[i] = w
                break
              }
            }
          }
        }
      }
      if (sharing() < 2) continue
    }
    const options = [...below, answer, ...above].sort((a, b) => a - b)
    return { options, correctIndex: options.indexOf(answer) }
  }
  return fallback()
}
