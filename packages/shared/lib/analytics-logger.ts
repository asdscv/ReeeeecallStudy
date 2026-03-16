/**
 * Log analytics errors in development only.
 * In production, errors are silently ignored (same as before).
 * Future: plug in Sentry or other error tracking here.
 */
export function logAnalyticsError(context: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.warn('[Analytics]', context, error)
  }
}
