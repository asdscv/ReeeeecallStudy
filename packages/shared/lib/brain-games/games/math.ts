import type { Rng } from '../rng'
import { choiceGame, numericOptions } from './choice'

/**
 * Mental arithmetic against the clock. Processing speed and working memory.
 *
 * Operations unlock by level (+ → − → × → ÷ → two-step and missing-operand); within each, the
 * number range keeps growing with level, so there is no last problem.
 */
interface Problem {
  text: string
  answer: number
  hints: number[]
  tag?: string
}

function simple(level: number, rng: Rng): Problem {
  const max = 6 + level * 4
  const ops = level < 3 ? ['+'] : level < 6 ? ['+', '−'] : level < 10 ? ['+', '−', '×'] : ['+', '−', '×', '÷']
  const op = rng.pick(ops)
  if (op === '+') {
    const a = rng.int(1, max)
    const b = rng.int(1, max)
    return { text: `${a} + ${b}`, answer: a + b, hints: [a + b + 10, Math.abs(a - b)] }
  }
  if (op === '−') {
    const a = rng.int(2, max)
    const b = rng.int(1, a)
    return { text: `${a} − ${b}`, answer: a - b, hints: [a + b], tag: 'math.sub' }
  }
  const factorMax = Math.min(9 + Math.floor(level / 4), 25)
  if (op === '×') {
    const a = rng.int(2, factorMax)
    const b = rng.int(2, 9)
    return { text: `${a} × ${b}`, answer: a * b, hints: [a * (b + 1), a * (b - 1), a + b], tag: 'math.mul' }
  }
  const b = rng.int(2, 9)
  const q = rng.int(2, factorMax)
  return { text: `${b * q} ÷ ${b}`, answer: q, hints: [q + 1, q - 1, b], tag: 'math.div' }
}

function advanced(level: number, rng: Rng): Problem {
  const max = 10 + level * 3
  const kind = rng.int(0, 2)
  if (kind === 0) {
    // a + b × c — precedence is the trap; (a + b) × c is the distractor.
    const a = rng.int(2, max)
    const b = rng.int(2, 9)
    const c = rng.int(2, 9)
    return { text: `${a} + ${b} × ${c}`, answer: a + b * c, hints: [(a + b) * c] }
  }
  if (kind === 1) {
    const a = rng.int(10, max * 2)
    const b = rng.int(2, max)
    const c = rng.int(1, a + b - 1)
    return { text: `${a} + ${b} − ${c}`, answer: a + b - c, hints: [a - b - c, a + b + c].filter((v) => v >= 0) }
  }
  // Missing operand: a + ? = c, or a × ? = c.
  if (rng.chance(0.5)) {
    const a = rng.int(2, max)
    const x = rng.int(2, max)
    return { text: `${a} + ? = ${a + x}`, answer: x, hints: [a + x, x + 10] }
  }
  const a = rng.int(2, 12)
  const x = rng.int(2, 12)
  return { text: `${a} × ? = ${a * x}`, answer: x, hints: [x + 1, x - 1, a] }
}

export const math = choiceGame('math', (level, rng) => {
  const twoStep = level >= 14 && rng.chance(Math.min(0.7, 0.3 + (level - 14) * 0.03))
  const problem = twoStep ? advanced(level, rng) : simple(level, rng)
  const { options, correctIndex } = numericOptions(problem.answer, rng, problem.hints)
  return {
    prompt: { key: 'play.solve' },
    stimulus: { text: problem.text.includes('?') ? problem.text : `${problem.text} = ?` },
    options: options.map((v) => ({ text: String(v) })),
    correctIndex,
    limitMs: Math.max(3500, 9500 - level * 180) + (twoStep ? 3000 : 0),
    picked: null,
    timedOut: false,
    sig: `ma:${problem.text}`,
    tags: twoStep ? ['math.twoStep'] : problem.tag ? [problem.tag] : [],
  }
})
