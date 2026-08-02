// ─── Which study modes actually move the schedule ────────────────────────────
//
// Exactly one does. `study-store.rateCard` computes SRS state only for `srs` and sends
// `p_new_srs: null` for everything else, so cramming, sequential review, random, sequential and
// by-date all write a study LOG and leave `interval_days` / `next_review_at` untouched.
//
// That is a deliberate design — cramming exists precisely so an exam-eve session does not wreck
// months of spacing — but it was never SAID anywhere. A learner could spend a day cramming 500
// cards and find tomorrow's plan completely unchanged, with nothing on any screen explaining
// why. The daily plan reads `next_review_at`, so from its point of view that day did not happen.
//
// This lives here rather than inline in the store because the disclosure has to appear where the
// learner meets it, and copies of `mode === 'srs'` are how the fact and the behaviour drift
// apart. Read today by the store (which decides whether to send an SRS payload) and by the mode
// breakdown on BOTH history screens (which decides whether to warn). The goal form and the plan
// state the same thing in prose rather than through this predicate, because they are talking
// about the plan as a whole rather than about one mode.
import type { StudyMode } from '../types/database'

/**
 * Does finishing a card in this mode reschedule it?
 *
 * The single source for that question. `study-store` decides whether to send an SRS payload with
 * it, and the UI decides whether to warn with it, so the label can never contradict the write.
 */
export function modeFeedsSrsSchedule(mode: StudyMode | string | null | undefined): boolean {
  return mode === 'srs'
}
