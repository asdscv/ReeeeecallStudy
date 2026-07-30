// Display-only card-limit helpers. They live outside the component file so PlanSelector
// exports components exclusively (fast refresh) and so non-UI callers do not import a
// React module for a number.
// A card_limit at or above this sentinel means "unlimited" for DISPLAY only. As of
// mig 148 NO subscription plan is unlimited (the top plan caps at 100,000); this now
// only collapses to "무제한 / Unlimited" for admins, whose effective limit is 2e9
// (mig 139). Never special-case this server-side.
export const UNLIMITED_CARD_LIMIT = 1_000_000_000 // 1e9

export function isUnlimitedCardLimit(limit: number | null | undefined): boolean {
  return limit != null && limit >= UNLIMITED_CARD_LIMIT
}
