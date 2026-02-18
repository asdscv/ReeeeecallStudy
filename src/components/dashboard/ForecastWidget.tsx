import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useTranslation } from 'react-i18next'
import { localDateKeyToDate, formatDateKeyShort } from '../../lib/date-utils'

interface ForecastWidgetProps {
  data: { date: string; count: number }[]
}

export function ForecastWidget({ data }: ForecastWidgetProps) {
  const { t, i18n } = useTranslation('dashboard')
  // Format date labels as short weekday
  const locale = i18n.language === 'ko' ? 'ko-KR' : 'en-US'
  const chartData = data.map((d) => {
    const date = localDateKeyToDate(d.date)
    const dayLabel = date.toLocaleDateString(locale, { weekday: 'short' })
    const dateLabel = formatDateKeyShort(d.date, locale)
    return { ...d, label: `${dateLabel}(${dayLabel})` }
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-2 sm:mb-3">{t('forecast.title')}</h3>
      {data.every((d) => d.count === 0) ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('forecast.noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={25} />
            <Tooltip
              formatter={(value) => [t('forecast.tooltipCards', { value }), t('forecast.tooltipLabel')]}
              labelFormatter={(label) => String(label)}
            />
            <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
