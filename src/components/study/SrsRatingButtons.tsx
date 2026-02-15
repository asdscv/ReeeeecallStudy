import type { Card, SrsSettings } from '../../types/database'
import { previewIntervals, type SrsRating } from '../../lib/srs'

interface SrsRatingButtonsProps {
  card: Card
  srsSettings?: SrsSettings | null
  onRate: (rating: SrsRating) => void
}

const buttons: { rating: SrsRating; label: string; key: string; color: string }[] = [
  { rating: 'again', label: 'Again', key: '1', color: 'bg-red-500 hover:bg-red-600' },
  { rating: 'hard', label: 'Hard', key: '2', color: 'bg-amber-500 hover:bg-amber-600' },
  { rating: 'good', label: 'Good', key: '3', color: 'bg-blue-500 hover:bg-blue-600' },
  { rating: 'easy', label: 'Easy', key: '4', color: 'bg-green-500 hover:bg-green-600' },
]

export function SrsRatingButtons({ card, srsSettings, onRate }: SrsRatingButtonsProps) {
  const intervals = previewIntervals(card, srsSettings ?? undefined)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
      {buttons.map((btn) => (
        <button
          key={btn.rating}
          onClick={() => onRate(btn.rating)}
          className={`py-3 sm:py-4 text-white rounded-lg font-medium transition-colors flex flex-col items-center gap-0.5 sm:gap-1 cursor-pointer ${btn.color}`}
        >
          <span className="text-base sm:text-lg">{btn.label}</span>
          <span className="text-xs opacity-80">{intervals[btn.rating]}</span>
        </button>
      ))}
    </div>
  )
}
