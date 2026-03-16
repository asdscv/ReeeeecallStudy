import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useTranslation } from 'react-i18next'
import type { ConversionFunnelStep } from '../../lib/admin-stats'

interface ConversionFunnelChartProps {
  data: ConversionFunnelStep[]
}

export function ConversionFunnelChart({ data }: ConversionFunnelChartProps) {
  const { t } = useTranslation('admin')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('contents.conversionFunnel')}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={120} />
            <Tooltip formatter={(value) => [Number(value), t('contents.users')]} />
            <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
