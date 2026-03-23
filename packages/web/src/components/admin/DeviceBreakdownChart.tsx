import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import type { DeviceBreakdownItem } from '../../lib/admin-stats'

const COLORS: Record<string, string> = {
  mobile: '#3b82f6',
  tablet: '#f59e0b',
  desktop: '#10b981',
}

interface DeviceBreakdownChartProps {
  data: DeviceBreakdownItem[]
}

export function DeviceBreakdownChart({ data }: DeviceBreakdownChartProps) {
  const { t } = useTranslation('admin')

  // Translate device names for both labels and legend
  const translatedData = data.map((item) => ({
    ...item,
    name: t(`contents.deviceTypes.${item.device}`, { defaultValue: item.device }),
  }))

  return (
    <div className="bg-card rounded-xl border border-border p-3 sm:p-5">
      <h3 className="text-sm font-medium text-foreground mb-3">{t('contents.deviceBreakdown')}</h3>
      {translatedData.length === 0 ? (
        <p className="text-sm text-content-tertiary py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={translatedData}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={(props) => `${props.name ?? ''} (${((props.percent ?? 0) * 100).toFixed(0)}%)`}
            >
              {translatedData.map((item) => (
                <Cell key={item.device} fill={COLORS[item.device] ?? '#6b7280'} />
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
