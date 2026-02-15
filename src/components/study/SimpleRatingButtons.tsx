import type { StudyMode } from '../../types/database'

interface SimpleRatingButtonsProps {
  mode: StudyMode
  onRate: (rating: string) => void
}

export function SimpleRatingButtons({ mode, onRate }: SimpleRatingButtonsProps) {
  if (mode === 'sequential_review') {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => onRate('unknown')}
          className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium transition cursor-pointer"
        >
          모름
        </button>
        <button
          onClick={() => onRate('known')}
          className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-medium transition cursor-pointer"
        >
          알고 있음
        </button>
      </div>
    )
  }

  // random / sequential: just "다음" button
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onRate('next')}
        className="flex-1 px-4 sm:px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition cursor-pointer"
      >
        다음 →
      </button>
    </div>
  )
}
