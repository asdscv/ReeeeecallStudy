import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'
import type { BrainFx } from '@reeeeecall/shared/hooks/useBrainFx'
import type { BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { areHapticsEnabled } from '../../utils/haptics'

/**
 * The phone's answer to the web's game sounds: the same round events (useBrainFx), felt instead
 * of heard. Every buzz checks the app-wide vibration setting first (Settings, or the brain
 * settings sheet), exactly as the app's haptics wrapper does.
 *
 * - Android plays the light ticks (taps, flips, countdown) with its own haptic constants — crisp,
 *   where the vibrator feels buzzy — and the verdicts through the vibrator, which still buzzes when
 *   the system's touch feedback is off (the app has no sound, so a verdict must always be felt).
 * - Events of one moment are felt as one buzz, the strongest: a wrong answer that also costs a life
 *   is one Reject, not two. The tap that finishes a trial plays only the verdict, never its hit.
 * - Nothing buzzes for Quick Eye's flash, its mask or a Sequence playback: a buzz would blur the
 *   stimulus or tell the hand when to look. The engine sends only the silent 'stimulus' event while
 *   Quick Eye's display is measured; every other buzz is played within a tick of its event, so none
 *   can land in those frames.
 * - Quick Eye: its ready cue (the fixation starting, 500ms before the flash) is one light tick — the
 *   same every trial, so it says "now" without saying where; a stage reached is a success. A near
 *   miss and a faster step are not felt: the near miss is shown ("right next to it") rather than
 *   buzzed as a wrong, and a step comes every few answers — a buzz that often is noise.
 * - Buzzes keep ≥80ms apart; the notification-type ones (success, warning, error) ≥400ms.
 */
type Kind = 'hit' | 'flip' | 'tick' | 'ready' | 'go' | 'correct' | 'miss' | 'wrong' | 'lifeLost' | 'success'

const RANK: Record<Kind, number> = { hit: 1, flip: 1, tick: 1, ready: 1, go: 2, correct: 3, miss: 3, wrong: 4, success: 4, lifeLost: 5 }
/** The kinds iOS plays as a notification pattern (and Android as Confirm / Reject). */
const NOTIFICATION = new Set<Kind>(['miss', 'wrong', 'lifeLost', 'success'])
/** A verdict ends a trial; a hit inside the same moment is dropped. */
const VERDICT = new Set<Kind>(['correct', 'miss', 'wrong', 'lifeLost', 'success'])

const MIN_GAP_MS = 80
const NOTIFICATION_GAP_MS = 400
const HIT_VS_VERDICT_MS = 40

const IOS: Record<Kind, () => Promise<void>> = {
  hit: () => Haptics.selectionAsync(),
  flip: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  tick: () => Haptics.selectionAsync(),
  ready: () => Haptics.selectionAsync(),
  go: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  correct: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  miss: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  wrong: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  lifeLost: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
}

const ANDROID: Partial<Record<Kind, Haptics.AndroidHaptics>> = {
  hit: Haptics.AndroidHaptics.Virtual_Key,
  flip: Haptics.AndroidHaptics.Segment_Tick,
  tick: Haptics.AndroidHaptics.Clock_Tick,
  ready: Haptics.AndroidHaptics.Clock_Tick,
}

let pending: Kind | null = null
let pendingHit: Kind | null = null
let lastAt = 0
let lastNotificationAt = 0
let lastVerdictAt = 0

function play(kind: Kind) {
  if (!areHapticsEnabled()) return
  const now = Date.now()
  if (now - lastAt < MIN_GAP_MS) return
  if (NOTIFICATION.has(kind) && now - lastNotificationAt < NOTIFICATION_GAP_MS) return
  lastAt = now
  if (NOTIFICATION.has(kind)) lastNotificationAt = now
  const ios = IOS[kind]
  const constant = Platform.OS === 'android' ? ANDROID[kind] : undefined
  if (constant !== undefined) {
    // A binary whose expo-haptics predates the Android constants falls back to the iOS-style call.
    Haptics.performAndroidHapticsAsync(constant).catch(() => ios().catch(() => {}))
  } else {
    // Verdicts go through the vibrator on Android too: the haptic constants fall silent when the
    // system's touch feedback is off, and with no sound in the app the verdict must still be felt —
    // and feel like the settings switch's test buzz, which uses the same path.
    ios().catch(() => {})
  }
}

function buzz(kind: Kind) {
  if (kind === 'hit' || kind === 'flip') {
    // One macrotask later, so a verdict from the same tap (same render) can claim the moment.
    if (pendingHit === null) {
      pendingHit = kind
      setTimeout(() => {
        const hit = pendingHit
        pendingHit = null
        if (hit && pending === null && Date.now() - lastVerdictAt > HIT_VS_VERDICT_MS) play(hit)
      }, 0)
    }
    return
  }
  // Asked for, even if the gap rules then skip it: the moment still belongs to the verdict.
  if (VERDICT.has(kind)) lastVerdictAt = Date.now()
  if (pending === null) {
    pending = kind
    // Same tick = same moment: the round's effects for one render all run before this resolves.
    void Promise.resolve().then(() => {
      const k = pending
      pending = null
      if (k) play(k)
    })
  } else if (RANK[kind] > RANK[pending]) {
    pending = kind
  }
}

export function brainHaptic(fx: BrainFx, game?: BrainGameId) {
  switch (fx.kind) {
    case 'hit':
    case 'select':
      return buzz('hit')
    case 'flip':
      return buzz('flip')
    case 'correct':
      return buzz('correct')
    case 'wrong':
      return buzz('wrong')
    case 'miss':
      return buzz('miss')
    case 'lifeLost':
      return buzz('lifeLost')
    case 'fixation':
      return buzz('ready')
    case 'stageUp':
      return buzz('success')
    case 'levelUp':
      // Quick Eye's flash gets one step shorter every few right answers: not a moment to celebrate.
      return game === 'quickEye' ? undefined : buzz('success')
    case 'newBest':
      return buzz('success')
    default:
      // reveal, flash, stimulus, nearMiss, void, roundEnd: nothing to feel.
      return
  }
}

/** 3 · 2 · 1 are light ticks, "Go" a firmer click. */
export function countdownHaptic(n: number) {
  buzz(n > 0 ? 'tick' : 'go')
}

/** The results screen's moments outside a round (a personal best, a finished session). */
export function celebrateHaptic() {
  buzz('success')
}
