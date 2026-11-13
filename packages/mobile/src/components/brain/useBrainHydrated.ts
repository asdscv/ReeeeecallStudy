import { useEffect, useState } from 'react'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { useAuthState } from '../../hooks'
import { brainStorageFor } from './brain-ui'

/**
 * The account's cloud copy usually lands well under a second. Waiting this long for it keeps a new
 * phone or a reinstall from starting a round at level 1 on a record the account has long passed;
 * after it the device copy plays on and the cloud merges in when it arrives.
 */
const CLOUD_WAIT_MS = 2_000

/**
 * Loads this user's brain-game progress and says when it is in. A round reads the player's level
 * when it starts, and Today's Training plans its line-up from the progress — both must wait, or
 * they would start from an empty record and overwrite the real one on the first save.
 */
export function useBrainHydrated(): boolean {
  const { user } = useAuthState()
  const hydrate = useBrainStore((s) => s.hydrate)
  const storageKey = useBrainStore((s) => s.storageKey)
  const cloudReady = useBrainStore((s) => s.cloudReady)
  const local = user !== null && storageKey === brainStorageFor(user.id).key
  const [waitedFor, setWaitedFor] = useState<string | null>(null)

  useEffect(() => {
    if (user) hydrate(brainStorageFor(user.id))
  }, [user, hydrate])

  useEffect(() => {
    if (!local || cloudReady || !storageKey) return
    const t = setTimeout(() => setWaitedFor(storageKey), CLOUD_WAIT_MS)
    return () => clearTimeout(t)
  }, [local, cloudReady, storageKey])

  return local && (cloudReady || waitedFor === storageKey)
}
