import { useTranslation } from 'react-i18next'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import type { RatingDistribution } from '../../lib/study-history-stats'

interface RatingDistributionChartProps {
  data: RatingDistribution[]
}

const RATING_COLORS: Record<string, string> = {
  again: '#ef4444',
  hard: '#f97316',
  good: '#22c55e',
  easy: '#3b82f6',
}

export function RatingDistributionChart({ data }: RatingDistributionChartProps) {
  const { t } = useTranslation('history')
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <h3 className="text-sm font-medium text-gray-700">{t('charts.ratingDistribution')}</h3>
        <span className="text-xs text-gray-400">{t('charts.ratingTotal', { count: total })}</span>
      </div>
      {total === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('charts.noRatingData')}</p>
      ) : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="50%" height={180}>
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="rating"
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                paddingAngle={2}
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.rating}
                    fill={RATING_COLORS[entry.rating] ?? '#9ca3af'}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [
                  t('chart.countPercent', { count: Number(value), percent: Math.round((Number(value) / total) * 100) }),
                  t(`ratings.${String(name)}`, { defaultValue: String(name) }),
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-2">
            {data.map((entry) => (
              <div key={entry.rating} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: RATING_COLORS[entry.rating] ?? '#9ca3af' }}
                />
                <span className="text-xs text-gray-600 flex-1">
                  {t(`ratings.${entry.rating}`, { defaultValue: entry.rating })}
                </span>
                <span className="text-xs font-medium text-gray-900">{entry.count}</span>
                <span className="text-xs text-gray-400 w-10 text-right">{entry.percentage}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
