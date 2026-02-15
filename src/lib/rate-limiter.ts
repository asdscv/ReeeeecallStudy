export interface RateLimitResult {
  allowed: boolean
  retryAfterMs?: number
  remaining: number
  limit: number
}

export interface RateLimiter {
  checkLimit(key: string): RateLimitResult
  peekLimit(key: string): RateLimitResult
  reset(key: string): void
  resetAll(): void
}

export interface RateLimiterOptions {
  maxRequests: number
  windowMs: number
  now?: () => number
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { maxRequests, windowMs, now = Date.now } = options
  const logs = new Map<string, number[]>()

  function getEntries(key: string): number[] {
    if (!logs.has(key)) {
      logs.set(key, [])
    }
    return logs.get(key)!
  }

  function pruneExpired(entries: number[], currentTime: number): number[] {
    const cutoff = currentTime - windowMs
    const pruned = entries.filter((t) => t > cutoff)
    return pruned
  }

  return {
    checkLimit(key: string): RateLimitResult {
      const currentTime = now()
      const entries = pruneExpired(getEntries(key), currentTime)
      logs.set(key, entries)

      if (entries.length >= maxRequests) {
        const oldest = entries[0]
        const retryAfterMs = oldest + windowMs - currentTime
        return {
          allowed: false,
          retryAfterMs: Math.max(0, retryAfterMs),
          remaining: 0,
          limit: maxRequests,
        }
      }

      entries.push(currentTime)
      const remaining = maxRequests - entries.length
      return { allowed: true, remaining, limit: maxRequests }
    },

    peekLimit(key: string): RateLimitResult {
      const currentTime = now()
      const entries = pruneExpired(getEntries(key), currentTime)

      const remaining = Math.max(0, maxRequests - entries.length)
      if (entries.length >= maxRequests) {
        const oldest = entries[0]
        const retryAfterMs = oldest + windowMs - currentTime
        return {
          allowed: false,
          retryAfterMs: Math.max(0, retryAfterMs),
          remaining: 0,
          limit: maxRequests,
        }
      }

      return { allowed: true, remaining, limit: maxRequests }
    },

    reset(key: string): void {
      logs.delete(key)
    },

    resetAll(): void {
      logs.clear()
    },
  }
}
