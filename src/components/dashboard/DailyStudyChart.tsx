import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '../../lib/locale-utils'
import { formatDateKeyShort } from '../../lib/date-utils'

interface DailyStudyChartProps {
  data: { date: string; count: number }[]
  title?: string
}

export function DailyStudyChart({ data, title }: DailyStudyChartProps) {
  const { t, i18n } = useTranslation('dashboard')
  const dateLocale = toIntlLocale(i18n.language)
  const displayTitle = title ?? t('dailyChart.title')
  const tickInterval = Math.max(1, Math.floor(data.length / 6))

  const chartData = data.map((d, i) => {
    const label = i % tickInterval === 0 || i === data.length - 1
      ? formatDateKeyShort(d.date, dateLocale)
      : ''
    return { ...d, label }
  })

  const totalStudied = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <h3 className="text-sm font-medium text-gray-700">{displayTitle}</h3>
        <span className="text-xs text-gray-400">{t('dailyChart.total', { count: totalStudied })}</span>
      </div>
      {totalStudied === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('dailyChart.noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={25} />
            <Tooltip
              formatter={(value) => [t('dailyChart.tooltipTimes', { value }), t('dailyChart.tooltipLabel')]}
              labelFormatter={(_label, payload) => {
                const item = payload?.[0] as { payload?: { date?: string } } | undefined
                if (item?.payload?.date) return formatDateKeyShort(item.payload.date, dateLocale)
                return ''
              }}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
