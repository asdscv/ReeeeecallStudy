import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import { formatDateKeyShort } from '../../lib/date-utils'
import type { AdminRecentActivity } from '../../types/database'

interface RecentActivityChartProps {
  data: AdminRecentActivity[]
}

export function RecentActivityChart({ data }: RecentActivityChartProps) {
  const { t, i18n } = useTranslation('admin')
  const dateLocale = i18n.language?.startsWith('ko') ? 'ko-KR' : 'en-US'

  const chartData = data.map((d) => ({
    ...d,
    label: formatDateKeyShort(d.date, dateLocale),
  }))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('overview.recentActivity')}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={35} />
            <Tooltip
              labelFormatter={(_label, payload) => {
                const item = payload?.[0] as { payload?: { date?: string } } | undefined
                return item?.payload?.date ?? ''
              }}
            />
            <Legend />
            <Bar dataKey="sessions" name={t('study.sessions')} fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="active_users" name={t('overview.activeUsers')} fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
