import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslation } from 'react-i18next'
import type { UtmSourceBreakdownItem } from '../../lib/admin-stats'

interface UtmSourceChartProps {
  data: UtmSourceBreakdownItem[]
  ctaClicks: number
}

export function UtmSourceChart({ data, ctaClicks }: UtmSourceChartProps) {
  const { t } = useTranslation('admin')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">{t('contents.utmSources')}</h3>
        {ctaClicks > 0 && (
          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
            CTA clicks: {ctaClicks.toLocaleString()}
          </span>
        )}
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
            <XAxis type="number" />
            <YAxis type="category" dataKey="source" width={60} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value) => [Number(value), t('contents.views')]}
              labelFormatter={(label) => `${label}`}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
