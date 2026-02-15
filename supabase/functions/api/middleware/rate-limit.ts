import type { Context, Next } from 'hono'

interface RateLimitEntry {
  timestamps: number[]
}

const MAX_REQUESTS = 60
const WINDOW_MS = 60_000

const store = new Map<string, RateLimitEntry>()

function cleanupExpired(entry: RateLimitEntry, now: number): number[] {
  const cutoff = now - WINDOW_MS
  return entry.timestamps.filter((t) => t > cutoff)
}

export async function rateLimitMiddleware(c: Context, next: Next) {
  const userId = c.get('userId') as string | undefined
  if (!userId) {
    await next()
    return
  }

  const now = Date.now()
  let entry = store.get(userId)

  if (!entry) {
    entry = { timestamps: [] }
    store.set(userId, entry)
  }

  entry.timestamps = cleanupExpired(entry, now)

  if (entry.timestamps.length >= MAX_REQUESTS) {
    const oldest = entry.timestamps[0]
    const retryAfterSec = Math.ceil((oldest + WINDOW_MS - now) / 1000)

    c.header('Retry-After', String(retryAfterSec))
    return c.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Please retry after ${retryAfterSec} seconds.`,
        },
      },
      429,
    )
  }

  entry.timestamps.push(now)
  await next()
}
