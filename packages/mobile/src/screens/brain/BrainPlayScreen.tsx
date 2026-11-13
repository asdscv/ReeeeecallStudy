import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { GAME_THEMES, TRAINING_THEME, isBrainGameId, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { RoundView } from '../../components/brain/RoundView'
import { RoundSummary } from '../../components/brain/RoundSummary'
import { GameIntro } from '../../components/brain/GameIntro'
import { GameCanvas } from '../../components/brain/GameCanvas'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'
import { flushBrainStorage } from '../../components/brain/brain-ui'
import type { BrainStackParamList } from '../../navigation/types'

/**
 * Free practice of one game, full screen: the game's intro (with its demo), a countdown, the round,
 * the results. "Again" goes straight to the countdown. Every trial is saved the moment it is
 * judged, so leaving at any point loses nothing.
 */
export function BrainPlayScreen() {
  const navigation = useNavigation()
  const { params } = useRoute<RouteProp<BrainStackParamList, 'BrainPlay'>>()
  // Load the namespace before the first trial draws, so prompts never flash as raw keys.
  const { t } = useTranslation('brain')
  const ready = useBrainHydrated()
  const [stage, setStage] = useState<'intro' | 'play' | 'summary'>('intro')
  const [finished, setFinished] = useState<RoundStats | null>(null)
  const [run, setRun] = useState(0)
  const gameId: BrainGameId | null = isBrainGameId(params.mode) ? params.mode : null

  useEffect(() => {
    if (!gameId) navigation.goBack()
  }, [gameId, navigation])
  useEffect(() => () => flushBrainStorage(), [])

  const onOver = useCallback(
    (stats: RoundStats) => {
      // Stopping before the first counted trial is backing out, not a round to sum up.
      if (stats.trials === 0 && stats.endedBy === 'stop') return navigation.goBack()
      setFinished(stats)
      setStage('summary')
    },
    [navigation],
  )

  if (!gameId) return <View style={{ flex: 1, backgroundColor: TRAINING_THEME.canvasFrom }} />
  // A round reads the player's levels when it starts, so it waits for them.
  if (!ready) return <GameCanvas theme={GAME_THEMES[gameId]}>{null}</GameCanvas>
  if (stage === 'intro') {
    return <GameIntro gameId={gameId} onStart={() => setStage('play')} onClose={() => navigation.goBack()} closeLabel={t('play.back')} />
  }
  if (stage === 'summary' && finished) {
    return (
      <RoundSummary
        gameId={gameId}
        stats={finished}
        onAgain={() => {
          setFinished(null)
          setRun((r) => r + 1)
          setStage('play')
        }}
        onHome={() => navigation.goBack()}
      />
    )
  }
  return <RoundView key={run} gameId={gameId} onOver={onOver} />
}
