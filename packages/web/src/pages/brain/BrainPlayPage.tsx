import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isBrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import type { BrainMode, SessionStats } from '@reeeeecall/shared/hooks/useBrainSession'
import { useAuthStore } from '../../stores/auth-store'
import { useTrackEvent } from '../../hooks/useTrackEvent'
import { BrainSession } from '../../components/brain/BrainSession'
import { BrainSummary } from '../../components/brain/BrainSummary'
import { brainStorageFor } from '../../components/brain/brain-ui'

/** `/brain/play/:mode` — one game by id, or `mix`. Full screen, like a study session. */
export function BrainPlayPage() {
  const { mode } = useParams()
  // Load the namespace before the first round draws, so prompts never flash as raw keys.
  useTranslation('brain')
  const userId = useAuthStore((s) => s.user?.id)
  const hydrate = useBrainStore((s) => s.hydrate)
  const storageKey = useBrainStore((s) => s.storageKey)
  const trackEvent = useTrackEvent()
  const [finished, setFinished] = useState<SessionStats | null>(null)
  const [run, setRun] = useState(0)

  useEffect(() => {
    if (userId) hydrate(brainStorageFor(userId))
  }, [userId, hydrate])

  if (mode !== 'mix' && !isBrainGameId(mode)) return <Navigate to="/brain" replace />
  // The session reads the player's levels when it starts, so it waits for them.
  if (!userId || storageKey !== brainStorageFor(userId).key) return null

  const finish = (stats: SessionStats) => {
    setFinished(stats)
    if (stats.rounds > 0) {
      trackEvent({ category: 'brain', action: 'session_end', label: mode, value: stats.rounds })
    }
  }

  if (finished) {
    return <BrainSummary stats={finished} onAgain={() => { setFinished(null); setRun((r) => r + 1) }} />
  }
  return <BrainSession key={run} mode={mode as BrainMode} onFinish={finish} />
}
