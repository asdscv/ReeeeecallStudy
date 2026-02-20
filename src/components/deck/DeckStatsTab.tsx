import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '../../lib/locale-utils'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import type { Card, StudyLog } from '../../types/database'
import { calculateDeckStats, getDailyStudyCounts, fetchDeckStudyLogs } from '../../lib/stats'
import { daysAgoUTC, formatDateKeyShort } from '../../lib/date-utils'

interface DeckStatsTabProps {
  deckId: string
  cards: Card[]
}

const STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6',
  learning: '#f59e0b',
  review: '#22c55e',
  suspended: '#9ca3af',
}

export function DeckStatsTab({ deckId, cards }: DeckStatsTabProps) {
  const { t, i18n } = useTranslation('decks')
  const dateLocale = toIntlLocale(i18n.language)
  const [studyLogs, setStudyLogs] = useState<StudyLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const logs = await fetchDeckStudyLogs(deckId, daysAgoUTC(30))
      setStudyLogs(logs)
      setLoading(false)
    }
    load()
  }, [deckId])

  const stats = calculateDeckStats(cards)
  const dailyData = getDailyStudyCounts(studyLogs)

  const pieData = [
    { name: t('common:status.new'), value: stats.newCount, color: STATUS_COLORS.new },
    { name: t('common:status.learning'), value: stats.learningCount, color: STATUS_COLORS.learning },
    { name: t('common:status.review'), value: stats.reviewCount, color: STATUS_COLORS.review },
  ].filter((d) => d.value > 0)

  return (
    <div className="space-y-6">
      {/* Summary grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label={t('stats.totalCards')} value={stats.totalCards} />
        <StatCard label={t('stats.masteryRate')} value={`${stats.masteryRate}%`} />
        <StatCard label={t('stats.avgEase')} value={stats.avgEase.toFixed(2)} />
        <StatCard label={t('stats.avgInterval')} value={t('stats.days', { count: stats.avgInterval })} />
      </div>

      {/* Status distribution pie chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-3">{t('stats.statusDistribution')}</h3>
        {stats.totalCards === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">{t('stats.noCards')}</p>
        ) : (
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [t('stats.cardCount', { count: Number(value) })]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {pieData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="text-gray-700">{d.name}</span>
                  <span className="text-gray-400">{t('stats.cardCount', { count: d.value })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Daily study chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-3">{t('stats.dailyStudy')}</h3>
        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center animate-pulse">{t('stats.loading')}</p>
        ) : studyLogs.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">{t('stats.noStudyRecords')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(val: string) => formatDateKeyShort(val, dateLocale)}
                interval={4}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={30} />
              <Tooltip
                formatter={(value) => [t('stats.studyCount', { count: Number(value) }), t('stats.study')]}
                labelFormatter={(label) => String(label)}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
