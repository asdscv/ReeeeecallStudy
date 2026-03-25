/**
 * useGamification — convenience hook wrapping the Zustand store.
 *
 * Auto-fetches on mount when user is authenticated.
 * Any component using this hook shares the same global state.
 *
 * Re-exports types from the store for backward compatibility.
 */
import { useEffect } from 'react'
import { useGamificationStore } from '../stores/gamification-store'
import { useAuthState } from './useAuthState'
import { xpInCurrentLevel, xpForLevel } from '../stores/gamification-store'

// Re-export types so consumers don't need to import from store directly
export type {
  Achievement,
  FreezeInfo,
  Quest,
  NextGoal,
} from '../stores/gamification-store'

export interface LevelInfo {
  level: number
  current_xp: number
  xp_for_next: number
  total_xp: number
}

export function useGamification() {
  const { user } = useAuthState()
  const store = useGamificationStore()

  useEffect(() => {
    if (user?.id) {
      store.fetchAll()
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const levelInfo: LevelInfo | null =
    store.level > 0
      ? {
          level: store.level,
          current_xp: xpInCurrentLevel(store.xp, store.level),
          xp_for_next: xpForLevel(store.level),
          total_xp: store.xp,
        }
      : null

  return {
    // Level & achievements
    levelInfo,
    achievements: store.achievements,

    // Widgets
    freezeInfo: store.freezeInfo,
    quests: store.quests,
    goals: store.goals,

    // Loading
    loading: store.loading || store.widgetsLoading,

    // Actions
    refresh: store.fetchAll,
    checkAchievements: store.checkAchievements,
  }
}
