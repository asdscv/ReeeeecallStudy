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
      cards_total: 3_000,
      decks_total: 5,
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
  return TIER_CONFIGS[tier] ?? TIER_CONFIGS.free
}

export function getQuotaLimit(tier: TierName, resource: ResourceType): number {
  return (TIER_CONFIGS[tier] ?? TIER_CONFIGS.free).quotas[resource]
}

export function getRateLimit(tier: TierName, operation: OperationType): RateLimitConfig {
  return (TIER_CONFIGS[tier] ?? TIER_CONFIGS.free).rates[operation]
}

// Module-level tier override — set by subscription store on login.
// Avoids circular imports between tier-config and subscription-store.
let _currentTier: TierName = 'free'

/**
 * 서버가 정한 한도를 덮어씁니다.
 *
 * 이 파일의 숫자들은 **기본값**입니다. 진짜 한도는 서버에 있고(`plan_entitlements` /
 * 구독 스냅샷), `get_my_entitlements()` 한 번으로 옵니다. 로그인 뒤 그 값을 여기에 부어 두면
 * 화면과 가드가 서버와 같은 숫자를 씁니다 — 값을 바꾸는 데 앱 배포가 필요 없어집니다.
 *
 * 이 주입이 없던 동안 무료 덱 한도가 코드에 5 로 적혀 있었고, 실제로 32개를 가진 계정이
 * 프로덕션에 있었습니다. 숫자가 두 곳에 살면 반드시 갈라집니다.
 */
export function applyServerQuotas(quotas: Partial<Record<ResourceType, number>>): void {
  for (const tier of Object.keys(TIER_CONFIGS) as TierName[]) {
    for (const [resource, value] of Object.entries(quotas)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        TIER_CONFIGS[tier].quotas[resource as ResourceType] = value
      }
    }
  }
}

export function setCurrentTier(tier: TierName): void {
  _currentTier = TIER_CONFIGS[tier] ? tier : 'free'
}

export function getCurrentTier(): TierName {
  return _currentTier
}
