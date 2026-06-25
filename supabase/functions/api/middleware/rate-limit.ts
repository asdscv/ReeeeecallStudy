import type { Context, Next } from 'hono'

// Shared rate limit (M1): a Postgres atomic fixed-window counter, so all edge
// isolates share one limit per user (the old in-memory Map was per-isolate, so
// fan-out across isolates multiplied the effective limit). The check runs via
// the service-role client already set on the context by the auth middleware.
//
// Fail-OPEN: if the DB check errors, allow the request. Rate limiting is an
// abuse guard, not a correctness gate — a transient DB blip must not 500 the API.

const MAX_REQUESTS = 60
const WINDOW_SECONDS = 60

export async function rateLimitMiddleware(c: Context, next: Next) {
  const userId = c.get('userId') as string | undefined
  if (!userId) {
    await next()
    return
  }

  const sb = c.get('supabase')
  try {
    const { data, error } = await sb.rpc('check_rate_limit', {
      p_key: userId,
      p_limit: MAX_REQUESTS,
      p_window_seconds: WINDOW_SECONDS,
    })

    if (error) {
      console.error('[rate-limit] check failed, failing open:', error.message)
      await next()
      return
    }

    if (data && data.allowed === false) {
      const retryAfter = Number(data.retry_after) || WINDOW_SECONDS
      c.header('Retry-After', String(retryAfter))
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `Too many requests. Please retry after ${retryAfter} seconds.`,
          },
        },
        429,
      )
    }
  } catch (e) {
    console.error('[rate-limit] error, failing open:', e)
  }

  await next()
}
