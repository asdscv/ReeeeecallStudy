import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isBrainGameId, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useTrackEvent } from '../../hooks/useTrackEvent'
import { RoundView } from '../../components/brain/RoundView'
import { RoundSummary } from '../../components/brain/RoundSummary'
import { GameIntro } from '../../components/brain/GameIntro'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'

/**
 * `/brain/play/:mode` — free practice of one game, full screen: the game's intro (with its demo),
 * a countdown, the round, the results. "Again" goes straight to the countdown.
 */
export function BrainPlayPage() {
  const { mode } = useParams()
  // Load the namespace before the first trial draws, so prompts never flash as raw keys.
  const { t } = useTranslation('brain')
  const ready = useBrainHydrated()
  const navigate = useNavigate()
  const trackEvent = useTrackEvent()
  const [stage, setStage] = useState<'intro' | 'play' | 'summary'>('intro')
  const [finished, setFinished] = useState<RoundStats | null>(null)
  const [run, setRun] = useState(0)

  // The old endless mix became Today's Training.
  if (mode === 'mix') return <Navigate to="/brain/training" replace />
  if (!isBrainGameId(mode)) return <Navigate to="/brain" replace />
  // A round reads the player's levels when it starts, so it waits for them.
  if (!ready) return null
  const gameId: BrainGameId = mode

  if (stage === 'intro') {
    return <GameIntro gameId={gameId} onStart={() => setStage('play')} onClose={() => navigate('/brain')} closeLabel={t('play.back')} />
  }
  if (stage === 'summary' && finished) {
    return <RoundSummary gameId={gameId} stats={finished} onAgain={() => { setFinished(null); setRun((r) => r + 1); setStage('play') }} />
  }
  return (
    <RoundView
      key={run}
      gameId={gameId}
      onOver={(stats) => {
        if (stats.trials > 0) trackEvent({ category: 'brain', action: 'round_end', label: `${gameId}:${stats.endedBy}`, value: stats.trials })
        // Stopping before the first counted trial is backing out, not a round to sum up.
        if (stats.trials === 0 && stats.endedBy === 'stop') return navigate('/brain')
        setFinished(stats)
        setStage('summary')
      }}
    />
  )
}
