import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useTranslation } from 'react-i18next'
import { formatDateKeyShort } from '../../lib/date-utils'
import type { UserGrowthPoint } from '../../lib/admin-stats'

interface UserGrowthChartProps {
  data: UserGrowthPoint[]
}

export function UserGrowthChart({ data }: UserGrowthChartProps) {
  const { t, i18n } = useTranslation('admin')
  const dateLocale = i18n.language?.startsWith('ko') ? 'ko-KR' : 'en-US'
  const tickInterval = Math.max(1, Math.floor(data.length / 6))

  const chartData = data.map((d, i) => ({
    ...d,
    label: i % tickInterval === 0 || i === data.length - 1
      ? formatDateKeyShort(d.date, dateLocale)
      : '',
  }))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('users.userGrowth')}</h3>
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
                const item = payload?.[0] as { payload?: { date?: string } } | undefined
                return item?.payload?.date ?? ''
              }}
            />
            <Area type="monotone" dataKey="cumulative" fill="#3b82f6" fillOpacity={0.2} stroke="#3b82f6" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
