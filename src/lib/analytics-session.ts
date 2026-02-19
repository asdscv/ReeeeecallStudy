const SESSION_KEY = 'analytics_session'

/**
 * Get a unified analytics session ID shared across all tracking hooks.
 * Creates one on first call per browser session.
 */
export function getAnalyticsSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    // Private browsing or storage disabled
    return crypto.randomUUID()
  }
}
