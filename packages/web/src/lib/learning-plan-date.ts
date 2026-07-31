// ─── Plan-date helpers (web) ─────────────────────────────────────────────────
//
// Thin re-export. The logic moved to `shared/lib/learning-plan-date` in the mobile-parity
// phase so both platforms compute the same plan date from the same code; keeping a second
// copy here is how the two would drift into disagreeing about which day it is.
export {
  currentPlanContext, localPlanDate, resolveTimezoneLabel, utcOffsetLabel,
} from '@reeeeecall/shared/lib/learning-plan-date'
export type { PlanDateContext } from '@reeeeecall/shared/lib/learning-plan-date'
