import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import type { ReferrerBreakdownItem } from '../../lib/admin-stats'

const COLORS: Record<string, string> = {
  direct: '#3b82f6',
  search: '#10b981',
  social: '#f59e0b',
  internal: '#8b5cf6',
  other: '#6b7280',
}

interface ReferrerBreakdownChartProps {
  data: ReferrerBreakdownItem[]
}

export function ReferrerBreakdownChart({ data }: ReferrerBreakdownChartProps) {
  const { t } = useTranslation('admin')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('contents.referrerBreakdown')}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="category"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ category, percentage }) => `${category} (${percentage}%)`}
            >
              {data.map((item) => (
                <Cell key={item.category} fill={COLORS[item.category] ?? '#6b7280'} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => [Number(value), t('contents.views')]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
