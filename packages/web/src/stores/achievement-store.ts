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

function computeLevel(xp: number): number {
  return Math.floor(xp / 150) + 1
}

function xpForLevel(level: number): number {
  // Total XP needed to reach this level (Duolingo-style flat 150 XP per level)
  return (level - 1) * 150
}

function xpInCurrentLevel(totalXp: number, level: number): number {
  return totalXp - xpForLevel(level)
}

function xpToNextLevel(_level: number): number {
  return 150
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

      const result = data as { new_achievements: string[] } | null
      const newIds = result?.new_achievements ?? []

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
