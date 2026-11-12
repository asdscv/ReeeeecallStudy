import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isBrainGameId, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useTrackEvent } from '../../hooks/useTrackEvent'
import { RoundView } from '../../components/brain/RoundView'
import { RoundSummary } from '../../components/brain/RoundSummary'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'

/** `/brain/play/:mode` — free practice of one game. Full screen, like a study session. */
export function BrainPlayPage() {
  const { mode } = useParams()
  // Load the namespace before the first trial draws, so prompts never flash as raw keys.
  useTranslation('brain')
  const ready = useBrainHydrated()
  const trackEvent = useTrackEvent()
  const [finished, setFinished] = useState<RoundStats | null>(null)
  const [run, setRun] = useState(0)

  // The old endless mix became Today's Training.
  if (mode === 'mix') return <Navigate to="/brain/training" replace />
  if (!isBrainGameId(mode)) return <Navigate to="/brain" replace />
  // A round reads the player's levels when it starts, so it waits for them.
  if (!ready) return null
  const gameId: BrainGameId = mode

  if (finished) {
    return <RoundSummary gameId={gameId} stats={finished} onAgain={() => { setFinished(null); setRun((r) => r + 1) }} />
  }
  return (
    <RoundView
      key={run}
      gameId={gameId}
      onOver={(stats) => {
        setFinished(stats)
        if (stats.trials > 0) trackEvent({ category: 'brain', action: 'round_end', label: `${gameId}:${stats.endedBy}`, value: stats.trials })
      }}
    />
  )
}
