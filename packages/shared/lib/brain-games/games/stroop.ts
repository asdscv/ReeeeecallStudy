import type { BrainColor, CreateContext } from '../types'
import { createRng, type Rng } from '../rng'
import { INK_CONFUSABLE } from '../theme'
import { choiceGame, type ChoiceState } from './choice'

/**
 * A colour word printed in a different ink. Pick the INK — or, when the cue says so, the word.
 * Inhibition: reading is automatic, and the task is to not do it.
 *
 * The level picks what has to be held back (GAMES_DIFFICULTY_PLAN §3.5), not just how many buttons
 * there are: more colours and more conflicting words (L1-4), buttons that move every trial (L5),
 * six colours (L7), button labels inked in lure colours (L8), the ink being the word just read (L9),
 * a cue that switches the rule to the word (L10; half the trials from L12), a frame in a third colour
 * (L14), and a cue that comes later and later until it arrives with the word (L16, L18). Past L19
 * only the clock tightens; the puzzle stops changing at L34.
 */
/** The colour-vision-safe six (theme.ts INK_COLORS): no red, green or yellow. */
export const BRAIN_COLORS: readonly BrainColor[] = ['blue', 'orange', 'purple', 'black', 'brown', 'gray']

/** Past this only the clock would move, and the staircase stops (the clock is 1.6s there). */
export const STROOP_MAX_LEVEL = 34

/** The rules a trial may be told not to use (ctx.blockRules), and what replaces them. */
const RULE = { word: 'stroop.word', labelInk: 'stroop.labelInk' } as const

/** What a level shows — one row of the plan's §3.5 table. */
export interface StroopBand {
  /** Options, all from the round's colour subset (2 · 3 · 4 · 5 · 6). */
  options: number
  /** Share of trials whose word and ink differ, word-rule trials included. */
  conflict: number
  /** The buttons change places every trial (before L5 they keep the round's order). */
  shuffle: boolean
  /** Button labels in colour: one in the stimulus ink as a lure, never the answer. */
  labels: boolean
  /** On half the conflicting trials the ink is the word the trial before showed. */
  carry: boolean
  /** Share of trials that ask for the word (the cued switch); 0 before L10. */
  switchShare: number
  /** How long the cue is up before the word, once the cue is in play (L10); null before. */
  leadMs: number | null
  /** A ring round the card in a third colour, never the answer. */
  frame: boolean
}

/** Levels as the game reads them: a number from 1 to the cap (fractions kept for the clock). */
function safeLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(STROOP_MAX_LEVEL, Math.max(1, level)) : 1
}

export function stroopBand(level: number): StroopBand {
  const lv = Math.floor(safeLevel(level))
  return {
    options: lv >= 7 ? 6 : lv >= 6 ? 5 : lv >= 4 ? 4 : lv >= 2 ? 3 : 2,
    conflict: lv >= 4 ? 0.75 : lv >= 3 ? 2 / 3 : lv >= 2 ? 0.6 : 0.5,
    shuffle: lv >= 5,
    labels: lv >= 8,
    carry: lv >= 9,
    switchShare: lv >= 12 ? 0.5 : lv >= 10 ? 0.25 : 0,
    leadMs: lv >= 18 ? 0 : lv >= 16 ? 300 : lv >= 10 ? 600 : null,
    frame: lv >= 14,
  }
}

/**
 * The input clock (the cue lead comes before it): time to read N options, find a coloured label and
 * check the cue, tightened 4.5% a level — 4.8s at L1, 4.9s at L10, 3.1s at L20, 1.6s at L34. It is
 * the level's own content that sets it, so a trial whose rule is blocked keeps the same clock.
 */
export function stroopLimitMs(level: number): number {
  const lv = safeLevel(level)
  const band = stroopBand(lv)
  const work = 3800 + 480 * band.options + (band.labels ? 400 : 0) + (band.switchShare > 0 ? 400 : 0)
  return Math.max(1200, Math.round(work * 0.955 ** (lv - 1)))
}

/**
 * The round's colours, in the round's order: a permutation fixed by `roundSeed`. A level with N
 * options uses the first N, so colours are added at the end as N grows and, before L5, every button
 * keeps its place for the whole round. The first two are never a confusable pair (INK_CONFUSABLE):
 * L1 shows only those two, so a colour-blind player can always tell its buttons apart.
 */
export function stroopColors(roundSeed: number): BrainColor[] {
  const order = createRng(roundSeed).shuffle(BRAIN_COLORS)
  const j = order.findIndex((c, i) => i >= 1 && !INK_CONFUSABLE[order[0]].includes(c))
  if (j > 1) [order[1], order[j]] = [order[j], order[1]]
  return order
}

/**
 * Inks for the option labels: exactly one in the stimulus ink (a lure — never the answer, never a
 * label naming that colour), the rest in colours a colour-blind player cannot mistake for the
 * stimulus ink, and no label in the colour it names. A label with no such colour left stays white.
 */
function labelInks(colors: readonly BrainColor[], ink: BrainColor, answer: BrainColor, rng: Rng): (BrainColor | undefined)[] | null {
  const lures = colors.map((_, i) => i).filter((i) => colors[i] !== ink && colors[i] !== answer)
  if (lures.length === 0) return null
  const lure = rng.pick(lures)
  const safe = colors.filter((c) => c !== ink && !INK_CONFUSABLE[ink].includes(c))
  return colors.map((c, i) => {
    if (i === lure) return ink
    const pool = safe.filter((s) => s !== c)
    return pool.length > 0 ? rng.pick(pool) : undefined
  })
}

/** The frame lure: neither the ink nor the word, and not a colour that could pass for the ink. */
function frameColor(colors: readonly BrainColor[], ink: BrainColor, word: BrainColor, rng: Rng): BrainColor | undefined {
  const pool = colors.filter((c) => c !== ink && c !== word && !INK_CONFUSABLE[ink].includes(c))
  return pool.length > 0 ? rng.pick(pool) : undefined
}

const sameOrder = (a: readonly BrainColor[], b: readonly BrainColor[]) => a.every((c, i) => c === b[i])

function createStroop(level: number, rng: Rng, ctx: CreateContext): ChoiceState {
  const lv = safeLevel(level)
  const band = stroopBand(lv)
  const subset = stroopColors(ctx.roundSeed).slice(0, band.options)
  // A blocked word rule leaves ink-only trials with no cue; blocked labels stay white.
  const switching = band.switchShare > 0 && !ctx.blockRules.includes(RULE.word)
  const labelled = band.labels && !ctx.blockRules.includes(RULE.labelInk)
  const rule: 'ink' | 'word' = switching && rng.chance(band.switchShare) ? 'word' : 'ink'
  // Word-rule trials always conflict; ink trials make up the rest of the level's share.
  const inkConflict = switching ? (band.conflict - band.switchShare) / (1 - band.switchShare) : band.conflict
  const conflicting = rule === 'word' || rng.chance(inkConflict)

  const last = ctx.recent.length > 0 ? ctx.recent[ctx.recent.length - 1] : undefined
  const prevWord = subset.find((c) => c === last?.carry)
  let word: BrainColor
  let ink: BrainColor
  if (band.carry && conflicting && prevWord !== undefined && rng.chance(0.5)) {
    // Carry-over: the word just read comes back as the ink to name.
    ink = prevWord
    word = rng.pick(subset.filter((c) => c !== ink))
  } else {
    word = rng.pick(subset)
    ink = conflicting ? rng.pick(subset.filter((c) => c !== word)) : word
  }
  const answer = rule === 'ink' ? ink : word

  let colors = subset
  if (band.shuffle) {
    // The buttons move: never the round's home order.
    colors = rng.shuffle(subset)
    for (let i = 0; i < 8 && sameOrder(colors, subset); i++) colors = rng.shuffle(subset)
  }
  const inks = labelled ? labelInks(colors, ink, answer, rng) : null
  const frame = band.frame ? frameColor(subset, ink, word, rng) : undefined
  const cue = switching ? rule : undefined

  return {
    prompt: { key: rule === 'ink' ? 'play.pickInk' : 'play.pickWord' },
    stimulus: { textKey: `colors.${word}`, color: ink, ...(cue ? { cue } : {}), ...(frame ? { frame } : {}) },
    options: colors.map((c, i) => ({ textKey: `colors.${c}`, ...(inks?.[i] ? { color: inks[i] } : {}) })),
    correctIndex: colors.indexOf(answer),
    limitMs: stroopLimitMs(lv),
    picked: null,
    timedOut: false,
    sig: `st:${rule}:${word}:${ink}:${colors.join(',')}${inks ? `:${inks.join(',')}` : ''}${frame ? `:f${frame}` : ''}`,
    tags: [
      ...(band.options >= 3 ? [`stroop.options${band.options}`] : []),
      ...(band.shuffle ? ['stroop.shuffle'] : []),
      ...(inks ? [RULE.labelInk] : []),
      // The cue is the word rule: its card comes with the first cued trial, whichever rule it asks.
      ...(switching ? [RULE.word] : []),
      ...(switching && band.switchShare >= 0.5 ? ['stroop.switchOften'] : []),
      ...(frame ? ['stroop.frame'] : []),
    ],
    // After a miss on an ink trial: «글자 색: 보라». (A word trial's miss is usually the ink picked,
    // so naming the ink there would only confirm the slip.)
    ...(rule === 'ink' ? { reveal: { prompt: { key: 'play.inkWas', params: { color: `colors.${ink}` } } } } : {}),
    info: { kind: rule, carry: word },
    ...(cue && band.leadMs ? { leadMs: band.leadMs } : {}),
  }
}

export const stroop = choiceGame('stroop', createStroop, { maxLevel: STROOP_MAX_LEVEL })
