import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { isBot } from '../lib/bot-detection'
import { validateEvent, type AnalyticsEvent } from '../lib/analytics-events'
import { viewRateLimiter } from '../lib/view-rate-limiter'
import { normalizePagePath } from '../lib/page-tracking'

function getSessionId(): string {
  const KEY = 'analytics_event_session'
  try {
    let id = sessionStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(KEY, id)
    }
    return id
  } catch {
    // Private browsing or storage disabled
    return crypto.randomUUID()
  }
}

/**
 * Returns a function to track custom analytics events.
 * Usage: const trackEvent = useTrackEvent()
 *        trackEvent({ category: 'content', action: 'share', label: 'twitter' })
 */
export function useTrackEvent() {
  return useCallback((event: AnalyticsEvent) => {
    if (isBot(navigator.userAgent)) return

    const result = validateEvent(event)
    if (!result.valid || !result.event) return

    // Rate limit event tracking
    if (!viewRateLimiter.checkLimit('analytics_event').allowed) return

    const { category, action, label, value } = result.event
    const sessionId = getSessionId()
    const pagePath = normalizePagePath(window.location.pathname)

    supabase
      .rpc('record_analytics_event', {
        p_category: category,
        p_action: action,
        p_label: label ?? null,
        p_value: value ?? null,
        p_page_path: pagePath,
        p_session_id: sessionId,
      })
      .then(() => {})
      .catch(() => {})
  }, [])
}
