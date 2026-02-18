import { useTranslation } from 'react-i18next'
import { formatDuration } from '../../lib/study-history'
import type { OverviewStats } from '../../lib/study-history-stats'

interface OverviewStatsCardsProps {
  stats: OverviewStats
  streak: number
}

export function OverviewStatsCards({ stats, streak }: OverviewStatsCardsProps) {
  const { t } = useTranslation('history')

  const items = [
    { label: t('overview.sessions'), value: t('overview.sessionsValue', { count: stats.totalSessions }), color: 'text-gray-900' },
    { label: t('overview.studyCards'), value: t('overview.cardsValue', { count: stats.totalCardsStudied }), color: 'text-blue-600' },
    { label: t('overview.totalTime'), value: formatDuration(stats.totalTimeMs), color: 'text-purple-600' },
    { label: t('overview.avgPerformance'), value: `${stats.avgPerformance}%`, color: 'text-green-600' },
    { label: t('overview.streak'), value: t('overview.streakValue', { count: streak }), color: 'text-amber-600' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4"
        >
          <p className="text-xs text-gray-500 mb-0.5">{item.label}</p>
          <p className={`text-xl sm:text-2xl font-bold ${item.color}`}>{item.value}</p>
        </div>
      ))}
    </div>
  )
}
