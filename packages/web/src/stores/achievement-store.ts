import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { toast } from 'sonner'

export interface Achievement {
  id: string
  category: 'streak' | 'study' | 'social' | 'milestone'
  icon: string
  required_value: number
  xp_reward: number
  earned: boolean
  earned_at: string | null
}

interface AchievementState {
  achievements: Achievement[]
  xp: number
  level: number
  newlyEarned: string[]
  loading: boolean

  fetchAchievements: () => Promise<void>
  checkAchievements: () => Promise<string[]>
  clearNewlyEarned: () => void
}

function xpForLevel(level: number): number {
  return level * 100
}

function computeLevel(xp: number): number {
  let level = 1
  let remaining = xp
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level)
    level++
  }
  return level
}

export const useAchievementStore = create<AchievementState>((set, get) => ({
  achievements: [],
  xp: 0,
  level: 1,
  newlyEarned: [],
  loading: false,

  fetchAchievements: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const { data, error } = await supabase.rpc('get_user_achievements')
      if (error) throw error

      const result = data as {
        achievements: Achievement[]
        xp: number
      } | null

      const achievements = result?.achievements ?? []
      const xp = result?.xp ?? 0
      const level = computeLevel(xp)

      set({ achievements, xp, level, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  checkAchievements: async () => {
    try {
      const { data, error } = await supabase.rpc('check_achievements')
      if (error) throw error

      const newIds = (data ?? []) as string[]

      if (newIds.length > 0) {
        set({ newlyEarned: newIds })

        // Show toast for each new achievement
        const { achievements } = get()
        for (const id of newIds) {
          const ach = achievements.find(a => a.id === id)
          if (ach) {
            toast.success(`${ach.icon} Achievement unlocked! +${ach.xp_reward} XP`)
          } else {
            toast.success('Achievement unlocked!')
          }
        }

        // Refresh achievements to get updated state
        await get().fetchAchievements()
      }

      return newIds
    } catch {
      return []
    }
  },

  clearNewlyEarned: () => set({ newlyEarned: [] }),
}))
