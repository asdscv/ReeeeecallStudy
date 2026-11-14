import type { BrainGameDef, BrainGameId, BrainColor, CreateContext, SetCard } from './types'
import type { Rng } from './rng'
import { range } from './rng'
import { EXTREME_LEVELS } from './rules'
import { oddOneOut } from './games/odd-one-out'
import { schulte, type SchulteState } from './games/schulte'
import { memoryGrid } from './games/memory-grid'
import { sequence, SEQUENCE_MIN_INTERVAL_MS } from './games/sequence'
import { pairs, type PairsState } from './games/pairs'
import { stroop } from './games/stroop'
import { math } from './games/math'
import { series } from './games/series'
import type { ChoiceState } from './games/choice'
import { setMatch, setMatchBoard, type SetMatchState } from './games/set-match'
import { codeBreak } from './games/code-break'
import { makeNumber, type MakeNumberState } from './games/make-number'
import { mazeRun, measureWalk, type MazeState } from './games/maze-run'

/** The existing content ladder keeps its level numbers; twenty harder levels follow it. */
type DifficultyStage = 'foundation' | 'normal' | 'extreme'
interface RangeMeta { level: number; depth: number; stage: DifficultyStage; limitMs: number | null }
type Ranged<S> = S & { difficultyRange?: RangeMeta }
const mix = (from: number, to: number, depth: number) => from + (to - from) * depth

interface Profile<S> {
  foundation(s: S, rng: Rng, ctx: CreateContext, level: number): S
  foundationUntil?: number
  extreme?(s: S, depth: number, rng: Rng, ctx: CreateContext): S
  /** Minimum input time plus a small thinking budget; never a zero-length deadline. */
  floor(s: S): number
  /** A growing span, where the original game has spanLength(). */
  span?(level: number, coreMax: number, ctx: CreateContext): number
}

/** Pure, serialisable state metadata: edits, phase changes and copies keep the same deadline. */
function widen<S extends object>(base: BrainGameDef<S>, profile: Profile<NoInfer<S>>): BrainGameDef<S> {
  const info = (s: S) => (s as Ranged<S>).difficultyRange
  const keep = (from: S, to: S): S => to === from ? from : { ...to, difficultyRange: info(from) }
  const coreMax = (ctx: CreateContext) => base.maxLevel!(ctx)
  const gentle = (level: number) => level <= 1 || (profile.foundationUntil !== undefined && level < profile.foundationUntil)
  const firstSpan = (level: number) => Math.max(1, Math.min(3, Math.round(1 + 3 * (level - 1))))
  return {
    ...base,
    maxLevel: (ctx) => coreMax(ctx) + EXTREME_LEVELS,
    ...(base.spanLength ? { spanLength: (level: number, ctx: CreateContext) => {
      const lv = Number.isFinite(level) ? Math.max(1, Math.min(level, coreMax(ctx) + EXTREME_LEVELS)) : 1
      return gentle(lv) ? firstSpan(lv) : profile.span?.(lv, coreMax(ctx), ctx) ?? base.spanLength!(Math.min(lv, coreMax(ctx)), ctx)
    } } : {}),
    create(level, rng, ctx) {
      const max = coreMax(ctx)
      const lv = Number.isFinite(level) ? Math.max(1, Math.min(max + EXTREME_LEVELS, level)) : 1
      const depth = Math.max(0, (lv - max) / EXTREME_LEVELS)
      // Extreme trials use the hardest available content, while still respecting unseen rules.
      let s = base.create(Math.min(max, lv), rng, depth > 0 ? { ...ctx, trialKind: 'placement' } : ctx)
      if (gentle(lv)) s = profile.foundation(s, rng, ctx, lv)
      else if (depth > 0 && profile.extreme) s = profile.extreme(s, depth, rng, ctx)
      const original = base.timeLimitMs(s)
      const floor = profile.floor(s)
      const limitMs = gentle(lv) ? null : depth > 0 ? Math.round(floor + (Math.max(floor, original ?? 120_000) - floor) * (1 - depth) ** 2) : original
      return { ...s, difficultyRange: { level: lv, depth, stage: gentle(lv) ? 'foundation' : depth > 0 ? 'extreme' : 'normal', limitMs } }
    },
    advance: (s) => keep(s, base.advance(s)),
    tap: (s, index) => keep(s, base.tap(s, index)),
    timeout: (s) => keep(s, base.timeout(s)),
    timeLimitMs: (s) => info(s) ? info(s)!.limitMs : base.timeLimitMs(s),
    view(s) {
      const stage = info(s)?.stage
      return { ...base.view(s), ...(stage && stage !== 'normal' ? { difficulty: stage } : {}) }
    },
  }
}

function firstChoice(s: ChoiceState, answer: number, rng: Rng, text: string, tokens?: (number | string)[]): ChoiceState {
  const wrong = answer === 0 || rng.chance(0.5) ? answer + 1 : answer - 1
  const values = [answer, wrong].sort((a, b) => a - b)
  return { ...s, stimulus: { text, ...(tokens ? { tokens } : {}) }, options: values.map((v) => ({ text: String(v), value: v })), correctIndex: values.indexOf(answer), tags: [], reveal: undefined, sig: `foundation:${s.sig.split(':')[0]}:${text}`, info: { kind: 'foundation' } }
}

function biggerSet(s: SetMatchState, depth: number, rng: Rng, ctx: CreateContext): SetMatchState {
  if (s.vary.length < 4) return s
  const board = setMatchBoard(depth < 0.5 ? 18 : 20, ctx, s.noneOffered)
  const cards = [...s.cards]
  const shapes = [...new Set(s.cards.map((c) => c.shape))]
  const colors = [...new Set(s.cards.map((c) => c.color))]
  const fills = [...new Set(s.cards.map((c) => c.fill))]
  const key = (c: SetCard) => `${c.shape}|${c.count}|${c.color}|${c.fill}`
  const occupied = new Set(cards.map(key)), forbidden = new Set<string>()
  const third = <T,>(a: T, b: T, pool: readonly T[]) => a === b ? a : pool.find((x) => x !== a && x !== b)
  const forbid = (a: SetCard, b: SetCard) => {
    const shape = third(a.shape, b.shape, shapes), count = third(a.count, b.count, [1, 2, 3] as const)
    const color = third(a.color, b.color, colors), fill = third(a.fill, b.fill, fills)
    if (shape && count && color && fill) forbidden.add(key({ shape, count, color, fill }))
  }
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) forbid(cards[i], cards[j])
  for (let n = 0; cards.length < board.cards && n < 160; n++) {
    const card = { shape: rng.pick(shapes), count: rng.int(1, 3) as 1 | 2 | 3, color: rng.pick(colors), fill: rng.pick(fills) }
    const id = key(card)
    if (occupied.has(id) || forbidden.has(id)) continue
    for (const prior of cards) forbid(prior, card)
    cards.push(card)
    occupied.add(id)
  }
  // A maximal set-free board may have no extension. Keep the original board in that case.
  return cards.length === board.cards ? { ...s, cards, cols: board.cols, rows: board.rows } : s
}

export const DIFFICULTY_GAMES = {
  oddOneOut: widen(oddOneOut, {
    foundation: (s, rng) => ({ ...s, cols: 3, rows: 1, oddIndex: rng.int(0, 2), rotations: [0, 0, 0], inks: [], mirror: false, absent: false, none: false }),
    floor: () => 450,
  }),
  stroop: widen(stroop, {
    foundation: (s) => ({ ...s, stimulus: { ...s.stimulus, textKey: `colors.${s.stimulus.color as BrainColor}` } }),
    floor: () => 200,
  }),
  math: widen(math, {
    foundation(s, rng) {
      const a = rng.int(0, 2), b = rng.int(0, 2)
      return firstChoice(s, a + b, rng, `${a} + ${b} = ?`, [a, '+', b, '=', '?'])
    },
    floor: () => 450,
  }),
  series: widen(series, {
    foundation(s, rng) {
      const a = rng.int(0, 2)
      return { ...firstChoice(s, a + 3, rng, `${a}, ${a + 1}, ${a + 2}, ?`), stimulus: { text: `${a}, ${a + 1}, ${a + 2}, ?`, terms: [a, a + 1, a + 2, null] } }
    },
    floor: () => 600,
  }),
  memoryGrid: widen(memoryGrid, {
    foundationUntil: 2,
    foundation(s, rng, _ctx, level) {
      const count = Math.max(1, Math.min(3, Math.round(1 + 3 * (level - 1))))
      const side = count === 3 ? 3 : 2
      const targets = rng.sample(range(side * side), count).sort((a, b) => a - b)
      return { ...s, cols: side, rows: side, targets, waves: [targets], showMs: 3500, fallback: false }
    },
    extreme: (s, d) => ({ ...s, showMs: Math.round(mix(s.showMs, 100, d)), gapMs: Math.max(500, s.gapMs) }),
    floor: (s) => 750 + s.targets.length * 180,
  }),
  sequence: widen(sequence, {
    foundationUntil: 2,
    foundation: (s, rng, _ctx, level) => ({ ...s, n: 2, seq: rng.sample(range(4), Math.max(1, Math.min(3, Math.round(1 + 3 * (level - 1))))), reverse: false, flashMs: 1800, gapMs: 700 }),
    extreme(s, d, rng) {
      const seq = [...s.seq]
      const length = Math.round(mix(s.seq.length, 64, d))
      while (seq.length < length) {
        const batch = rng.shuffle(range(s.n * s.n))
        if (batch[0] === seq.at(-1)) batch.push(batch.shift()!)
        seq.push(...batch.slice(0, length - seq.length))
      }
      const flashMs = Math.round(mix(s.flashMs, 80, d))
      return { ...s, seq, flashMs, gapMs: Math.max(s.gapMs, SEQUENCE_MIN_INTERVAL_MS - flashMs) }
    },
    floor: (s) => 750 + s.seq.length * 180,
    span: (lv, max, ctx) => lv <= max ? sequence.spanLength!(lv, ctx) : Math.round(mix(sequence.spanLength!(max, ctx), 64, (lv - max) / EXTREME_LEVELS)),
  }),
  pairs: widen(pairs, {
    foundation: (s): PairsState => ({ ...s, size: 2, cols: 2, rows: 1, cards: [s.cards[0], s.cards[0]], matched: [false, false], seen: [false, false], previewMs: 5000, budget: 5, phase: 'preview' }),
    extreme: (s, d) => ({ ...s, budget: Math.round(s.budget * (1 - d)), previewMs: Math.round(s.previewMs * (1 - d)) }),
    floor: (s) => 1000 + s.cards.length * 710,
  }),
  schulte: widen(schulte, {
    foundation: (s): SchulteState => ({ ...s, n: 1, cols: 1, rows: 1, mode: 'asc', values: [1], amber: [false], sequence: [0], unmarked: false, previewMs: 0, phase: 'play' }),
    extreme(s, d, rng, ctx): SchulteState {
      if (ctx.blockRules.includes('schulte.memory')) return s
      const cols = Math.max(3, Math.min(7, ctx.maxCols)), rows = Math.max(3, Math.min(7, ctx.maxRows))
      const values = rng.shuffle(range(cols * rows)).map((n) => n + 1)
      const sequence = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
      return { ...s, n: Math.max(cols, rows), cols, rows, mode: 'memory', values, amber: values.map(() => false), sequence, phase: 'preview', previewMs: Math.round(mix(12_000, 400, d)), maxMistakes: 1 }
    },
    floor: (s) => 750 + s.values.length * 180,
  }),
  setMatch: widen(setMatch, {
    foundation: (s): SetMatchState => ({ ...s, cards: s.set!.map((i) => s.cards[i]), cols: 3, rows: 1, set: [0, 1, 2], noneOffered: false }),
    extreme: biggerSet,
    floor: () => 1000,
  }),
  codeBreak: widen(codeBreak, {
    foundation(s, rng) {
      return { ...s, length: 1, pool: [1, 2], secret: [rng.int(1, 2)], plan: [rng.int(1, 2)], maxGuesses: 2, space: 2 }
    },
    extreme(s, _d, rng, ctx) {
      if (ctx.blockRules.includes('codeBreak.repeats')) return s
      return { ...s, repeats: true, secret: Array.from({ length: s.length }, () => rng.pick(s.pool)), space: s.pool.length ** s.length, plan: Array.from({ length: s.length }, () => rng.pick(s.pool)) }
    },
    floor: (s) => 1000 + s.maxGuesses * (s.length + 1) * 180,
  }),
  makeNumber: widen(makeNumber, {
    foundation(s, rng): MakeNumberState {
      const a = rng.int(0, 2), b = rng.int(1, 2)
      return { ...s, tiles: [a, b], target: a + b, expr: [{ kind: 'num', value: a, tile: 0 }], witness: [{ kind: 'num', value: a, tile: 0 }, { kind: 'op', op: '+' }, { kind: 'num', value: b, tile: 1 }], preview: true, tries: 5, triesLeft: 5 }
    },
    extreme(s, d, rng) {
      if (s.order !== 'any' || !s.ops.includes('(') || !s.ops.includes('×')) return s
      const tiles = [...s.tiles]
      let witness = [...s.witness], target = s.target
      for (let n = 0; n < Math.floor(d * 2.99); n++) {
        const value = rng.int(2, 9), tile = tiles.length
        tiles.push(value)
        target *= value
        witness = [{ kind: 'op', op: '(' }, ...witness, { kind: 'op', op: ')' }, { kind: 'op', op: '×' }, { kind: 'num', value, tile }]
      }
      const tries = d >= 0.5 ? 1 : s.tries
      return { ...s, tiles, target, witness, ways: tiles.length > s.tiles.length ? 0 : s.ways, tries, triesLeft: tries }
    },
    floor: (s) => 1000 + (s.witness.length + 1) * 180,
  }),
  mazeRun: widen(mazeRun, {
    foundation: (s): MazeState => ({ ...s, cols: 2, rows: 2, walls: [13, 3, 13, 6], start: 0, goal: 1, path: [0], keys: [], hidden: false, previewMs: 0, phase: 'play', steps: 1, forks: 0, turns: 0, tags: [] }),
    extreme(s, d, rng) {
      const free = range(s.walls.length).filter((i) => i !== s.start && i !== s.goal && !s.keys.includes(i))
      const keys = s.keys.length ? [...s.keys, ...rng.sample(free, Math.floor(d * 3))] : []
      const path = mazeRun.solution({ ...s, keys, phase: 'play' }) ?? []
      const measures = measureWalk(s.cols, s.rows, s.walls, [s.start, ...path])
      return { ...s, keys, steps: path.length, ...measures, previewMs: s.hidden ? Math.round(mix(s.previewMs, 500, d)) : s.previewMs, maxMistakes: s.hidden ? Math.round(s.maxMistakes * (1 - d)) : s.maxMistakes }
    },
    floor: (s) => 1500 + s.steps * 180,
  }),
} satisfies Record<BrainGameId, { id: BrainGameId }>
