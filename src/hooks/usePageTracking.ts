import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isBot } from '../lib/bot-detection'
import { normalizePagePath, shouldTrackPage } from '../lib/page-tracking'
import { parseUtmParams } from '../lib/utm'
import { getDeviceType } from '../lib/device-info'
import { categorizeReferrer } from '../lib/referrer'
import { viewRateLimiter } from '../lib/view-rate-limiter'

function getSessionId(): string {
  const KEY = 'page_view_session'
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
 * Track page views on route changes.
 * Should be called once in the App root component.
 */
export function usePageTracking() {
  const location = useLocation()
  const prevPathRef = useRef<string>('')

  useEffect(() => {
    if (isBot(navigator.userAgent)) return

    const path = normalizePagePath(location.pathname)
    if (!shouldTrackPage(path)) return

    // Skip if same path (e.g. query param change only)
    if (path === prevPathRef.current) return
    prevPathRef.current = path

    // Rate limit page view recording
    if (!viewRateLimiter.checkLimit('page_view').allowed) return

    const sessionId = getSessionId()
    const utm = parseUtmParams(location.search)
    const deviceType = getDeviceType(navigator.userAgent)
    const ownDomain = window.location.hostname
    const referrerInfo = categorizeReferrer(document.referrer, ownDomain)

    supabase
      .rpc('record_page_view', {
        p_page_path: path,
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
        p_viewport_width: window.innerWidth,
      })
      .then(() => {})
      .catch(() => {})
  }, [location.pathname, location.search])
}
