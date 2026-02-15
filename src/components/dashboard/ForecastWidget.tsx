import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { localDateKeyToDate, formatDateKeyShort } from '../../lib/date-utils'

interface ForecastWidgetProps {
  data: { date: string; count: number }[]
}

export function ForecastWidget({ data }: ForecastWidgetProps) {
  // Format date labels as short weekday (월, 화, ...)
  const chartData = data.map((d) => {
    const date = localDateKeyToDate(d.date)
    const dayLabel = date.toLocaleDateString('ko-KR', { weekday: 'short' })
    const dateLabel = formatDateKeyShort(d.date)
    return { ...d, label: `${dateLabel}(${dayLabel})` }
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-medium text-gray-700 mb-3">복습 예측 (7일)</h3>
      {data.every((d) => d.count === 0) ? (
        <p className="text-sm text-gray-400 py-8 text-center">예정된 복습이 없습니다</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={30} />
            <Tooltip
              formatter={(value) => [`${value}장`, '복습 예정']}
              labelFormatter={(label) => String(label)}
            />
            <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
