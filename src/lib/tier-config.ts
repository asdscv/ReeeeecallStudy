export type ResourceType =
  | 'api_requests_daily'
  | 'storage_bytes'
  | 'cards_total'
  | 'decks_total'
  | 'templates_total'
  | 'study_sessions_daily'
  | 'file_uploads_daily'

export type OperationType =
  | 'api_call'
  | 'storage_upload'
  | 'study_session_start'
  | 'card_create'
  | 'deck_create'
  | 'bulk_card_create'

export type TierName = 'free' | 'pro' | 'enterprise'

export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

export interface TierConfig {
  quotas: Record<ResourceType, number>
  rates: Record<OperationType, RateLimitConfig>
}

const MB = 1024 * 1024
const GB = 1024 * MB
const MINUTE = 60_000

export const TIER_CONFIGS: Record<TierName, TierConfig> = {
  free: {
    quotas: {
      api_requests_daily: 1_000,
      storage_bytes: 500 * MB,
      cards_total: 5_000,
      decks_total: 50,
      templates_total: 20,
      study_sessions_daily: 100,
      file_uploads_daily: 50,
    },
    rates: {
      api_call: { maxRequests: 60, windowMs: MINUTE },
      card_create: { maxRequests: 30, windowMs: MINUTE },
      storage_upload: { maxRequests: 10, windowMs: MINUTE },
      study_session_start: { maxRequests: 10, windowMs: MINUTE },
      deck_create: { maxRequests: 10, windowMs: MINUTE },
      bulk_card_create: { maxRequests: 5, windowMs: MINUTE },
    },
  },
  pro: {
    quotas: {
      api_requests_daily: 10_000,
      storage_bytes: 5 * GB,
      cards_total: 50_000,
      decks_total: 500,
      templates_total: 100,
      study_sessions_daily: 1_000,
      file_uploads_daily: 500,
    },
    rates: {
      api_call: { maxRequests: 300, windowMs: MINUTE },
      card_create: { maxRequests: 120, windowMs: MINUTE },
      storage_upload: { maxRequests: 60, windowMs: MINUTE },
      study_session_start: { maxRequests: 60, windowMs: MINUTE },
      deck_create: { maxRequests: 30, windowMs: MINUTE },
      bulk_card_create: { maxRequests: 20, windowMs: MINUTE },
    },
  },
  enterprise: {
    quotas: {
      api_requests_daily: 100_000,
      storage_bytes: 50 * GB,
      cards_total: 500_000,
      decks_total: 5_000,
      templates_total: 1_000,
      study_sessions_daily: 10_000,
      file_uploads_daily: 5_000,
    },
    rates: {
      api_call: { maxRequests: 1_000, windowMs: MINUTE },
      card_create: { maxRequests: 500, windowMs: MINUTE },
      storage_upload: { maxRequests: 200, windowMs: MINUTE },
      study_session_start: { maxRequests: 200, windowMs: MINUTE },
      deck_create: { maxRequests: 100, windowMs: MINUTE },
      bulk_card_create: { maxRequests: 50, windowMs: MINUTE },
    },
  },
}

export function getTierConfig(tier: TierName): TierConfig {
  return TIER_CONFIGS[tier]
}

export function getQuotaLimit(tier: TierName, resource: ResourceType): number {
  return TIER_CONFIGS[tier].quotas[resource]
}

export function getRateLimit(tier: TierName, operation: OperationType): RateLimitConfig {
  return TIER_CONFIGS[tier].rates[operation]
}

export function getCurrentTier(): TierName {
  return 'free'
}
