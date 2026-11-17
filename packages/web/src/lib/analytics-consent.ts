// Analytics opt-out (GDPR/ePrivacy). Client-side telemetry (page views, content views,
// custom events) is initiated by the browser, so honoring an opt-out is a client gate:
// when the user opts out, the tracking hooks short-circuit BEFORE the RPC fires — nothing
// is sent. Stored as a local preference (per browser/profile on this device) so it needs
// no account round-trip and works pre-auth. Default = tracking ON (opt-out model), matching
// the prior behavior; a user must explicitly opt out.
const OPT_OUT_KEY = 'reeeeecall-analytics-optout'

export function isAnalyticsOptedOut(): boolean {
  try {
    const optedOut = localStorage.getItem(OPT_OUT_KEY) === '1' || navigator.doNotTrack === '1'
      || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
    syncEdgePreference(optedOut)
    return optedOut
  } catch {
    return false // storage blocked → fall back to prior (tracking on) behavior
  }
}

export function setAnalyticsOptOut(optOut: boolean): void {
  try {
    if (optOut) localStorage.setItem(OPT_OUT_KEY, '1')
    else localStorage.removeItem(OPT_OUT_KEY)
  } catch {
    /* storage blocked → nothing to persist */
  }
  syncEdgePreference(optOut)
}

function syncEdgePreference(optOut: boolean): void {
  document.cookie = `reklue_analytics_opt_out=${optOut ? '1' : ''}; Path=/; SameSite=Lax; Max-Age=${optOut ? 31536000 : 0}${location.protocol === 'https:' ? '; Secure' : ''}`
}
