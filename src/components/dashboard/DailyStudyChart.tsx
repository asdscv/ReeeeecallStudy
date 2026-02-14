import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface DailyStudyChartProps {
  data: { date: string; count: number }[]
}

export function DailyStudyChart({ data }: DailyStudyChartProps) {
  // Show tick labels every 5 days to avoid clutter
  const chartData = data.map((d, i) => {
    const date = new Date(d.date + 'T00:00:00')
    const label = i % 5 === 0 || i === data.length - 1
      ? `${date.getMonth() + 1}/${date.getDate()}`
      : ''
    return { ...d, label }
  })

  const totalStudied = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">일별 학습량 (30일)</h3>
        <span className="text-xs text-gray-400">총 {totalStudied}회</span>
      </div>
      {totalStudied === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">아직 학습 기록이 없습니다</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={30} />
            <Tooltip
              formatter={(value) => [`${value}회`, '학습']}
              labelFormatter={(_label, payload) => {
                const item = payload?.[0] as { payload?: { date?: string } } | undefined
                if (item?.payload?.date) return item.payload.date
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
