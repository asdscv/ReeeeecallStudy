import { useEffect } from 'react'
import { aiHubBus, aiHubAnalyticsEvent } from '@reeeeecall/shared/lib/ai/hub/events'
import { useTrackEvent } from './useTrackEvent'

/**
 * Pipes the AI 학습 event bus into analytics.
 *
 * The emitters (nav submenu, hub tiles, the "AI로 만들기" buttons) know nothing about
 * analytics, which is what lets a new AI surface be one `.register()` call. This is the
 * subscriber that makes the bus pay for itself. The bot filter, opt-out check and rate
 * limit stay in `useTrackEvent` — none of it is repeated here.
 *
 * Mount it exactly once (Layout does): a second mount would double-count every event.
 */
export function useAiHubEventBridge() {
  const trackEvent = useTrackEvent()

  useEffect(() => aiHubBus.onAny((event) => trackEvent(aiHubAnalyticsEvent(event))), [trackEvent])
}
