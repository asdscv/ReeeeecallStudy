import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatDateKeyShort } from '../../lib/date-utils'
import { formatDuration } from '../../lib/study-history'
import type { SessionDurationPoint } from '../../lib/study-history-stats'

interface SessionDurationChartProps {
  data: SessionDurationPoint[]
}

export function SessionDurationChart({ data }: SessionDurationChartProps) {
  const { t } = useTranslation('history')

  const tickInterval = Math.max(1, Math.floor(data.length / 6))

  const chartData = data.map((d) => ({
    ...d,
    durationMin: Math.round(d.avgDurationMs / 60000 * 10) / 10,
  }))

  const tickDates = data
    .filter((_, i) => i % tickInterval === 0 || i === data.length - 1)
    .map((d) => d.date)

  const hasData = data.some((d) => d.sessionCount > 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <h3 className="text-sm font-medium text-gray-700">{t('charts.sessionDuration')}</h3>
      </div>
      {!hasData ? (
        <p className="text-sm text-gray-400 py-8 text-center">{t('charts.noDataForPeriod')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              ticks={tickDates}
              tickFormatter={(date: string) => formatDateKeyShort(date)}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={30} unit={t('units.min')} />
            <Tooltip
              formatter={(_value, _name, props) => {
                const p = props.payload as { avgDurationMs?: number; sessionCount?: number } | undefined
                const ms = p?.avgDurationMs ?? 0
                const count = p?.sessionCount ?? 0
                return [`${formatDuration(ms)} (${t('charts.sessionCount', { count })})`, t('charts.avgDuration')]
              }}
              labelFormatter={(_label, payload) => {
                const item = payload?.[0] as { payload?: { date?: string } } | undefined
                return item?.payload?.date ?? ''
              }}
            />
            <Bar dataKey="durationMin" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
