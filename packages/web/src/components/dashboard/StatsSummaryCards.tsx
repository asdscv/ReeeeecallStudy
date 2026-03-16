import { useTranslation } from 'react-i18next'

interface StatsSummaryCardsProps {
  totalCards: number
  dueToday: number
  streak: number
  masteryRate: number
}

export function StatsSummaryCards({ totalCards, dueToday, streak, masteryRate }: StatsSummaryCardsProps) {
  const { t } = useTranslation(['dashboard', 'common'])
  const items = [
    { label: t('dashboard:stats.totalCards'), value: totalCards, color: 'text-gray-900' },
    { label: t('dashboard:stats.todayReview'), value: dueToday, color: 'text-amber-600' },
    { label: t('dashboard:stats.streak'), value: `${streak}${t('common:units.days')}`, color: 'text-green-600' },
    { label: t('dashboard:stats.masteryRate'), value: `${masteryRate}%`, color: 'text-blue-600' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5"
        >
          <p className="text-xs sm:text-sm text-gray-500 mb-0.5 sm:mb-1">{item.label}</p>
          <p className={`text-2xl sm:text-3xl font-bold ${item.color}`}>{item.value}</p>
        </div>
      ))}
    </div>
  )
}
