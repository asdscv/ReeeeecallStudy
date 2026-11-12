import { useEffect } from 'react'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { useAuthState } from '../../hooks'
import { brainStorageFor } from './brain-ui'

/**
 * Loads this user's brain-game progress and says when it is in. A round reads the player's level
 * when it starts, and Today's Training plans its line-up from the progress — both must wait, or
 * they would start from an empty record and overwrite the real one on the first save.
 */
export function useBrainHydrated(): boolean {
  const { user } = useAuthState()
  const hydrate = useBrainStore((s) => s.hydrate)
  const storageKey = useBrainStore((s) => s.storageKey)

  useEffect(() => {
    if (user) hydrate(brainStorageFor(user.id))
  }, [user, hydrate])

  return user !== null && storageKey === brainStorageFor(user.id).key
}
