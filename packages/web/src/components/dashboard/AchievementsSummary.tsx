import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useAchievementStore } from '../../stores/achievement-store'
import { AchievementIcon } from '../../lib/achievement-icons'

function xpForLevel(level: number): number {
  return level * 100
}

function xpInCurrentLevel(xp: number, level: number): number {
  let remaining = xp
  for (let i = 1; i < level; i++) {
    remaining -= xpForLevel(i)
  }
  return remaining
}

export function AchievementsSummary() {
  const { t } = useTranslation('common')
  const { achievements, xp, level, loading, fetchAchievements } = useAchievementStore()

  useEffect(() => {
    fetchAchievements()
  }, [fetchAchievements])

  if (loading) return null

  const currentLevelXp = xpInCurrentLevel(xp, level)
  const nextLevelXp = xpForLevel(level)
  const progressPct = Math.min((currentLevelXp / nextLevelXp) * 100, 100)

  const recentEarned = achievements
    .filter(a => a.earned)
    .sort((a, b) => {
      if (!a.earned_at || !b.earned_at) return 0
      return new Date(b.earned_at).getTime() - new Date(a.earned_at).getTime()
    })
    .slice(0, 4)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-yellow-100 text-yellow-600 font-bold text-sm">
            {level}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">
              {t('achievements.level')} {level}
            </p>
            <p className="text-xs text-gray-500">
              {currentLevelXp} / {nextLevelXp} {t('achievements.xp')}
            </p>
          </div>
        </div>
        <Link
          to="/achievements"
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 no-underline transition"
        >
          {t('achievements.viewAll')}
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* XP progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
        <div
          className="bg-yellow-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Recent badges */}
      {recentEarned.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 mr-1">{t('achievements.recent')}:</span>
          {recentEarned.map(ach => (
            <div key={ach.id} title={t(`achievements.badge.${ach.id}`, ach.id)}>
              <AchievementIcon id={ach.id} category={ach.category} dbIcon={ach.icon} size="sm" earned />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
