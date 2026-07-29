// Analytics opt-out (GDPR/ePrivacy). Client-side telemetry (page views, content views,
// custom events) is initiated by the browser, so honoring an opt-out is a client gate:
// when the user opts out, the tracking hooks short-circuit BEFORE the RPC fires — nothing
// is sent. Stored as a local preference (per browser/profile on this device) so it needs
// no account round-trip and works pre-auth. Default = tracking ON (opt-out model), matching
// the prior behavior; a user must explicitly opt out.
const OPT_OUT_KEY = 'reeeeecall-analytics-optout'

export function isAnalyticsOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1'
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
}
