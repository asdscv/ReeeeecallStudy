/**
 * Log analytics errors in development only.
 * In production, errors are silently ignored (same as before).
 * Compatible with both Vite (web) and Hermes (React Native).
 */

declare const __DEV__: boolean | undefined

export function logAnalyticsError(context: string, error: unknown): void {
  const isDev = typeof __DEV__ !== 'undefined'
    ? __DEV__
    : (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development')

  if (isDev) {
    console.warn('[Analytics]', context, error)
  }
}
