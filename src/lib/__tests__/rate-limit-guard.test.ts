import { describe, it, expect } from 'vitest'
import { createRateLimitGuard } from '../rate-limit-guard'
import { createRateLimiter } from '../rate-limiter'
import { createUsageQuota, createMemoryStore } from '../usage-quota'
import { getTierConfig } from '../tier-config'

describe('rate-limit-guard', () => {
  function makeGuard(opts?: { maxRequests?: number }) {
    const clock = { current: 0 }
    const now = () => clock.current

    const rateLimiter = createRateLimiter({
      maxRequests: opts?.maxRequests ?? 5,
      windowMs: 60_000,
      now,
    })

    const store = createMemoryStore()
    const usageQuota = createUsageQuota(getTierConfig('free'), store, { now })

    const guard = createRateLimitGuard({ rateLimiter, usageQuota })

    return { guard, clock, store, usageQuota }
  }

  describe('check', () => {
    it('should allow when both rate limit and quota are ok', () => {
      const { guard } = makeGuard()
      const result = guard.check('card_create', 'cards_total')
      expect(result.allowed).toBe(true)
    })

    it('should deny when rate limited', () => {
      const { guard } = makeGuard({ maxRequests: 1 })

      // First: allowed
      expect(guard.check('card_create').allowed).toBe(true)

      // Second: rate limited
      const result = guard.check('card_create')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('rate_limited')
      expect(result.retryAfterMs).toBeGreaterThan(0)
    })

    it('should deny when quota exceeded', () => {
      const { guard, usageQuota } = makeGuard()
      usageQuota.setUsage('decks_total', 50) // free limit

      const result = guard.check('deck_create', 'decks_total')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('quota_exceeded')
      expect(result.message).toBeDefined()
    })

    it('should check rate limit before quota (cheaper check first)', () => {
      const { guard, usageQuota } = makeGuard({ maxRequests: 1 })
      usageQuota.setUsage('decks_total', 50) // also at quota limit

      // Use up rate limit
      guard.check('deck_create', 'decks_total')

      // Should report rate limited, not quota exceeded
      const result = guard.check('deck_create', 'decks_total')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('rate_limited')
    })

    it('should work without resource (rate limit only)', () => {
      const { guard } = makeGuard()
      const result = guard.check('api_call')
      expect(result.allowed).toBe(true)
    })

    it('should pass quotaAmount to quota check', () => {
      const { guard, usageQuota } = makeGuard()
      usageQuota.setUsage('cards_total', 4_999)

      // 1 more should be fine
      expect(guard.check('card_create', 'cards_total', 1).allowed).toBe(true)

      // but 2 more would exceed
      expect(guard.check('card_create', 'cards_total', 2).allowed).toBe(false)
    })
  })

  describe('recordSuccess', () => {
    it('should increment quota usage', () => {
      const { guard, usageQuota } = makeGuard()
      guard.recordSuccess('cards_total')
      expect(usageQuota.checkQuota('cards_total').current).toBe(1)
    })

    it('should increment by specified amount', () => {
      const { guard, usageQuota } = makeGuard()
      guard.recordSuccess('cards_total', 5)
      expect(usageQuota.checkQuota('cards_total').current).toBe(5)
    })
  })
})
