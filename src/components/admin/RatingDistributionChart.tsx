import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { useTranslation } from 'react-i18next'
import { ratingLabel } from '../../lib/admin-stats'
import type { AdminRatingDistribution } from '../../types/database'

const RATING_COLORS: Record<string, string> = {
  again: '#ef4444',
  hard: '#f59e0b',
  good: '#10b981',
  easy: '#3b82f6',
}

interface RatingDistributionChartProps {
  data: AdminRatingDistribution[]
}

export function RatingDistributionChart({ data }: RatingDistributionChartProps) {
  const { t } = useTranslation('admin')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('study.ratingDistribution')}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rating" tick={{ fontSize: 11 }} tickFormatter={(v: string) => t(ratingLabel(v), v)} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={35} />
            <Tooltip labelFormatter={(label) => t(ratingLabel(String(label)), String(label))} formatter={(value) => [Number(value).toLocaleString(), t('study.cards')]} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={index} fill={RATING_COLORS[entry.rating] ?? '#6b7280'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
