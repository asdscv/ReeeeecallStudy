/**
 * Gamification Store — Zustand (mirrors web achievement-store.ts pattern)
 *
 * Single source of truth for all gamification state:
 * - Level / XP (from get_user_achievements RPC)
 * - Achievements list
 * - Streak Freeze info
 * - Daily Quests
 * - Next Goals
 *
 * Any screen (Dashboard, Achievements, Settings) can subscribe via
 * `useGamificationStore()` — data is fetched once and cached globally.
 */
import { create } from 'zustand'
import { getMobileSupabase } from '../adapters'
import { Alert } from 'react-native'

// ── Types ──

export interface Achievement {
  id: string
  category: 'streak' | 'study' | 'social' | 'milestone'
  icon: string
  required_value: number
  xp_reward: number
  earned: boolean
  earned_at: string | null
}

export interface FreezeInfo {
  streak_freezes: number
  freeze_used_today: boolean
  current_streak: number
}

export interface Quest {
  quest_type: 'cards' | 'sessions' | 'time' | 'perfect'
  target_value: number
  current_value: number
  current_xp: number
  completed: boolean
}

export interface NextGoal {
  category: string
  label?: string
  icon: string
  current: number
  target: number
  xp: number
  progress: number
}

// ── Level computation (matches web achievement-store.ts exactly) ──

export function xpForLevel(level: number): number {
  return level * 100
}

export function computeLevel(xp: number): number {
  let level = 1
  let remaining = xp
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level)
    level++
  }
  return level
}

export function xpInCurrentLevel(totalXp: number, level: number): number {
  let cumulative = 0
  for (let i = 1; i < level; i++) {
    cumulative += xpForLevel(i)
  }
  return totalXp - cumulative
}

// ── RPC helper (Promise.resolve pattern for RN compatibility) ──

function parseRpcData<T>(data: unknown): T {
  return (typeof data === 'string' ? JSON.parse(data) : data) as T
}

// ── Store ──

interface GamificationState {
  // Achievements & Level
  achievements: Achievement[]
  xp: number
  level: number
  newlyEarned: string[]

  // Gamification widgets
  freezeInfo: FreezeInfo | null
  quests: Quest[]
  goals: NextGoal[]

  // Loading states
  loading: boolean
  widgetsLoading: boolean

  // Actions
  fetchAchievements: () => void
  fetchWidgets: () => void
  fetchAll: () => void
  checkAchievements: () => void
  clearNewlyEarned: () => void
  reset: () => void
}

const INITIAL_STATE = {
  achievements: [] as Achievement[],
  xp: 0,
  level: 1,
  newlyEarned: [] as string[],
  freezeInfo: null as FreezeInfo | null,
  quests: [] as Quest[],
  goals: [] as NextGoal[],
  loading: false,
  widgetsLoading: false,
}

export const useGamificationStore = create<GamificationState>((set, get) => ({
  ...INITIAL_STATE,

  fetchAchievements: () => {
    if (get().loading) return
    set({ loading: true })

    const supabase = getMobileSupabase()
    Promise.resolve(supabase.rpc('get_user_achievements'))
      .then(({ data, error }) => {
        if (error) {
          console.warn('[gamification] get_user_achievements error:', error.message)
          set({ loading: false })
          return
        }
        if (!data) {
          console.warn('[gamification] get_user_achievements: no data')
          set({ loading: false })
          return
        }

        const result = parseRpcData<{ achievements: Achievement[]; xp: number }>(data)
        const achievements = result.achievements ?? []
        const xp = result.xp ?? 0
        const level = computeLevel(xp)

        console.log('[gamification] achievements:', achievements.length, 'xp:', xp, 'level:', level)
        set({ achievements, xp, level, loading: false })
      })
      .catch((err) => {
        console.warn('[gamification] get_user_achievements catch:', err)
        set({ loading: false })
      })
  },

  fetchWidgets: () => {
    if (get().widgetsLoading) return
    set({ widgetsLoading: true })

    const supabase = getMobileSupabase()
    let settled = 0
    const checkDone = () => { if (++settled >= 3) set({ widgetsLoading: false }) }

    // Streak Freeze
    Promise.resolve(supabase.rpc('get_streak_freeze_info'))
      .then(({ data, error }) => {
        if (error) console.warn('[gamification] streak_freeze error:', error.message)
        if (data) set({ freezeInfo: parseRpcData<FreezeInfo>(data) })
      })
      .catch((e) => console.warn('[gamification] streak_freeze catch:', e))
      .finally(checkDone)

    // Daily Quests
    Promise.resolve(supabase.rpc('generate_daily_quests'))
      .then(({ data, error }) => {
        if (error) console.warn('[gamification] quests error:', error.message)
        if (data) set({ quests: parseRpcData<Quest[]>(data) })
      })
      .catch((e) => console.warn('[gamification] quests catch:', e))
      .finally(checkDone)

    // Next Goals — response can be { goals: Goal[] } | Goal[]
    Promise.resolve(supabase.rpc('get_next_goals'))
      .then(({ data, error }) => {
        if (error) console.warn('[gamification] goals error:', error.message)
        if (data) {
          const parsed = parseRpcData<{ goals: NextGoal[] } | NextGoal[]>(data)
          const goalsArr = Array.isArray(parsed) ? parsed : parsed.goals ?? []
          console.log('[gamification] goals:', goalsArr.length)
          set({ goals: goalsArr })
        }
      })
      .catch((e) => console.warn('[gamification] goals catch:', e))
      .finally(checkDone)
  },

  fetchAll: () => {
    get().fetchAchievements()
    get().fetchWidgets()
  },

  checkAchievements: () => {
    const supabase = getMobileSupabase()
    Promise.resolve(supabase.rpc('check_achievements'))
      .then(({ data, error }) => {
        if (error) throw error

        const result = parseRpcData<{ new_achievements: string[] }>(data)
        const newIds = result?.new_achievements ?? []

        if (newIds.length > 0) {
          set({ newlyEarned: newIds })

          // Show alert for new achievements (RN equivalent of web toast)
          const { achievements } = get()
          for (const id of newIds) {
            const ach = achievements.find((a) => a.id === id)
            if (ach) {
              Alert.alert('Achievement Unlocked!', `${ach.icon} +${ach.xp_reward} XP`)
            }
          }

          // Refresh to get updated state
          get().fetchAchievements()
        }
      })
      .catch(() => {})
  },

  clearNewlyEarned: () => set({ newlyEarned: [] }),

  reset: () => set(INITIAL_STATE),
}))
