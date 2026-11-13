import { GROUP_RULES } from './rules'
import { QUICK_EYE_MAX_VARIANT, quickEyeVariant } from './games/quick-eye'
import { quickEyeTierStage } from './tiers'

/**
 * Quick Eye's stage helpers for the screens: how far the next speed step is, and what a new stage
 * brings. The staircase is hidden (EVIDENCE #25: no ms, no threshold), so the screens show it as
 * a goal a few answers long — "2 more right and it gets faster" — in the same units it moves in.
 */

/** Pips per speed level: a right answer fills one at base step size (+0.25), two while unsure (k = 2). */
export const QUICK_EYE_PIPS = 4

/**
 * The speed gauge for a level and step multiplier `k` (skill.ts stepMultiplier):
 * - shown: the speed level as displayed, 0-11 (Math.round, like the exposure ladder);
 * - pips: quarters of the current speed level already filled, 0-3;
 * - toNext: right answers in a row until the shown level rises (k = 2 counts double — honest copy);
 * - atTop: at the platform's shortest flash, where only "hold top speed" is left.
 */
export function quickEyeSpeedGauge(level: number, k: number, maxLevel: number): { shown: number; pips: number; toNext: number; atTop: boolean } {
  const up = GROUP_RULES.quickEye.up
  const rung = Math.round(level)
  const shown = Math.max(0, Math.min(11, rung))
  const pips = Math.max(0, Math.min(QUICK_EYE_PIPS - 1, Math.floor((level - (rung - 0.5)) / up + 1e-9)))
  const toNext = Math.max(1, Math.ceil((rung + 0.5 - level) / (up * Math.max(1, k)) - 1e-9))
  return { shown, pips, toNext, atTop: rung >= maxLevel }
}

/** What a new stage brings, as a `brain` key under `quickEye.knob.*` (null: nothing new on screen). */
export type QuickEyeKnob = 'wider' | 'ring2' | 'ring3' | 'crowd' | 'moreCrowd' | 'similar' | 'sameDiff'

/** The one new thing variant `to` brings over the one before it. */
export function quickEyeKnob(to: number, centerOnly = false): QuickEyeKnob | null {
  const v = Math.max(1, Math.min(QUICK_EYE_MAX_VARIANT, Math.round(to)))
  if (v <= 1) return null
  const now = quickEyeVariant(v)
  const before = quickEyeVariant(v - 1)
  if (now.sameDifferent && !before.sameDifferent) return 'sameDiff'
  if (now.similarity !== before.similarity) return 'similar'
  // The field changes are not on screen on the centre-only setting.
  if (centerOnly) return null
  if (now.distractors > 0 && before.distractors === 0) return 'crowd'
  if (now.distractors > before.distractors) return 'moreCrowd'
  if (now.rings.length > before.rings.length) return now.rings.length === 1 ? 'wider' : now.rings.length === 2 ? 'ring2' : 'ring3'
  return null
}

/** The stage number a player sees: the variant, or on the centre-only setting the centre task's stage. */
export function quickEyeStage(variant: number, centerOnly = false): number {
  return quickEyeTierStage(variant, centerOnly)
}
