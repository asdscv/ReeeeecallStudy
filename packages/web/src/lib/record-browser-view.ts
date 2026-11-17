import { supabase } from './supabase'
import { logAnalyticsError } from './analytics-logger'

/** Context describes the collecting browser, never a claim of human identity. */
export async function recordBrowserView(kind: 'page' | 'content', payload: Record<string, unknown>): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('record_browser_view', {
      p_kind: kind,
      p_payload: {
        ...payload,
        hostname: window.location.hostname,
        user_agent: navigator.userAgent,
        automation_hint: navigator.webdriver === true,
      },
    })
    if (error) throw error
    return typeof data === 'string' ? data : null
  } catch (error) {
    logAnalyticsError('record_browser_view', error)
    return null
  }
}
