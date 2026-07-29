import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'

interface StatsSummaryCardsProps {
  totalCards: number
  dueToday: number
  streak: number
  masteryRate: number
}

export function StatsSummaryCards({ totalCards, dueToday, streak, masteryRate }: StatsSummaryCardsProps) {
  const { t } = useTranslation(['dashboard', 'common'])
  const items = [
    // Counts are rendered raw into JSX here (no i18next interpolation to format them),
    // so group them explicitly — a 2,500-card account showed "2500".
    { label: t('dashboard:stats.totalCards'), value: formatCount(totalCards), color: 'text-foreground' },
    { label: t('dashboard:stats.todayReview'), value: formatCount(dueToday), color: 'text-warning' },
    { label: t('dashboard:stats.streak'), value: `${formatCount(streak)}${t('common:units.days')}`, color: 'text-success' },
    { label: t('dashboard:stats.masteryRate'), value: `${masteryRate}%`, color: 'text-brand' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-card rounded-xl border border-border p-3 sm:p-5"
        >
          <p className="text-xs sm:text-sm text-muted-foreground mb-0.5 sm:mb-1">{item.label}</p>
          <p className={`text-2xl sm:text-3xl font-bold ${item.color}`}>{item.value}</p>
        </div>
      ))}
    </div>
  )
}
