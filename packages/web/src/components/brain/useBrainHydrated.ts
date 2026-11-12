import { useEffect } from 'react'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { useAuthStore } from '../../stores/auth-store'
import { brainStorageFor } from './brain-ui'

/** Loads the signed-in player's progress; true once it is the current user's. */
export function useBrainHydrated(): boolean {
  const userId = useAuthStore((s) => s.user?.id)
  const hydrate = useBrainStore((s) => s.hydrate)
  const storageKey = useBrainStore((s) => s.storageKey)
  useEffect(() => {
    if (userId) hydrate(brainStorageFor(userId))
  }, [userId, hydrate])
  return !!userId && storageKey === brainStorageFor(userId).key
}
