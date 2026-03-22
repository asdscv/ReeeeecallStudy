import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy, Lock, ChevronDown, ChevronUp } from 'lucide-react'
import { useAchievementStore } from '../stores/achievement-store'
import type { Achievement } from '../stores/achievement-store'
import { supabase } from '../lib/supabase'

// ── Helpers ──

const CATEGORY_ORDER: Achievement['category'][] = ['streak', 'study', 'social', 'milestone']
const CATEGORY_ICONS: Record<string, string> = {
  streak: '🔥', study: '📚', social: '🤝', milestone: '🏆',
}

function xpForLevel(level: number): number { return level * 100 }
function xpInCurrentLevel(xp: number, level: number): number {
  let r = xp
  for (let i = 1; i < level; i++) r -= xpForLevel(i)
  return r
}

interface NextGoal {
  category: string
  current: number
  target: number
  icon: string
  xp: number
  progress: number
}

// ── Main Page ──

export function AchievementsPage() {
  const { t } = useTranslation('common')
  const { achievements, xp, level, loading, fetchAchievements } = useAchievementStore()
  const [nextGoals, setNextGoals] = useState<NextGoal[]>([])
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  useEffect(() => {
    fetchAchievements()
    const loadGoals = async () => {
      try {
        const { data } = await supabase.rpc('get_next_goals')
        const result = data as { goals: NextGoal[] } | null
        setNextGoals(result?.goals ?? [])
      } catch { /* ignore */ }
    }
    loadGoals()
  }, [fetchAchievements])

  const earned = achievements.filter(a => a.earned)
  const recentEarned = [...earned].sort((a, b) =>
    (b.earned_at ?? '').localeCompare(a.earned_at ?? '')
  ).slice(0, 3)

  const currentLevelXp = xpInCurrentLevel(xp, level)
  const nextLevelXp = xpForLevel(level)
  const progressPct = Math.min((currentLevelXp / nextLevelXp) * 100, 100)

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Trophy className="w-10 h-10 text-yellow-500 animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('achievements.title')}</h1>

      {/* Level + XP bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 font-bold text-xl">
            {level}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('achievements.level')} {level}</p>
            <p className="text-xs text-gray-500">{currentLevelXp} / {nextLevelXp} {t('achievements.xp')}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{xp.toLocaleString()}</p>
            <p className="text-xs text-gray-500">{t('achievements.totalXp')}</p>
          </div>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
          <div className="bg-yellow-500 h-3 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Section 1: Next Goals (5 categories) */}
      {nextGoals.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            {t('goals.title', 'Next Goals')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {nextGoals.map(goal => (
              <div key={goal.category} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <span className="text-2xl shrink-0">{goal.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {t(`goals.${goal.category}`, goal.category)}
                    </span>
                    <span className="text-xs text-blue-600 font-semibold">+{goal.xp} XP</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2 mb-1">
                    <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, goal.progress)}%` }} />
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {formatValue(goal.category, goal.current)} / {formatValue(goal.category, goal.target)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 2: Recent Earned (last 3) */}
      {recentEarned.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            {t('achievements.recent', 'Recent Achievements')}
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {recentEarned.map(ach => (
              <div key={ach.id} className="shrink-0 w-32 text-center p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
                <div className="text-3xl mb-1">{ach.icon}</div>
                <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                  {t(`achievements.badge.${ach.id}`, ach.id.replace(/_/g, ' '))}
                </p>
                <p className="text-[10px] text-gray-400 mt-1">
                  {ach.earned_at ? new Date(ach.earned_at).toLocaleDateString() : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3: All Achievements (collapsible by category) */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('achievements.viewAll', 'All Achievements')}
          <span className="ml-2 text-xs font-normal text-gray-400">
            {earned.length}{t('achievements.earned', ' earned')}
          </span>
        </h2>

        {CATEGORY_ORDER.map(cat => {
          const items = achievements.filter(a => a.category === cat)
          if (items.length === 0) return null

          const earnedInCat = items.filter(a => a.earned)
          const isExpanded = expandedCategory === cat
          // Show: earned ones + next 1 locked + rest as "???"
          const nextLocked = items.find(a => !a.earned)
          const hiddenCount = items.filter(a => !a.earned).length - (nextLocked ? 1 : 0)

          return (
            <div key={cat} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setExpandedCategory(isExpanded ? null : cat)}
                className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{CATEGORY_ICONS[cat]}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {t(`achievements.category.${cat}`)}
                  </span>
                  <span className="text-xs text-gray-400">{earnedInCat.length}{t('achievements.earned', ' earned')}</span>
                </div>
                {isExpanded
                  ? <ChevronUp className="w-4 h-4 text-gray-400" />
                  : <ChevronDown className="w-4 h-4 text-gray-400" />
                }
              </button>

              {isExpanded && (
                <div className="px-4 pb-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {/* Earned badges */}
                    {earnedInCat.map(ach => (
                      <div key={ach.id} className="rounded-xl border border-yellow-300 dark:border-yellow-700 bg-white dark:bg-gray-800 p-3 text-center shadow-sm">
                        <div className="text-2xl mb-1">{ach.icon}</div>
                        <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                          {t(`achievements.badge.${ach.id}`, ach.id.replace(/_/g, ' '))}
                        </p>
                        <span className="text-[10px] text-yellow-600">+{ach.xp_reward} XP</span>
                      </div>
                    ))}

                    {/* Next locked (visible) */}
                    {nextLocked && (
                      <div className="rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 p-3 text-center opacity-70">
                        <div className="text-2xl mb-1 grayscale">{nextLocked.icon}</div>
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                          {t(`achievements.badge.${nextLocked.id}`, nextLocked.id.replace(/_/g, ' '))}
                        </p>
                        <div className="flex items-center justify-center gap-1 mt-1">
                          <Lock className="w-3 h-3 text-gray-400" />
                          <span className="text-[10px] text-gray-400">+{nextLocked.xp_reward} XP</span>
                        </div>
                      </div>
                    )}

                    {/* Hidden badges — just "???" with no count */}
                    {hiddenCount > 0 && (
                      <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 p-3 text-center flex flex-col items-center justify-center">
                        <p className="text-2xl text-gray-300 dark:text-gray-500 font-bold">???</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {achievements.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Trophy className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>{t('achievements.empty')}</p>
        </div>
      )}
    </div>
  )
}

// ── Helpers ──

function formatValue(category: string, value: number): string {
  if (category === 'time') {
    if (value >= 60) return `${Math.round(value / 60)}h`
    return `${value}m`
  }
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}
