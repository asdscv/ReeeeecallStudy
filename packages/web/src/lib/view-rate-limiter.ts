import { createRateLimiter } from './rate-limiter'

/**
 * Rate limiter for content view recording: 10 requests per minute.
 * Reuses the existing createRateLimiter pattern.
 */
export const viewRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
})
