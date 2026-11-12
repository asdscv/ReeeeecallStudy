import type { BrainGameDef, ChoiceView, CreateContext, PromptView } from '../types'
import type { Rng } from '../rng'

/** The part every pick-one-answer game shares: options, the right one, the pick. */
export interface ChoiceState {
  prompt: PromptView
  stimulus: ChoiceView['stimulus']
  options: ChoiceView['options']
  correctIndex: number
  limitMs: number
  picked: number | null
  timedOut: boolean
  sig: string
}

export function choiceGame(
  id: BrainGameDef<ChoiceState>['id'],
  create: (level: number, rng: Rng, ctx: CreateContext) => ChoiceState,
  opts: { maxLevel?: number } = {},
): BrainGameDef<ChoiceState> {
  const done = (s: ChoiceState) => s.picked !== null || s.timedOut
  return {
    id,
    ...(opts.maxLevel !== undefined ? { maxLevel: () => opts.maxLevel as number } : {}),
    create,
    pendingMs: () => null,
    advance: (s) => s,
    acceptsInput: (s) => !done(s),
    tap: (s, i) => (done(s) || i < 0 || i >= s.options.length ? s : { ...s, picked: i }),
    timeout: (s) => (done(s) ? s : { ...s, timedOut: true }),
    outcome(s) {
      if (!done(s)) return null
      const correct = s.picked === s.correctIndex
      return { correct, accuracy: correct ? 1 : 0 }
    },
    timeLimitMs: (s) => s.limitMs,
    view(s) {
      return {
        kind: 'choice',
        prompt: s.prompt,
        stimulus: s.stimulus,
        options: s.options,
        ...(done(s) ? { picked: s.picked ?? undefined, correctIndex: s.correctIndex } : {}),
      }
    },
    signature: (s) => s.sig,
    solution: (s) => (done(s) ? null : [s.correctIndex]),
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
