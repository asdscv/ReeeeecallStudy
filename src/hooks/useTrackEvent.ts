import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { isBot } from '../lib/bot-detection'
import { validateEvent, type AnalyticsEvent } from '../lib/analytics-events'
import { viewRateLimiter } from '../lib/view-rate-limiter'
import { normalizePagePath } from '../lib/page-tracking'
import { getAnalyticsSessionId } from '../lib/analytics-session'
import { logAnalyticsError } from '../lib/analytics-logger'

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
    const sessionId = getAnalyticsSessionId()
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
      .catch((e) => logAnalyticsError('record_analytics_event', e))
  }, [])
}
