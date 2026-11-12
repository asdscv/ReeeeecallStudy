import { useEffect, useState } from 'react'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { isBrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import type { BrainMode, SessionStats } from '@reeeeecall/shared/hooks/useBrainSession'
import { Screen } from '../../components/ui'
import { useAuthState } from '../../hooks'
import { BrainSessionView } from '../../components/brain/BrainSessionView'
import { BrainSummaryView } from '../../components/brain/BrainSummaryView'
import { brainStorageFor } from '../../components/brain/brain-ui'
import type { BrainStackParamList } from '../../navigation/types'

/** One game by id, or `mix`. Leaving at any point is safe: every round is saved as it ends. */
export function BrainPlayScreen() {
  const navigation = useNavigation()
  const { params } = useRoute<RouteProp<BrainStackParamList, 'BrainPlay'>>()
  const { user } = useAuthState()
  const hydrate = useBrainStore((s) => s.hydrate)
  const storageKey = useBrainStore((s) => s.storageKey)
  const [finished, setFinished] = useState<SessionStats | null>(null)
  const [run, setRun] = useState(0)
  const mode: BrainMode | null = params.mode === 'mix' || isBrainGameId(params.mode) ? (params.mode as BrainMode) : null

  useEffect(() => {
    if (user) hydrate(brainStorageFor(user.id))
  }, [user, hydrate])

  useEffect(() => {
    if (!mode) navigation.goBack()
  }, [mode, navigation])

  // The session reads the player's levels when it starts, so it waits for them.
  const ready = mode !== null && user !== null && storageKey === brainStorageFor(user.id).key

  return (
    <Screen padding={false}>
      {!ready ? null : finished ? (
        <BrainSummaryView
          stats={finished}
          onAgain={() => { setFinished(null); setRun((r) => r + 1) }}
          onHome={() => navigation.goBack()}
        />
      ) : (
        <BrainSessionView key={run} mode={mode} onFinish={setFinished} />
      )}
    </Screen>
  )
}
