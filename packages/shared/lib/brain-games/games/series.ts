import type { Rng } from '../rng'
import { choiceGame, numericOptions } from './choice'

/**
 * A number pattern with the next term missing. Inductive reasoning.
 *
 * Rules unlock by level; every rule draws its start and step at random, so the same rule never
 * produces the same row twice in practice.
 */
interface Pattern {
  terms: number[]
  next: number
  hints: number[]
}

type Rule = (rng: Rng, level: number, count: number) => Pattern & { tag?: string }

const arithmetic: Rule = (rng, level, count) => {
  const d = rng.int(1, 3 + Math.floor(level / 2)) * (level >= 3 && rng.chance(0.35) ? -1 : 1)
  const start = d < 0 ? rng.int(-d * count + 1, -d * count + 20 + level * 2) : rng.int(1, 10 + level * 2)
  const terms = Array.from({ length: count }, (_, i) => start + d * i)
  const next = start + d * count
  return { terms, next, hints: [next + d, next - d, next + 1], ...(d < 0 ? { tag: 'series.descending' } : {}) }
}

const geometric: Rule = (rng, level, count) => {
  const r = rng.int(2, level >= 12 ? 4 : 3)
  const start = rng.int(1, r === 2 ? 6 : 3)
  const n = Math.min(count, 5)
  const terms = Array.from({ length: n }, (_, i) => start * r ** i)
  const next = start * r ** n
  return { terms, next, hints: [next + terms[n - 1], next - r, terms[n - 1] * (r + 1)] }
}

const alternating: Rule = (rng, level, count) => {
  const up = rng.int(2, 4 + Math.floor(level / 3))
  const down = rng.int(1, up - 1)
  let v = rng.int(down + 1, 15 + level)
  const terms = [v]
  for (let i = 1; i <= count; i++) {
    v += i % 2 === 1 ? up : -down
    terms.push(v)
  }
  const next = terms.pop() as number
  return { terms, next, hints: [next + up + down, next - up - down, next + 1] }
}

const growingStep: Rule = (rng, level, count) => {
  const step0 = rng.int(1, 3 + Math.floor(level / 5))
  const inc = rng.int(1, level >= 14 ? 3 : 2)
  let v = rng.int(1, 12)
  const terms = [v]
  for (let i = 0; i < count; i++) {
    v += step0 + inc * i
    terms.push(v)
  }
  const next = terms.pop() as number
  const lastStep = step0 + inc * (count - 1)
  return { terms, next, hints: [next - inc, next + inc, terms[terms.length - 1] + lastStep - inc * 2] }
}

const fibonacci: Rule = (rng, _level, count) => {
  const terms = [rng.int(1, 6), rng.int(1, 9)]
  while (terms.length < count + 1) terms.push(terms[terms.length - 1] + terms[terms.length - 2])
  const next = terms.pop() as number
  const last = terms[terms.length - 1]
  return { terms, next, hints: [last * 2, next + 1, next - 1] }
}

const squares: Rule = (rng, _level, count) => {
  const start = rng.int(1, 6)
  const offset = rng.int(-1, 3)
  const terms = Array.from({ length: count }, (_, i) => (start + i) ** 2 + offset)
  const k = start + count
  const next = k ** 2 + offset
  return { terms, next, hints: [next + 1, (k - 1) ** 2 + offset + k, next - 2] }
}

const interleaved: Rule = (rng, level, count) => {
  const a0 = rng.int(1, 10)
  const da = rng.int(1, 3 + Math.floor(level / 6))
  const b0 = rng.int(20, 40)
  const db = -rng.int(1, 4)
  const all = Array.from({ length: count + 2 }, (_, i) => (i % 2 === 0 ? a0 + da * (i / 2) : b0 + db * ((i - 1) / 2)))
  const next = all[count + 1]
  const terms = all.slice(0, count + 1)
  return { terms, next, hints: [terms[count] + da, next - db, next + 1] }
}

const doublePlus: Rule = (rng, _level, count) => {
  const c = rng.int(1, 3)
  const terms = [rng.int(1, 4)]
  const n = Math.min(count, 5)
  while (terms.length < n + 1) terms.push(terms[terms.length - 1] * 2 + c)
  const next = terms.pop() as number
  return { terms, next, hints: [next - c, next + c, terms[terms.length - 1] * 2] }
}

const RULES: readonly { from: number; rule: Rule; tag?: string }[] = [
  { from: 1, rule: arithmetic },
  { from: 4, rule: geometric, tag: 'series.geometric' },
  { from: 6, rule: alternating, tag: 'series.alternating' },
  { from: 8, rule: growingStep, tag: 'series.growing' },
  { from: 10, rule: fibonacci, tag: 'series.fibonacci' },
  { from: 12, rule: squares, tag: 'series.squares' },
  { from: 14, rule: interleaved, tag: 'series.interleaved' },
  { from: 16, rule: doublePlus, tag: 'series.doublePlus' },
]

export const series = choiceGame('series', (level, rng) => {
  const unlocked = RULES.filter((r) => level >= r.from)
  // The newest rule is the one being learned, so it comes up more often than the rest.
  const newest = unlocked[unlocked.length - 1]
  const pick = rng.chance(0.35) ? newest : rng.pick(unlocked)
  const count = level < 5 ? 4 : 5
  const pattern = pick.rule(rng, level, count)
  const { options, correctIndex } = numericOptions(pattern.next, rng, pattern.hints)
  const row = `${pattern.terms.join(', ')}, ?`
  return {
    prompt: { key: 'play.nextNumber' },
    stimulus: { text: row },
    options: options.map((v) => ({ text: String(v) })),
    correctIndex,
    limitMs: Math.max(6000, 15000 - level * 220),
    picked: null,
    timedOut: false,
    sig: `se:${row}`,
    tags: [pick.tag ?? pattern.tag].filter((x): x is string => typeof x === 'string'),
  }
})
