import { describe, it, expect } from 'vitest'
import {
  getTierConfig,
  getQuotaLimit,
  getRateLimit,
  getCurrentTier,
  TIER_CONFIGS,
} from '../tier-config'

describe('tier-config', () => {
  describe('TIER_CONFIGS', () => {
    it('should define free, pro, and enterprise tiers', () => {
      expect(TIER_CONFIGS).toHaveProperty('free')
      expect(TIER_CONFIGS).toHaveProperty('pro')
      expect(TIER_CONFIGS).toHaveProperty('enterprise')
    })

    it('free tier should have correct quota limits', () => {
      const free = TIER_CONFIGS.free
      expect(free.quotas.api_requests_daily).toBe(1_000)
      expect(free.quotas.storage_bytes).toBe(500 * 1024 * 1024) // 500MB
      expect(free.quotas.cards_total).toBe(5_000)
      expect(free.quotas.decks_total).toBe(50)
      expect(free.quotas.templates_total).toBe(20)
      expect(free.quotas.study_sessions_daily).toBe(100)
      expect(free.quotas.file_uploads_daily).toBe(50)
    })

    it('free tier should have correct rate limits', () => {
      const free = TIER_CONFIGS.free
      expect(free.rates.api_call).toEqual({ maxRequests: 60, windowMs: 60_000 })
      expect(free.rates.card_create).toEqual({ maxRequests: 30, windowMs: 60_000 })
      expect(free.rates.storage_upload).toEqual({ maxRequests: 10, windowMs: 60_000 })
      expect(free.rates.study_session_start).toEqual({ maxRequests: 10, windowMs: 60_000 })
      expect(free.rates.deck_create).toEqual({ maxRequests: 10, windowMs: 60_000 })
      expect(free.rates.bulk_card_create).toEqual({ maxRequests: 5, windowMs: 60_000 })
    })

    it('pro tier should have higher limits than free', () => {
      const free = TIER_CONFIGS.free
      const pro = TIER_CONFIGS.pro
      expect(pro.quotas.api_requests_daily).toBeGreaterThan(free.quotas.api_requests_daily)
      expect(pro.quotas.cards_total).toBeGreaterThan(free.quotas.cards_total)
      expect(pro.rates.api_call.maxRequests).toBeGreaterThan(free.rates.api_call.maxRequests)
    })

    it('enterprise tier should have highest limits', () => {
      const pro = TIER_CONFIGS.pro
      const ent = TIER_CONFIGS.enterprise
      expect(ent.quotas.api_requests_daily).toBeGreaterThan(pro.quotas.api_requests_daily)
      expect(ent.rates.api_call.maxRequests).toBeGreaterThan(pro.rates.api_call.maxRequests)
    })
  })

  describe('getTierConfig', () => {
    it('should return config for a valid tier', () => {
      const config = getTierConfig('free')
      expect(config).toBe(TIER_CONFIGS.free)
    })

    it('should return config for pro tier', () => {
      const config = getTierConfig('pro')
      expect(config).toBe(TIER_CONFIGS.pro)
    })

    it('should return config for enterprise tier', () => {
      const config = getTierConfig('enterprise')
      expect(config).toBe(TIER_CONFIGS.enterprise)
    })
  })

  describe('getQuotaLimit', () => {
    it('should return the quota limit for a resource', () => {
      expect(getQuotaLimit('free', 'cards_total')).toBe(5_000)
      expect(getQuotaLimit('free', 'decks_total')).toBe(50)
    })

    it('should return different limits per tier', () => {
      const freeLimit = getQuotaLimit('free', 'api_requests_daily')
      const proLimit = getQuotaLimit('pro', 'api_requests_daily')
      expect(proLimit).toBeGreaterThan(freeLimit)
    })
  })

  describe('getRateLimit', () => {
    it('should return rate limit config for an operation', () => {
      const rate = getRateLimit('free', 'api_call')
      expect(rate).toEqual({ maxRequests: 60, windowMs: 60_000 })
    })

    it('should return different rate limits per tier', () => {
      const freeRate = getRateLimit('free', 'api_call')
      const proRate = getRateLimit('pro', 'api_call')
      expect(proRate.maxRequests).toBeGreaterThan(freeRate.maxRequests)
    })
  })

  describe('getCurrentTier', () => {
    it('should return free as default tier', () => {
      expect(getCurrentTier()).toBe('free')
    })
  })
})
