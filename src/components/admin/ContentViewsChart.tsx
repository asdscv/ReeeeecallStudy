import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '../../lib/locale-utils'
import { formatDateKeyShort } from '../../lib/date-utils'
import type { DailyViewPoint } from '../../lib/admin-stats'

interface ContentViewsChartProps {
  data: DailyViewPoint[]
}

export function ContentViewsChart({ data }: ContentViewsChartProps) {
  const { t, i18n } = useTranslation('admin')
  const dateLocale = toIntlLocale(i18n.language)
  const tickInterval = Math.max(1, Math.floor(data.length / 6))

  const chartData = data.map((d, i) => ({
    ...d,
    label: i % tickInterval === 0 || i === data.length - 1
      ? formatDateKeyShort(d.date, dateLocale)
      : '',
  }))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('contents.dailyViews')}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={35} />
            <Tooltip
              labelFormatter={(_label, payload) => {
                const item = payload?.[0] as { payload?: { date?: string } } | undefined
                if (item?.payload?.date) return formatDateKeyShort(item.payload.date, dateLocale)
                return ''
              }}
            />
            <Legend />
            <Bar dataKey="views" name={t('contents.views')} fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="unique_viewers" name={t('contents.uniqueLabel')} fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
