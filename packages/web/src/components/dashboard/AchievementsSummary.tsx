import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useAchievementStore } from '../../stores/achievement-store'
import { AchievementIcon } from '../../lib/achievement-icons'

function xpForLevel(level: number): number {
  return (level - 1) * 150
}

function xpInCurrentLevel(xp: number, level: number): number {
  return xp - xpForLevel(level)
}

function xpToNextLevel(_level: number): number {
  return 150
}

export function AchievementsSummary() {
  const { t } = useTranslation('common')
  const { achievements, xp, level, loading, fetchAchievements } = useAchievementStore()

  useEffect(() => {
    fetchAchievements()
  }, [fetchAchievements])

  if (loading) return null

  const currentLevelXp = xpInCurrentLevel(xp, level)
  const nextLevelXp = xpToNextLevel(level)
  const progressPct = nextLevelXp > 0 ? Math.min((currentLevelXp / nextLevelXp) * 100, 100) : 100

  const recentEarned = achievements
    .filter(a => a.earned)
    .sort((a, b) => {
      if (!a.earned_at || !b.earned_at) return 0
      return new Date(b.earned_at).getTime() - new Date(a.earned_at).getTime()
    })
    .slice(0, 4)

  return (
    <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-warning/15 text-warning font-bold text-sm">
            {level}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('achievements.level')} {level}
            </p>
            <p className="text-xs text-muted-foreground">
              {currentLevelXp} / {nextLevelXp} {t('achievements.xp')}
            </p>
          </div>
        </div>
        <Link
          to="/achievements"
          className="flex items-center gap-1 text-sm text-brand hover:text-brand no-underline transition"
        >
          {t('achievements.viewAll')}
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* XP progress bar */}
      <div className="w-full bg-accent rounded-full h-2 mb-3">
        <div
          className="bg-warning h-2 rounded-full transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Recent badges */}
      {recentEarned.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">{t('achievements.recent')}:</span>
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
