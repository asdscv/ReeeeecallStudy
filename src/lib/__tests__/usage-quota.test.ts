import { describe, it, expect, beforeEach } from 'vitest'
import { createUsageQuota, createMemoryStore, type UsageStore } from '../usage-quota'
import { getTierConfig } from '../tier-config'

describe('usage-quota', () => {
  let store: UsageStore

  beforeEach(() => {
    store = createMemoryStore()
  })

  describe('checkQuota', () => {
    it('should allow when under limit', () => {
      const quota = createUsageQuota(getTierConfig('free'), store)
      const result = quota.checkQuota('cards_total')
      expect(result.allowed).toBe(true)
      expect(result.current).toBe(0)
      expect(result.limit).toBe(5_000)
    })

    it('should deny when at limit', () => {
      const quota = createUsageQuota(getTierConfig('free'), store)
      quota.setUsage('decks_total', 50) // free limit
      const result = quota.checkQuota('decks_total')
      expect(result.allowed).toBe(false)
      expect(result.current).toBe(50)
      expect(result.limit).toBe(50)
      expect(result.message).toBeDefined()
    })

    it('should check incrementBy parameter', () => {
      const quota = createUsageQuota(getTierConfig('free'), store)
      quota.setUsage('cards_total', 4_999)
      // 1 more should be fine
      expect(quota.checkQuota('cards_total', 1).allowed).toBe(true)
      // 2 more would exceed
      expect(quota.checkQuota('cards_total', 2).allowed).toBe(false)
    })
  })

  describe('recordUsage', () => {
    it('should increment usage by default amount (1)', () => {
      const quota = createUsageQuota(getTierConfig('free'), store)
      quota.recordUsage('cards_total')
      const result = quota.checkQuota('cards_total')
      expect(result.current).toBe(1)
    })

    it('should increment by specified amount', () => {
      const quota = createUsageQuota(getTierConfig('free'), store)
      quota.recordUsage('storage_bytes', 1024)
      const result = quota.checkQuota('storage_bytes')
      expect(result.current).toBe(1024)
    })

    it('should accumulate usage', () => {
      const quota = createUsageQuota(getTierConfig('free'), store)
      quota.recordUsage('cards_total')
      quota.recordUsage('cards_total')
      quota.recordUsage('cards_total')
      expect(quota.checkQuota('cards_total').current).toBe(3)
    })
  })

  describe('setUsage', () => {
    it('should set usage to exact value', () => {
      const quota = createUsageQuota(getTierConfig('free'), store)
      quota.setUsage('cards_total', 100)
      expect(quota.checkQuota('cards_total').current).toBe(100)
    })

    it('should overwrite previous usage', () => {
      const quota = createUsageQuota(getTierConfig('free'), store)
      quota.setUsage('cards_total', 100)
      quota.setUsage('cards_total', 50)
      expect(quota.checkQuota('cards_total').current).toBe(50)
    })
  })

  describe('resetDailyIfNeeded', () => {
    it('should reset daily counters when date changes', () => {
      const quota = createUsageQuota(getTierConfig('free'), store, {
        now: () => new Date('2025-01-01T10:00:00Z').getTime(),
      })
      quota.recordUsage('api_requests_daily', 500)
      quota.recordUsage('study_sessions_daily', 10)
      quota.recordUsage('cards_total', 100) // not daily

      // Simulate next day
      const quotaNextDay = createUsageQuota(getTierConfig('free'), store, {
        now: () => new Date('2025-01-02T10:00:00Z').getTime(),
      })
      quotaNextDay.resetDailyIfNeeded()

      // Daily counters should reset
      expect(quotaNextDay.checkQuota('api_requests_daily').current).toBe(0)
      expect(quotaNextDay.checkQuota('study_sessions_daily').current).toBe(0)
      // Total counters should remain
      expect(quotaNextDay.checkQuota('cards_total').current).toBe(100)
    })

    it('should not reset if same day', () => {
      const quota = createUsageQuota(getTierConfig('free'), store, {
        now: () => new Date('2025-01-01T10:00:00Z').getTime(),
      })
      quota.recordUsage('api_requests_daily', 500)

      quota.resetDailyIfNeeded()
      expect(quota.checkQuota('api_requests_daily').current).toBe(500)
    })
  })

  describe('resetAll', () => {
    it('should reset all usage counters', () => {
      const quota = createUsageQuota(getTierConfig('free'), store)
      quota.recordUsage('cards_total', 100)
      quota.recordUsage('decks_total', 10)

      quota.resetAll()

      expect(quota.checkQuota('cards_total').current).toBe(0)
      expect(quota.checkQuota('decks_total').current).toBe(0)
    })
  })

  describe('memory store', () => {
    it('should persist data across quota instances using same store', () => {
      const quota1 = createUsageQuota(getTierConfig('free'), store)
      quota1.recordUsage('cards_total', 42)

      const quota2 = createUsageQuota(getTierConfig('free'), store)
      expect(quota2.checkQuota('cards_total').current).toBe(42)
    })
  })
})
