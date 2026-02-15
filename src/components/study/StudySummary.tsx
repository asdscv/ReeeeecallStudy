interface StudySummaryProps {
  stats: {
    totalCards: number
    cardsStudied: number
    ratings: Record<string, number>
    totalDurationMs: number
  }
  onBackToDeck: () => void
  onStudyAgain: () => void
}

export function StudySummary({ stats, onBackToDeck, onStudyAgain }: StudySummaryProps) {
  const minutes = Math.floor(stats.totalDurationMs / 60000)
  const seconds = Math.floor((stats.totalDurationMs % 60000) / 1000)
  const avgMs = stats.cardsStudied > 0
    ? Math.round(stats.totalDurationMs / stats.cardsStudied / 1000)
    : 0

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full mx-auto px-4 sm:px-6 text-center">
        <div className="text-4xl sm:text-5xl mb-4 sm:mb-6">🎉</div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">학습 완료!</h1>
        <p className="text-gray-500 mb-6 sm:mb-8">수고하셨습니다</p>

        <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 mb-6 sm:mb-8 space-y-3 sm:space-y-4">
          <StatRow label="학습 카드" value={`${stats.cardsStudied} / ${stats.totalCards}장`} />
          <StatRow label="소요 시간" value={`${minutes}분 ${seconds}초`} />
          <StatRow label="카드당 평균" value={`${avgMs}초`} />

          {Object.keys(stats.ratings).length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-sm text-gray-400 mb-2">평가 분포</p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                {Object.entries(stats.ratings).map(([rating, count]) => (
                  <span
                    key={rating}
                    className={`px-3 py-1 rounded-full text-sm font-medium ${ratingColor(rating)}`}
                  >
                    {ratingLabel(rating)} {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            onClick={onBackToDeck}
            className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-xl font-medium transition cursor-pointer text-sm sm:text-base"
          >
            덱으로 돌아가기
          </button>
          <button
            onClick={onStudyAgain}
            className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition cursor-pointer text-sm sm:text-base"
          >
            다시 학습
          </button>
        </div>
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  )
}

function ratingLabel(rating: string): string {
  const map: Record<string, string> = {
    again: 'Again',
    hard: 'Hard',
    good: 'Good',
    easy: 'Easy',
    known: '알고 있음',
    unknown: '모름',
    next: '다음',
  }
  return map[rating] ?? rating
}

function ratingColor(rating: string): string {
  const map: Record<string, string> = {
    again: 'bg-red-50 text-red-700',
    hard: 'bg-amber-50 text-amber-700',
    good: 'bg-blue-50 text-blue-700',
    easy: 'bg-green-50 text-green-700',
    known: 'bg-green-50 text-green-700',
    unknown: 'bg-red-50 text-red-700',
    next: 'bg-gray-100 text-gray-700',
  }
  return map[rating] ?? 'bg-gray-100 text-gray-700'
}
