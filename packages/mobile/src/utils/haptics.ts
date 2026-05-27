import * as Haptics from 'expo-haptics'

/**
 * Centralized, semantic haptics.
 *
 * Call sites express *intent* (tap / success / error …), not the underlying
 * Expo primitive — so the feel can be retuned, or haptics globally disabled
 * (future Settings toggle / reduced-haptics a11y), in this one file without
 * touching screens. All calls are fire-and-forget and swallow errors on
 * devices/simulators without a haptic engine.
 */
let enabled = true

export function setHapticsEnabled(value: boolean): void {
  enabled = value
}

export function areHapticsEnabled(): boolean {
  return enabled
}

function run(fn: () => Promise<unknown>): void {
  if (!enabled) return
  fn().catch(() => {})
}

export const haptics = {
  /** Light tap — button / list-row press. */
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Medium impact — committing an action (flip, rate). */
  impact: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Heavy impact — significant / destructive action. */
  heavy: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  /** Selection tick — crossing a swipe threshold / changing selection. */
  selection: () => run(() => Haptics.selectionAsync()),
  /** Success — correct answer, session complete, save succeeded. */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Warning — undo, partial recall ("hard"). */
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** Error — failed recall, action error. */
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
}
