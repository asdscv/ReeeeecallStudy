// ============================================================
// Subscription Plan Configuration
// ============================================================
// Single source of truth for plan features & limits.
// To add a new plan: add to PlanName union + PLANS record.
// To add a new feature: add to PlanFeatures interface + each plan.
// ============================================================

import type { TierName } from './tier-config'

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

export const PLANS: Record<PlanName, PlanInfo> = {
  free: {
    name: 'free',
    label: 'Free',
    features: {
      maxSessions: 1,
      maxDecks: 5,
      maxCards: 3_000,
    },
  },
  pro: {
    name: 'pro',
    label: 'Pro',
    features: {
      maxSessions: 3,
      maxDecks: 500,
      maxCards: 50_000,
    },
  },
  enterprise: {
    name: 'enterprise',
    label: 'Enterprise',
    features: {
      maxSessions: 5,
      maxDecks: 5_000,
      maxCards: 500_000,
    },
  },
}

export function getPlanFeatures(plan: PlanName): PlanFeatures {
  return PLANS[plan].features
}

export function getPlanInfo(plan: PlanName): PlanInfo {
  return PLANS[plan]
}
