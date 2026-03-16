import { describe, it, expect } from 'vitest'
import { createRateLimiter } from '../rate-limiter'

function makeClock(startMs = 0) {
  let current = startMs
  return {
    now: () => current,
    advance: (ms: number) => { current += ms },
  }
}

describe('rate-limiter', () => {
  describe('createRateLimiter', () => {
    it('should allow requests within limit', () => {
      const clock = makeClock()
      const limiter = createRateLimiter({
        maxRequests: 3,
        windowMs: 60_000,
        now: clock.now,
      })

      const r1 = limiter.checkLimit('user1')
      expect(r1.allowed).toBe(true)
      expect(r1.remaining).toBe(2)
      expect(r1.limit).toBe(3)

      const r2 = limiter.checkLimit('user1')
      expect(r2.allowed).toBe(true)
      expect(r2.remaining).toBe(1)

      const r3 = limiter.checkLimit('user1')
      expect(r3.allowed).toBe(true)
      expect(r3.remaining).toBe(0)
    })

    it('should deny requests over limit', () => {
      const clock = makeClock()
      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 60_000,
        now: clock.now,
      })

      limiter.checkLimit('user1')
      limiter.checkLimit('user1')

      const result = limiter.checkLimit('user1')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfterMs).toBeGreaterThan(0)
    })

    it('should allow requests after window expires', () => {
      const clock = makeClock()
      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 60_000,
        now: clock.now,
      })

      limiter.checkLimit('user1')
      limiter.checkLimit('user1')

      // Should be denied
      expect(limiter.checkLimit('user1').allowed).toBe(false)

      // Advance past window
      clock.advance(60_001)

      // Should be allowed again
      const result = limiter.checkLimit('user1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1)
    })

    it('should track keys independently', () => {
      const clock = makeClock()
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
        now: clock.now,
      })

      limiter.checkLimit('user1')
      expect(limiter.checkLimit('user1').allowed).toBe(false)

      // Different key should still be allowed
      expect(limiter.checkLimit('user2').allowed).toBe(true)
    })

    it('sliding window should expire old entries individually', () => {
      const clock = makeClock(0)
      const limiter = createRateLimiter({
        maxRequests: 2,
        windowMs: 1000,
        now: clock.now,
      })

      // Request at t=0
      limiter.checkLimit('user1')

      // Request at t=500
      clock.advance(500)
      limiter.checkLimit('user1')

      // At t=500, both are in window -> denied
      expect(limiter.checkLimit('user1').allowed).toBe(false)

      // At t=1001, first request expired, second still in window
      clock.advance(501)
      const result = limiter.checkLimit('user1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(0) // 2 in window now (t=500 and t=1001)
    })
  })

  describe('peekLimit', () => {
    it('should not consume a request', () => {
      const clock = makeClock()
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
        now: clock.now,
      })

      const peek = limiter.peekLimit('user1')
      expect(peek.allowed).toBe(true)
      expect(peek.remaining).toBe(1)

      // Still allowed because peek didn't consume
      const result = limiter.checkLimit('user1')
      expect(result.allowed).toBe(true)
    })
  })

  describe('reset', () => {
    it('should reset a specific key', () => {
      const clock = makeClock()
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
        now: clock.now,
      })

      limiter.checkLimit('user1')
      expect(limiter.checkLimit('user1').allowed).toBe(false)

      limiter.reset('user1')
      expect(limiter.checkLimit('user1').allowed).toBe(true)
    })
  })

  describe('resetAll', () => {
    it('should reset all keys', () => {
      const clock = makeClock()
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 60_000,
        now: clock.now,
      })

      limiter.checkLimit('user1')
      limiter.checkLimit('user2')

      limiter.resetAll()

      expect(limiter.checkLimit('user1').allowed).toBe(true)
      expect(limiter.checkLimit('user2').allowed).toBe(true)
    })
  })

  describe('retryAfterMs', () => {
    it('should calculate correct retry time', () => {
      const clock = makeClock(0)
      const limiter = createRateLimiter({
        maxRequests: 1,
        windowMs: 5000,
        now: clock.now,
      })

      limiter.checkLimit('user1')

      clock.advance(2000)
      const result = limiter.checkLimit('user1')
      expect(result.allowed).toBe(false)
      // oldest entry at t=0, window=5000, so retry after 5000-2000=3000
      expect(result.retryAfterMs).toBe(3000)
    })
  })
})
