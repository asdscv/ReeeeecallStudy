interface StatsSummaryCardsProps {
  totalCards: number
  dueToday: number
  streak: number
  masteryRate: number
}

export function StatsSummaryCards({ totalCards, dueToday, streak, masteryRate }: StatsSummaryCardsProps) {
  const items = [
    { label: '전체 카드', value: totalCards, color: 'text-gray-900' },
    { label: '오늘 복습', value: dueToday, color: 'text-amber-600' },
    { label: '연속 학습', value: `${streak}일`, color: 'text-green-600' },
    { label: '숙달률', value: `${masteryRate}%`, color: 'text-blue-600' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-white rounded-xl border border-gray-200 p-5"
        >
          <p className="text-sm text-gray-500 mb-1">{item.label}</p>
          <p className={`text-3xl font-bold ${item.color}`}>{item.value}</p>
        </div>
      ))}
    </div>
  )
}
