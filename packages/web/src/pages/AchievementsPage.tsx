import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Trophy, Lock } from 'lucide-react'
import { useAchievementStore } from '../stores/achievement-store'
import type { Achievement } from '../stores/achievement-store'

const CATEGORY_ORDER: Achievement['category'][] = ['streak', 'study', 'social', 'milestone']

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

export function AchievementsPage() {
  const { t } = useTranslation('common')
  const { achievements, xp, level, loading, fetchAchievements } = useAchievementStore()

  useEffect(() => {
    fetchAchievements()
  }, [fetchAchievements])

  const currentLevelXp = xpInCurrentLevel(xp, level)
  const nextLevelXp = xpForLevel(level)
  const progressPct = Math.min((currentLevelXp / nextLevelXp) * 100, 100)

  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    items: achievements.filter(a => a.category === cat),
  })).filter(g => g.items.length > 0)

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse"><Trophy className="w-10 h-10 text-yellow-500" /></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('achievements.title')}</h1>

      {/* Level + XP bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-yellow-100 text-yellow-600 font-bold text-lg">
            {level}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700">
              {t('achievements.level')} {level}
            </p>
            <p className="text-xs text-gray-500">
              {currentLevelXp} / {nextLevelXp} {t('achievements.xp')}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-900">{xp} {t('achievements.xp')}</p>
            <p className="text-xs text-gray-500">{t('achievements.totalXp')}</p>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-yellow-500 h-3 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Achievement groups */}
      {grouped.map(({ category, items }) => (
        <div key={category}>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 capitalize">
            {t(`achievements.category.${category}`)}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {items.map(ach => (
              <div
                key={ach.id}
                className={`relative rounded-xl border p-4 text-center transition-all ${
                  ach.earned
                    ? 'bg-white border-yellow-300 shadow-sm'
                    : 'bg-gray-50 border-gray-200 opacity-60'
                }`}
              >
                <div className="text-3xl mb-2">{ach.icon}</div>
                <p className="text-sm font-medium text-gray-900 mb-1">
                  {t(`achievements.badge.${ach.id}`, ach.id)}
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  {t(`achievements.badgeDesc.${ach.id}`, '')}
                </p>
                <span className="inline-block text-xs font-semibold text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
                  +{ach.xp_reward} {t('achievements.xp')}
                </span>
                {ach.earned && ach.earned_at && (
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    {new Date(ach.earned_at).toLocaleDateString()}
                  </p>
                )}
                {!ach.earned && (
                  <div className="absolute top-2 right-2 text-gray-400">
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {achievements.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Trophy className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>{t('achievements.empty')}</p>
        </div>
      )}
    </div>
  )
}
