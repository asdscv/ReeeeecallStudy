import type { Rng } from '../rng'
import type { BrainGameDef, FieldSlot, QePlaceId, QuickEyeView } from '../types'

/**
 * Quick Eye — speed of processing with divided attention.
 *
 * Modelled on the speed-of-processing training of the ACTIVE trial and IHAMS (Ball 2002; Ball 2013;
 * Wolinsky 2013; Edwards 2018), whose outcome test is the Useful Field of View (Owsley 2013): a
 * central object and a peripheral target flash together, a mask follows, and the player reports
 * what was in the centre and where the target was. Difficulty is the EXPOSURE TIME, adapted to
 * hold ~80% correct, plus a ladder of variants (wider field, distractors, more similar centre
 * objects, a same/different centre task). Answers are untimed — "speed" is measured by how little
 * exposure the player needs, so slower choice reaction time with age is never penalised.
 *
 * Not the commercial program and not tested in a study; the in-app research page says so.
 * (Trademarked names of the original tests and products are deliberately not used anywhere.)
 */

/** Exposure ladder in ms, from easiest (level 0) to hardest (level 12): 30 frames down to 1 at 60Hz. */
export const QUICK_EYE_LADDER_MS = [500, 400, 333, 267, 217, 167, 133, 100, 83, 67, 50, 33, 17] as const

/** The highest ladder step a floor of `minMs` still shows differently from the one before. */
export function quickEyeMaxLevel(minMs: number): number {
  let top = 0
  QUICK_EYE_LADDER_MS.forEach((ms, i) => {
    if (ms >= minMs) top = i
  })
  return top
}

/** The exposure a level actually shows on a platform with this floor. */
export function quickEyeMsAt(level: number, minMs = 33): number {
  return Math.max(exposureMsFor(level), minMs)
}

export function exposureMsFor(level: number): number {
  const i = Math.max(0, Math.min(QUICK_EYE_LADDER_MS.length - 1, Math.round(level)))
  return QUICK_EYE_LADDER_MS[i]
}

export interface QuickEyeVariant {
  /** Rings the target may appear on (0 inner, 1 middle, 2 outer); empty = centre only. */
  rings: number[]
  distractors: number
  /** 1 (very different centre shapes) to 9 (nearly identical). */
  similarity: number
  /** Two centre shapes, answered same / different, instead of one shape identified. */
  sameDifferent: boolean
}

/**
 * The ladder, in the order the trials' progression used: centre alone → plus the periphery,
 * widening ring by ring → plus distractors → closer centre shapes → a harder centre task.
 */
export const QUICK_EYE_VARIANTS: readonly QuickEyeVariant[] = [
  { rings: [], distractors: 0, similarity: 1, sameDifferent: false },
  { rings: [0], distractors: 0, similarity: 1, sameDifferent: false },
  { rings: [0, 1], distractors: 0, similarity: 1, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 0, similarity: 1, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 7, similarity: 1, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 15, similarity: 1, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 23, similarity: 1, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 31, similarity: 1, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 47, similarity: 1, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 47, similarity: 3, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 47, similarity: 5, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 47, similarity: 7, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 47, similarity: 8, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 47, similarity: 9, sameDifferent: false },
  { rings: [0, 1, 2], distractors: 47, similarity: 5, sameDifferent: true },
  { rings: [0, 1, 2], distractors: 47, similarity: 9, sameDifferent: true },
]

export const QUICK_EYE_MAX_VARIANT = QUICK_EYE_VARIANTS.length

export function quickEyeVariant(n: number): QuickEyeVariant {
  return QUICK_EYE_VARIANTS[Math.max(1, Math.min(QUICK_EYE_MAX_VARIANT, Math.round(n))) - 1]
}

/**
 * Centre shapes. 'circle' against a rounded square whose corner radius approaches a circle as
 * similarity rises: `square:<radius %>`. Drawn by the platforms, so they look identical on every
 * device (emoji do not, and some simulators draw them as boxes).
 */
export function shapePair(similarity: number): [string, string] {
  const radius = Math.round(((Math.max(1, Math.min(9, similarity)) - 1) / 8) * 40)
  return ['circle', `square:${radius}`]
}

export const FIELD_RINGS = 3

/**
 * The stage groups, each with its own field tint and reveal colour (quick-eye-art.ts): one new
 * thing per group — the centre alone, the widening field, distractors, closer centre shapes, the
 * same/different task. Ids only; never shown as names (the header says "Stage N").
 */
export const QE_PLACES: readonly { id: QePlaceId; from: number; to: number }[] = [
  { id: 'dock', from: 1, to: 1 },
  { id: 'shore', from: 2, to: 4 },
  { id: 'pines', from: 5, to: 9 },
  { id: 'tea', from: 10, to: 14 },
  { id: 'lake', from: 15, to: 16 },
]

/** The stage group a variant belongs to. Centre-only play shows the centre task alone through stage 9. */
export function quickEyePlace(variant: number, centerOnly = false): QePlaceId {
  const v = Math.max(1, Math.min(QUICK_EYE_MAX_VARIANT, Math.round(variant)))
  if (centerOnly && v <= 9) return 'dock'
  return (QE_PLACES.find((p) => v >= p.from && v <= p.to) ?? QE_PLACES[0]).id
}

/** The slot on a ring of `slots` slots that lies on radial direction `dir` (0-7, clockwise from 12). */
export function radialSlot(slots: number, dir: number): number {
  return (dir * slots) / 8
}

const FIXATION_MS = 500
const MASK_MS = 500

export interface QuickEyeState {
  variant: number
  level: number
  exposureMs: number
  center: string[]
  centerOptions: string[]
  correctCenter: number
  target: FieldSlot | null
  /** Radial direction of the target, 0-7. */
  targetDir: number | null
  distractors: FieldSlot[]
  ringSlots: number[]
  shownMs: number | null
  phase: QuickEyeView['phase']
  pickedCenter: number | null
  pickedDirection: number | null
  void: boolean
  /** Created on the centre-only setting (picks the stage group's tint; the field is empty anyway). */
  centerOnly: boolean
}

function buildField(
  v: QuickEyeVariant,
  rng: Rng,
  ringSlots: number[],
): { target: FieldSlot | null; targetDir: number | null; distractors: FieldSlot[] } {
  if (v.rings.length === 0) return { target: null, targetDir: null, distractors: [] }
  const ring = rng.pick(v.rings)
  const dir = rng.int(0, 7)
  const target = { ring, slot: radialSlot(ringSlots[ring], dir) }
  const free: FieldSlot[] = []
  for (let r = 0; r < FIELD_RINGS; r++) {
    for (let slot = 0; slot < ringSlots[r]; slot++) {
      if (r === target.ring && slot === target.slot) continue
      free.push({ ring: r, slot })
    }
  }
  // On a phone's shorter field the top variants run out of slots (39 rather than 47): the
  // distractor count is capped by what fits, never by shrinking stimuli into each other.
  return { target, targetDir: dir, distractors: rng.sample(free, Math.min(v.distractors, free.length)) }
}

export const quickEye: BrainGameDef<QuickEyeState> = {
  id: 'quickEye',
  create(level, rng, ctx) {
    const v = quickEyeVariant(ctx.variant)
    const pair = shapePair(v.similarity)
    let center: string[]
    let centerOptions: string[]
    let correctCenter: number
    if (v.sameDifferent) {
      const same = rng.chance(0.5)
      const a = rng.pick(pair)
      center = [a, same ? a : pair[pair.indexOf(a) === 0 ? 1 : 0]]
      centerOptions = ['same', 'different']
      correctCenter = same ? 0 : 1
    } else {
      correctCenter = rng.int(0, 1)
      center = [pair[correctCenter]]
      centerOptions = [pair[0], pair[1]]
    }
    const field = ctx.centerOnly ? { target: null, targetDir: null, distractors: [] } : buildField(v, rng, ctx.ringSlots)
    return {
      variant: Math.max(1, Math.min(QUICK_EYE_MAX_VARIANT, Math.round(ctx.variant))),
      level,
      exposureMs: Math.max(exposureMsFor(level), ctx.minExposureMs),
      center,
      centerOptions,
      correctCenter,
      target: field.target,
      targetDir: field.targetDir,
      distractors: field.distractors,
      ringSlots: ctx.ringSlots,
      shownMs: null,
      phase: 'fixation',
      pickedCenter: null,
      pickedDirection: null,
      void: false,
      centerOnly: ctx.centerOnly,
    }
  },
  pendingMs(s) {
    if (s.phase === 'fixation') return FIXATION_MS
    if (s.phase === 'mask') return MASK_MS
    return null
  },
  advance(s) {
    if (s.phase === 'fixation') return { ...s, phase: 'stimulus' }
    if (s.phase === 'mask') return { ...s, phase: 'answerCenter' }
    return s
  },
  exposed(s, actualMs, frameMs, lenient) {
    if (s.phase !== 'stimulus') return s
    if (lenient && actualMs > 0) return { ...s, shownMs: actualMs, phase: 'mask' }
    // A trial whose exposure was not what it claims does not count. At a few frames even one frame
    // off is a large relative error, so up to 6 target frames the count must match exactly;
    // beyond that one frame either way is allowed.
    const want = Math.max(1, Math.round(s.exposureMs / frameMs))
    const got = Math.round(actualMs / frameMs)
    const ok = want <= 6 ? got === want : Math.abs(got - want) <= 1
    if (!ok) return { ...s, void: true, phase: 'done' }
    return { ...s, shownMs: actualMs, phase: 'mask' }
  },
  acceptsInput: (s) => s.phase === 'answerCenter' || s.phase === 'answerLocation',
  // The ladder step at the platform's shortest exposure: below it every level shows the same flash.
  maxLevel: (ctx) => quickEyeMaxLevel(ctx.minExposureMs),
  tap(s, index) {
    if (s.phase === 'answerCenter') {
      if (index < 0 || index > 1) return s
      return { ...s, pickedCenter: index, phase: s.target ? 'answerLocation' : 'done' }
    }
    if (s.phase === 'answerLocation') {
      if (index < 0 || index > 7) return s
      return { ...s, pickedDirection: index, phase: 'done' }
    }
    return s
  },
  // Answers are untimed; a stalled stimulus (the platform never reported) is the only way here.
  timeout: (s) => (s.phase === 'done' ? s : { ...s, void: true, phase: 'done' }),
  outcome(s) {
    if (s.phase !== 'done') return null
    if (s.void) return { correct: false, accuracy: 0, void: true }
    const centerOk = s.pickedCenter === s.correctCenter
    const placeOk = s.targetDir === null || s.pickedDirection === s.targetDir
    const correct = centerOk && placeOk
    return { correct, accuracy: correct ? 1 : centerOk || placeOk ? 0.5 : 0, shownMs: s.shownMs ?? s.exposureMs }
  },
  timeLimitMs: () => null,
  view(s) {
    const asking = s.phase === 'answerLocation' ? 'answerLocation' : 'answerCenter'
    const done = s.phase === 'done'
    // Off by one direction (around the circle): the reveal says "right next to it". Display only —
    // the outcome still needs the exact direction.
    const off = done && s.targetDir !== null && s.pickedDirection !== null ? Math.abs(s.pickedDirection - s.targetDir) % 8 : null
    return {
      kind: 'quickEye',
      phase: s.phase,
      variant: s.variant,
      place: quickEyePlace(s.variant, s.centerOnly),
      prompt:
        s.phase === 'fixation' || s.phase === 'stimulus' || s.phase === 'mask'
          ? { key: 'quickEye.watch' }
          : asking === 'answerLocation' || (done && s.target)
            ? { key: 'quickEye.where' }
            : { key: s.center.length === 2 ? 'quickEye.sameOrDifferent' : 'quickEye.what' },
      exposureMs: s.exposureMs,
      center: s.center,
      centerOptions: s.centerOptions,
      target: s.target,
      distractors: s.distractors,
      ringSlots: s.ringSlots,
      asksLocation: s.target !== null,
      ...(done
        ? {
            pickedCenter: s.pickedCenter ?? undefined,
            correctCenter: s.correctCenter,
            pickedDirection: s.pickedDirection ?? undefined,
            correctDirection: s.targetDir ?? undefined,
            nearMiss: off !== null && Math.min(off, 8 - off) === 1,
            void: s.void,
          }
        : s.phase === 'answerLocation'
          ? { pickedCenter: s.pickedCenter ?? undefined }
          : {}),
    }
  },
  mechanics(s) {
    // Every trial is drawn on the redesigned field: met once (silently in practice), it tells a
    // returning player the screen changed and recalibrates their start (useBrainRound).
    const tags: string[] = ['quickEye.clearView']
    if (s.target) tags.push('quickEye.periphery')
    if (s.distractors.length > 0) tags.push('quickEye.distractors')
    if (s.center.length === 2) tags.push('quickEye.sameDiff')
    else if (s.centerOptions[1]?.startsWith('square:') && Number(s.centerOptions[1].split(':')[1]) > 0) tags.push('quickEye.similar')
    return tags
  },
  solution(s) {
    if (s.phase === 'answerCenter') return s.targetDir === null ? [s.correctCenter] : [s.correctCenter, s.targetDir]
    if (s.phase === 'answerLocation') return s.targetDir === null ? null : [s.targetDir]
    return null
  },
  signature: (s) =>
    `qe:${s.variant}:${s.center.join('+')}:${s.target ? `${s.target.ring}.${s.target.slot}` : '-'}:${s.distractors.map((d) => `${d.ring}.${d.slot}`).join(',')}`,
}

/**
 * Quick Eye's progression between trials, kept in progress: the exposures actually shown and
 * whether each was answered right, for the last 24 valid trials.
 *
 * A variant is passed on either of two criteria (Ball 2002: difficulty rose only once a criterion
 * was met; the exposure then eases back three steps):
 *   - the staircase threshold — the geometric mean of the shown exposure at its reversal points
 *     (Levitt 1971), needing at least six of them — under the variant's bar with ≥75% of the last
 *     16 right;
 *   - enough evidence without reversals: the last 16 valid trials all shown at or under the bar
 *     with at least 14 right. A player at the platform's shortest flash makes no reversals (the
 *     staircase has nowhere further to go), and used to be stranded there however well they did.
 * The bars rise with the variant because divided- and selective-attention thresholds in older
 * adults run roughly 100-350ms against a mid-grey field and a luminance-matched mask; they live in
 * one table so they can be tuned to the players' medians after release. [product decision]
 */
export const QUICK_EYE_WINDOW = 24
const MIN_REVERSALS = 6
/** The evidence criterion: this many of the last `QUICK_EYE_HOLD_WINDOW` trials right, all at or under the bar. */
export const QUICK_EYE_HOLD_NEED = 14
export const QUICK_EYE_HOLD_WINDOW = 16

/** Bars per variant range, ms: V1 (the slow-start path and centre-only) 100, V2 167, V3-4 200, V5-9 250, V10+ 300. */
export const QUICK_EYE_BARS_MS: readonly { upTo: number; ms: number }[] = [
  { upTo: 1, ms: 100 },
  { upTo: 2, ms: 167 },
  { upTo: 4, ms: 200 },
  { upTo: 9, ms: 250 },
  { upTo: Infinity, ms: 300 },
]

export function advanceBarMs(variant: number): number {
  return (QUICK_EYE_BARS_MS.find((b) => variant <= b.upTo) ?? QUICK_EYE_BARS_MS[QUICK_EYE_BARS_MS.length - 1]).ms
}

/** The easiest ladder step at or under the variant's bar (V1 7, V2-4 5, V5-9 4, V10+ 3). */
export function quickEyeBarLevel(variant: number): number {
  const bar = advanceBarMs(variant)
  return QUICK_EYE_LADDER_MS.findIndex((ms) => ms <= bar)
}

/** Shown exposures within this of the bar count as under it (a measured 167.4 for a 167 bar). */
const BAR_SLACK_MS = 1

export function quickEyeThreshold(shownMs: readonly number[], ok: readonly boolean[]): number | null {
  const reversals: number[] = []
  for (let i = 1; i < ok.length; i++) if (ok[i] !== ok[i - 1]) reversals.push(shownMs[i])
  if (reversals.length < MIN_REVERSALS) return null
  return geomean(reversals)
}

function geomean(ms: readonly number[]): number {
  return Math.round(Math.exp(ms.reduce((a, x) => a + Math.log(Math.max(1, x)), 0) / ms.length))
}

export function quickEyeAdvance(
  variant: number,
  shownMs: readonly number[],
  ok: readonly boolean[],
): { advance: boolean; thresholdMs: number | null } {
  const ms = shownMs.slice(-QUICK_EYE_WINDOW)
  const rs = ok.slice(-QUICK_EYE_WINDOW)
  const bar = advanceBarMs(variant)
  if (rs.length >= QUICK_EYE_HOLD_WINDOW && variant < QUICK_EYE_MAX_VARIANT) {
    const lastMs = ms.slice(-QUICK_EYE_HOLD_WINDOW)
    const right = rs.slice(-QUICK_EYE_HOLD_WINDOW).filter(Boolean).length
    if (lastMs.every((x) => x <= bar + BAR_SLACK_MS) && right >= QUICK_EYE_HOLD_NEED) return { advance: true, thresholdMs: geomean(lastMs) }
  }
  const thresholdMs = quickEyeThreshold(ms, rs)
  if (thresholdMs === null || rs.length < 16) return { advance: false, thresholdMs }
  const accuracy = rs.slice(-16).filter(Boolean).length / 16
  return { advance: variant < QUICK_EYE_MAX_VARIANT && accuracy >= 0.75 && thresholdMs <= bar, thresholdMs }
}

/**
 * Progress toward the evidence criterion, for "hold top speed n/14": the trials at the end of the
 * window shown at or under the bar, in a row (`run`, at most 16), and how many of them were right
 * (`filled`). Once `filled` reaches 14 the criterion is met within two more trials at that speed.
 */
export function quickEyeHold(recentMs: readonly number[], recentOk: readonly boolean[] | string, variant: number): { filled: number; run: number } {
  const ok = typeof recentOk === 'string' ? recentOk.split('').map((c) => c === '1') : recentOk
  const bar = advanceBarMs(variant)
  let run = 0
  let filled = 0
  for (let i = recentMs.length - 1; i >= 0 && run < QUICK_EYE_HOLD_WINDOW && recentMs[i] <= bar + BAR_SLACK_MS; i--) {
    run++
    if (ok[i]) filled++
  }
  return { filled, run }
}
