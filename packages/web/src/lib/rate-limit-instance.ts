import { createRateLimiter } from './rate-limiter'
import { createUsageQuota, createLocalStorageStore } from './usage-quota'
import { createRateLimitGuard, type RateLimitGuard } from './rate-limit-guard'
import { getCurrentTier, getTierConfig, getRateLimit } from './tier-config'

let _guard: RateLimitGuard | null = null
let _guardTier: string | null = null

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

  _guardTier = tier
  return createRateLimitGuard({ rateLimiter, usageQuota })
}

/** Returns the guard, recreating it if the tier has changed. */
export function getGuard(): RateLimitGuard {
  const tier = getCurrentTier()
  if (!_guard || _guardTier !== tier) {
    _guard = createGuardInstance()
  }
  return _guard
}

// Backwards-compatible export — proxies to tier-aware getGuard()
export const guard: RateLimitGuard = {
  check(...args) {
    return getGuard().check(...args)
  },
  recordSuccess(...args) {
    return getGuard().recordSuccess(...args)
  },
}
