import { createRateLimiter } from './rate-limiter'
import { createUsageQuota, createLocalStorageStore } from './usage-quota'
import { createRateLimitGuard, type RateLimitGuard } from './rate-limit-guard'
import { getCurrentTier, getTierConfig, getRateLimit } from './tier-config'

function createGuardInstance(): RateLimitGuard {
  const tier = getCurrentTier()
  const tierConfig = getTierConfig(tier)

  const rateLimiter = createRateLimiter({
    maxRequests: getRateLimit(tier, 'api_call').maxRequests,
    windowMs: getRateLimit(tier, 'api_call').windowMs,
  })

  const store = createLocalStorageStore()
  const usageQuota = createUsageQuota(tierConfig, store)

  // Reset daily counters on creation
  usageQuota.resetDailyIfNeeded()

  return createRateLimitGuard({ rateLimiter, usageQuota })
}

export const guard: RateLimitGuard = createGuardInstance()
