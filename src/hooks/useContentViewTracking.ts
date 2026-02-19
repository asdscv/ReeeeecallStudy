import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { isBot, isValidViewDuration } from '../lib/bot-detection'
import { createViewDedupTracker } from '../lib/view-dedup'
import { viewRateLimiter } from '../lib/view-rate-limiter'
import { parseUtmParams } from '../lib/utm'
import { getDeviceType } from '../lib/device-info'
import { categorizeReferrer } from '../lib/referrer'
import { getAnalyticsSessionId } from '../lib/analytics-session'
import { logAnalyticsError } from '../lib/analytics-logger'
import { useScrollDepthTracking } from './useScrollDepthTracking'

// Module-level tracker persists across re-renders within same page lifecycle
const viewTracker = createViewDedupTracker()

export function useContentViewTracking(contentId: string | undefined) {
  const viewIdRef = useRef<string | null>(null)
  const startRef = useRef<number>(0)
  const scrollDepthRef = useScrollDepthTracking()

  useEffect(() => {
    if (!contentId) return

    // Bot filtering
    if (isBot(navigator.userAgent)) return

    const sessionId = getAnalyticsSessionId()
    startRef.current = Date.now()

    // Capture UTM parameters from current URL
    const utm = parseUtmParams(window.location.search)

    // Capture device info
    const deviceType = getDeviceType(navigator.userAgent)
    const viewportWidth = window.innerWidth

    // Client-side referrer categorization with own domain detection
    const ownDomain = window.location.hostname
    const referrerInfo = categorizeReferrer(document.referrer, ownDomain)

    // Dedup on refresh — restore existing viewId if already recorded
    if (viewTracker.hasViewed(contentId)) {
      viewIdRef.current = viewTracker.getExistingViewId(contentId) ?? null
    } else {
      viewIdRef.current = null

      // Rate limit check
      if (!viewRateLimiter.checkLimit('content_view').allowed) return

      supabase
        .rpc('record_content_view', {
          p_content_id: contentId,
          p_session_id: sessionId,
          p_referrer: document.referrer || null,
          p_referrer_domain: referrerInfo.domain || null,
          p_referrer_category: referrerInfo.category,
          p_utm_source: utm.utm_source ?? null,
          p_utm_medium: utm.utm_medium ?? null,
          p_utm_campaign: utm.utm_campaign ?? null,
          p_utm_term: utm.utm_term ?? null,
          p_utm_content: utm.utm_content ?? null,
          p_device_type: deviceType,
          p_viewport_width: viewportWidth,
        })
        .then(
          ({ data }) => {
            if (typeof data === 'string' && data.length > 0) {
              viewIdRef.current = data
              viewTracker.markViewed(contentId, data)
            }
          },
          (e: unknown) => logAnalyticsError('record_content_view', e),
        )
    }

    const sendDuration = () => {
      const viewId = viewIdRef.current
      const elapsed = Date.now() - startRef.current

      // Minimum 2s duration filter + client-side cap at 1h
      if (!viewId || !isValidViewDuration(elapsed)) return

      const cappedDuration = Math.min(elapsed, 3600000)
      const scrollDepth = scrollDepthRef.current

      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/update_content_view_duration`
      const body = JSON.stringify({
        p_view_id: viewId,
        p_duration_ms: cappedDuration,
        p_scroll_depth: scrollDepth,
      })

      // Always use fetch with keepalive — apikey in header only (not URL)
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body,
        keepalive: true,
      }).catch((e) => logAnalyticsError('update_content_view_duration', e))
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') sendDuration()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      sendDuration()
      // Clear dedup for this content on unmount so re-navigation creates new view
      viewTracker.clearView(contentId)
    }
  }, [contentId])
}
