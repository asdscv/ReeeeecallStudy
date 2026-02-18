import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { formatDateKeyShort } from '../../lib/date-utils'
import type { DailySessionCount } from '../../lib/study-history-stats'

interface StudyVolumeChartProps {
  data: DailySessionCount[]
}

export function StudyVolumeChart({ data }: StudyVolumeChartProps) {
  const { t } = useTranslation('history')

  const tickInterval = Math.max(1, Math.floor(data.length / 6))

  const chartData = data

  const tickDates = data
    .filter((_, i) => i % tickInterval === 0 || i === data.length - 1)
    .map((d) => d.date)

  const totalSessions = data.reduce((s, d) => s + d.sessions, 0)
  const totalCards = data.reduce((s, d) => s + d.cards, 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5">
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <h3 className="text-sm font-medium text-gray-700">{t('charts.studyVolume')}</h3>
        <span className="text-xs text-gray-400">{t('charts.volumeSummary', { sessions: totalSessions, cards: totalCards })}</span>
      </div>
      {totalSessions === 0 ? (
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
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={25} />
            <Tooltip
              formatter={(value, name) => [
                name === 'sessions' ? t('units.sessions', { count: Number(value) }) : t('units.cards', { count: Number(value) }),
                name === 'sessions' ? t('units.sessions') : t('units.cards'),
              ]}
              labelFormatter={(_label, payload) => {
                const item = payload?.[0] as { payload?: { date?: string } } | undefined
                return item?.payload?.date ?? ''
              }}
            />
            <Legend
              formatter={(value: string) => (value === 'sessions' ? t('units.sessions') : t('units.cards'))}
              wrapperStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="sessions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="cards" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
