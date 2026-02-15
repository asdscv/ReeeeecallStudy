import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import type { Card, StudyLog } from '../../types/database'
import { calculateDeckStats, getDailyStudyCounts, fetchDeckStudyLogs } from '../../lib/stats'

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
  const [studyLogs, setStudyLogs] = useState<StudyLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const logs = await fetchDeckStudyLogs(deckId, thirtyDaysAgo.toISOString())
      setStudyLogs(logs)
      setLoading(false)
    }
    load()
  }, [deckId])

  const stats = calculateDeckStats(cards)
  const dailyData = getDailyStudyCounts(studyLogs)

  const pieData = [
    { name: 'New', value: stats.newCount, color: STATUS_COLORS.new },
    { name: 'Learning', value: stats.learningCount, color: STATUS_COLORS.learning },
    { name: 'Review', value: stats.reviewCount, color: STATUS_COLORS.review },
  ].filter((d) => d.value > 0)

  return (
    <div className="space-y-6">
      {/* Summary grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="전체 카드" value={stats.totalCards} />
        <StatCard label="숙달률" value={`${stats.masteryRate}%`} />
        <StatCard label="평균 쉬움도" value={stats.avgEase.toFixed(2)} />
        <StatCard label="평균 간격" value={`${stats.avgInterval}일`} />
      </div>

      {/* Status distribution pie chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-3">상태 분포</h3>
        {stats.totalCards === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">카드가 없습니다</p>
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
                <Tooltip formatter={(value) => [`${value}장`]} />
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
                  <span className="text-gray-400">{d.value}장</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Daily study chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-3">일별 학습량 (30일)</h3>
        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center animate-pulse">로딩 중...</p>
        ) : studyLogs.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">학습 기록이 없습니다</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(val: string) => {
                  const d = new Date(val + 'T00:00:00')
                  return `${d.getMonth() + 1}/${d.getDate()}`
                }}
                interval={4}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={30} />
              <Tooltip
                formatter={(value) => [`${value}회`, '학습']}
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
