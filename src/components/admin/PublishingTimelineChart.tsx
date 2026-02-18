import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import type { PublishingTimelinePoint } from '../../lib/admin-stats'

interface PublishingTimelineChartProps {
  data: PublishingTimelinePoint[]
}

export function PublishingTimelineChart({ data }: PublishingTimelineChartProps) {
  const { t } = useTranslation('admin')
  const tickInterval = Math.max(1, Math.floor(data.length / 6))

  const chartData = data.map((d, i) => ({
    ...d,
    label: i % tickInterval === 0 || i === data.length - 1
      ? d.month
      : '',
  }))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('contents.publishingTimeline')}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={35} />
            <Tooltip
              labelFormatter={(_label, payload) => {
                const item = payload?.[0] as { payload?: { month?: string } } | undefined
                return item?.payload?.month ?? ''
              }}
            />
            <Legend />
            <Area type="monotone" dataKey="cumulative" name={t('contents.cumulative')} fill="#3b82f6" fillOpacity={0.2} stroke="#3b82f6" />
            <Area type="monotone" dataKey="count" name={t('contents.count')} fill="#f59e0b" fillOpacity={0.15} stroke="#f59e0b" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
