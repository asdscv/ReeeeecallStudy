import { useEffect, useState } from 'react'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { useAuthStore } from '../../stores/auth-store'
import { brainStorageFor } from './brain-ui'

/**
 * The account's cloud copy usually lands well under a second. Waiting this long for it keeps a new
 * browser from showing (and starting a round at) level 1 on a record the account has long passed;
 * after it the device copy plays on and the cloud merges in when it arrives.
 */
const CLOUD_WAIT_MS = 2_000

/** Loads the signed-in player's progress; true once it is the current user's (and the cloud answered or the wait ran out). */
export function useBrainHydrated(): boolean {
  const userId = useAuthStore((s) => s.user?.id)
  const hydrate = useBrainStore((s) => s.hydrate)
  const storageKey = useBrainStore((s) => s.storageKey)
  const cloudReady = useBrainStore((s) => s.cloudReady)
  const local = !!userId && storageKey === brainStorageFor(userId).key
  const [waitedFor, setWaitedFor] = useState<string | null>(null)
  useEffect(() => {
    if (userId) hydrate(brainStorageFor(userId))
  }, [userId, hydrate])
  useEffect(() => {
    if (!local || cloudReady || !storageKey) return
    const t = setTimeout(() => setWaitedFor(storageKey), CLOUD_WAIT_MS)
    return () => clearTimeout(t)
  }, [local, cloudReady, storageKey])
  return local && (cloudReady || waitedFor === storageKey)
}
