import i18next from 'i18next'
import type { RateLimiter } from './rate-limiter'
import { RESOURCE_LABELS, type UsageQuota } from './usage-quota'
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
          // Interpolate the message HERE: it propagates to the UI as a plain
          // string (the display calls t(error) with no values), so the
          // {{resource}}/{{current}}/{{limit}} placeholders must be resolved now
          // or they leak raw to the user.
          return {
            allowed: false,
            reason: 'quota_exceeded',
            message: i18next.t(quotaResult.message ?? 'errors:quota.limitReached', {
              resource: i18next.t(RESOURCE_LABELS[resource]),
              current: quotaResult.current,
              limit: quotaResult.limit,
            }),
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
