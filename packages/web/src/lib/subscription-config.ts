// ============================================================
// Subscription Plan Configuration
// ============================================================
// Single source of truth for plan features & limits.
// Quota values (maxDecks, maxCards) are derived from tier-config
// to avoid duplication.
// ============================================================

import { type TierName, TIER_CONFIGS } from './tier-config'

export type PlanName = TierName  // 'free' | 'pro' | 'enterprise'

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'none'

export interface PlanFeatures {
  maxSessions: number
  maxDecks: number
  maxCards: number
  // Add new feature limits here as needed
}

export interface PlanInfo {
  name: PlanName
  label: string
  features: PlanFeatures
}

// Session limits per plan (only source — DB mirrors these in register_session RPC)
const SESSION_LIMITS: Record<PlanName, number> = {
  free: 1,
  pro: 3,
  enterprise: 5,
}

function buildPlanInfo(name: PlanName, label: string): PlanInfo {
  const quotas = TIER_CONFIGS[name].quotas
  return {
    name,
    label,
    features: {
      maxSessions: SESSION_LIMITS[name],
      maxDecks: quotas.decks_total,
      maxCards: quotas.cards_total,
    },
  }
}

export const PLANS: Record<PlanName, PlanInfo> = {
  free: buildPlanInfo('free', 'Free'),
  pro: buildPlanInfo('pro', 'Pro'),
  enterprise: buildPlanInfo('enterprise', 'Enterprise'),
}

export function getPlanFeatures(plan: PlanName): PlanFeatures {
  return PLANS[plan].features
}

export function getPlanInfo(plan: PlanName): PlanInfo {
  return PLANS[plan]
}
