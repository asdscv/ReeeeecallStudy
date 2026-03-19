import type { ReviewStats } from '../../types/database'
import { StarRating } from './StarRating'

interface RatingDistributionProps {
  stats: ReviewStats
}

export function RatingDistribution({ stats }: RatingDistributionProps) {
  const { avg_rating, review_count, rating_1, rating_2, rating_3, rating_4, rating_5 } = stats
  const distribution = [
    { stars: 5, count: rating_5 },
    { stars: 4, count: rating_4 },
    { stars: 3, count: rating_3 },
    { stars: 2, count: rating_2 },
    { stars: 1, count: rating_1 },
  ]

  return (
    <div className="flex gap-6 items-start">
      {/* Big number + stars */}
      <div className="text-center shrink-0">
        <div className="text-4xl font-bold text-gray-900">{avg_rating.toFixed(1)}</div>
        <StarRating rating={avg_rating} size="md" />
        <div className="text-sm text-gray-500 mt-1">
          {review_count} review{review_count !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex-1 space-y-1.5">
        {distribution.map(({ stars, count }) => {
          const pct = review_count > 0 ? (count / review_count) * 100 : 0
          return (
            <div key={stars} className="flex items-center gap-2 text-sm">
              <span className="w-4 text-right text-gray-600 font-medium">{stars}</span>
              <span className="text-yellow-400 text-xs">{'\u2605'}</span>
              <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-400 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-10 text-right text-gray-400 text-xs">
                {pct > 0 ? `${Math.round(pct)}%` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
