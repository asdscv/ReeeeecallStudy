import { useTranslation } from 'react-i18next'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { RATING_COLOR_MAP } from '../../lib/rating-groups'
import type { GroupedRatingDistribution } from '../../lib/study-history-stats'

interface RatingDistributionChartProps {
  data: GroupedRatingDistribution[]
}

export function RatingDistributionChart({ data }: RatingDistributionChartProps) {
  const { t } = useTranslation('history')
  const grandTotal = data.reduce((s, g) => s + g.total, 0)
  const compact = data.length > 1

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <h3 className="text-sm font-medium text-gray-700">{t('charts.ratingDistribution')}</h3>
        <span className="text-xs text-gray-400">{t('charts.ratingTotal', { count: grandTotal })}</span>
      </div>
      {grandTotal === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('charts.noRatingData')}</p>
      ) : (
        <div className="space-y-4">
          {data.map((group) => (
            <GroupSection key={group.groupId} group={group} showLabel={compact} compact={compact} />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupSection({ group, showLabel, compact }: { group: GroupedRatingDistribution; showLabel: boolean; compact: boolean }) {
  const { t } = useTranslation('history')

  const chartHeight = compact ? 130 : 180
  const innerRadius = compact ? 28 : 40
  const outerRadius = compact ? 52 : 70

  return (
    <div>
      {showLabel && (
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-semibold text-gray-500">{t(group.i18nKey)}</span>
          <span className="text-[10px] text-gray-400">{group.total}</span>
        </div>
      )}
      <div className="flex items-center gap-4">
        <ResponsiveContainer width="50%" height={chartHeight}>
          <PieChart>
            <Pie
              data={group.ratings}
              dataKey="count"
              nameKey="rating"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={2}
            >
              {group.ratings.map((entry) => (
                <Cell
                  key={entry.rating}
                  fill={RATING_COLOR_MAP[entry.rating] ?? '#9ca3af'}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [
                t('chart.countPercent', { count: Number(value), percent: Math.round((Number(value) / group.total) * 100) }),
                t(`ratings.${String(name)}`, { defaultValue: String(name) }),
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-1.5">
          {group.ratings.map((entry) => (
            <div key={entry.rating} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: RATING_COLOR_MAP[entry.rating] ?? '#9ca3af' }}
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
    </div>
  )
}
