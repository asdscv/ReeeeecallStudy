import { useEffect } from 'react'
import { aiHubAnalyticsEvent, aiHubBus } from '@reeeeecall/shared/lib/ai/hub/events'
import { getMobileSupabase } from '../adapters'

// analytics_events.page_path is a URL on web. The app has no URL, and a funnel that cannot tell
// an app tap from a browser click is not worth recording, so every mobile row is marked here.
const MOBILE_PAGE_PATH = 'mobile'

/**
 * Ships AI 학습 bus events to `record_analytics_event`.
 *
 * The mobile app had no event telemetry at all — every funnel question about generation, quiz or
 * the learning plan could only be answered from web rows, which is the platform where the feature
 * is used least. Subscribing to the bus rather than instrumenting call sites means the answer
 * covers surfaces added later without another edit here.
 *
 * `aiHubAnalyticsEvent` is shared with the web bridge on purpose: two hand-written mappings would
 * report one funnel under two names within a release.
 */
export function useAiHubEventBridge(): void {
  useEffect(() => {
    return aiHubBus.onAny((event) => {
      const { category, action, label } = aiHubAnalyticsEvent(event)
      // Fire-and-forget. Telemetry that can fail a navigation is worse than no telemetry.
      Promise.resolve(
        getMobileSupabase().rpc('record_analytics_event', {
          p_category: category,
          p_action: action,
          p_label: label ?? null,
          p_value: null,
          p_page_path: MOBILE_PAGE_PATH,
          p_session_id: null,
        }),
      ).catch(() => {})
    })
  }, [])
}
