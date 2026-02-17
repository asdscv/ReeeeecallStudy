import { formatDuration } from '../../lib/study-history'
import type { OverviewStats } from '../../lib/study-history-stats'

interface OverviewStatsCardsProps {
  stats: OverviewStats
  streak: number
}

export function OverviewStatsCards({ stats, streak }: OverviewStatsCardsProps) {
  const items = [
    { label: '세션 수', value: `${stats.totalSessions}회`, color: 'text-gray-900' },
    { label: '학습 카드', value: `${stats.totalCardsStudied}장`, color: 'text-blue-600' },
    { label: '총 학습 시간', value: formatDuration(stats.totalTimeMs), color: 'text-purple-600' },
    { label: '평균 성과', value: `${stats.avgPerformance}%`, color: 'text-green-600' },
    { label: '연속 학습', value: `${streak}일`, color: 'text-amber-600' },
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
