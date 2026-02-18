import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

function getSessionId(): string {
  const KEY = 'content_view_session'
  let id = sessionStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(KEY, id)
  }
  return id
}

export function useContentViewTracking(contentId: string | undefined) {
  const viewIdRef = useRef<string | null>(null)
  const startRef = useRef<number>(0)

  useEffect(() => {
    if (!contentId) return

    const sessionId = getSessionId()
    startRef.current = Date.now()
    viewIdRef.current = null

    supabase
      .rpc('record_content_view', {
        p_content_id: contentId,
        p_session_id: sessionId,
        p_referrer: document.referrer || null,
      })
      .then(({ data }) => {
        if (data) viewIdRef.current = data as string
      })

    const sendDuration = () => {
      const viewId = viewIdRef.current
      const elapsed = Date.now() - startRef.current
      if (!viewId || elapsed < 1000) return

      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/update_content_view_duration`
      const body = JSON.stringify({ p_view_id: viewId, p_duration_ms: elapsed })

      // Prefer sendBeacon for unload scenarios, fall back to fetch
      const sent = navigator.sendBeacon?.(
        `${url}?apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        new Blob([body], { type: 'application/json' }),
      )

      if (!sent) {
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body,
          keepalive: true,
        }).catch(() => {})
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') sendDuration()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      sendDuration()
    }
  }, [contentId])
}
