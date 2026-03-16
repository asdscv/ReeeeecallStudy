import type { RateLimiter } from './rate-limiter'
import type { UsageQuota } from './usage-quota'
import type { OperationType, ResourceType } from './tier-config'

export interface GuardCheckResult {
  allowed: boolean
  reason?: 'rate_limited' | 'quota_exceeded'
  message?: string
  retryAfterMs?: number
}

export interface RateLimitGuard {
  check(operation: OperationType, resource?: ResourceType, quotaAmount?: number): GuardCheckResult
  recordSuccess(resource: ResourceType, amount?: number): void
}

export interface RateLimitGuardOptions {
  rateLimiter: RateLimiter
  usageQuota: UsageQuota
}

export function createRateLimitGuard(options: RateLimitGuardOptions): RateLimitGuard {
  const { rateLimiter, usageQuota } = options

  return {
    check(operation: OperationType, resource?: ResourceType, quotaAmount?: number): GuardCheckResult {
      // Check rate limit first (cheaper, in-memory)
      const rateResult = rateLimiter.checkLimit(operation)
      if (!rateResult.allowed) {
        return {
          allowed: false,
          reason: 'rate_limited',
          message: 'errors:rateLimit.tooFast',
          retryAfterMs: rateResult.retryAfterMs,
        }
      }

      // Then check quota (if resource specified)
      if (resource) {
        const quotaResult = usageQuota.checkQuota(resource, quotaAmount)
        if (!quotaResult.allowed) {
          return {
            allowed: false,
            reason: 'quota_exceeded',
            message: quotaResult.message,
          }
        }
      }

      return { allowed: true }
    },

    recordSuccess(resource: ResourceType, amount?: number): void {
      usageQuota.recordUsage(resource, amount)
    },
  }
}
