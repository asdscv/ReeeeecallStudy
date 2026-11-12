import { useCallback, useEffect, useState } from 'react'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { isBrainGameId, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { Screen } from '../../components/ui'
import { RoundView } from '../../components/brain/RoundView'
import { RoundSummary } from '../../components/brain/RoundSummary'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'
import type { BrainStackParamList } from '../../navigation/types'

/**
 * Free practice of one game: a round until the chances run out, the round's cap, or "Finish" —
 * then its summary. Every trial is saved the moment it is judged, so leaving at any point loses
 * nothing.
 */
export function BrainPlayScreen() {
  const navigation = useNavigation()
  const { params } = useRoute<RouteProp<BrainStackParamList, 'BrainPlay'>>()
  const ready = useBrainHydrated()
  const [finished, setFinished] = useState<RoundStats | null>(null)
  const [run, setRun] = useState(0)
  const gameId: BrainGameId | null = isBrainGameId(params.mode) ? params.mode : null

  useEffect(() => {
    if (!gameId) navigation.goBack()
  }, [gameId, navigation])

  const onOver = useCallback((stats: RoundStats) => setFinished(stats), [])

  return (
    <Screen padding={false}>
      {!ready || !gameId ? null : finished ? (
        <RoundSummary
          gameId={gameId}
          stats={finished}
          onAgain={() => {
            setFinished(null)
            setRun((r) => r + 1)
          }}
          onHome={() => navigation.goBack()}
        />
      ) : (
        <RoundView key={run} gameId={gameId} onOver={onOver} />
      )}
    </Screen>
  )
}
