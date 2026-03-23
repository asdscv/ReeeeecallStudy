import { useTranslation } from 'react-i18next'
import { StarRating } from './StarRating'
import type { MarketplaceReview } from '../../types/database'

interface ReviewCardProps {
  review: MarketplaceReview
  isHelpful: boolean
  isOwnReview: boolean
  onMarkHelpful: (reviewId: string) => void
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function ReviewCard({ review, isHelpful, isOwnReview, onMarkHelpful }: ReviewCardProps) {
  const { t } = useTranslation('marketplace')

  return (
    <div className="py-4 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Header: user name + rating */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-foreground">
              {review.user_display_name || t('reviews.anonymous', { defaultValue: 'Anonymous' })}
            </span>
            <StarRating rating={review.rating} size="sm" />
            {review.is_edited && (
              <span className="text-xs text-content-tertiary">
                ({t('reviews.edited', { defaultValue: 'edited' })})
              </span>
            )}
          </div>

          {/* Date */}
          <div className="text-xs text-content-tertiary mb-2">{formatDate(review.created_at)}</div>

          {/* Title */}
          {review.title && (
            <h4 className="text-sm font-semibold text-foreground mb-1">{review.title}</h4>
          )}

          {/* Body */}
          {review.body && (
            <p className="text-sm text-muted-foreground whitespace-pre-line">{review.body}</p>
          )}

          {/* Helpful button */}
          <div className="mt-2">
            <button
              onClick={() => onMarkHelpful(review.id)}
              disabled={isHelpful || isOwnReview}
              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition cursor-pointer ${
                isHelpful
                  ? 'bg-brand/10 border-brand/30 text-brand'
                  : 'bg-card border-border text-muted-foreground hover:bg-muted'
              } ${isOwnReview ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span>{isHelpful ? '\u{1F44D}' : '\u{1F44D}'}</span>
              <span>
                {t('reviews.helpful', { defaultValue: 'Helpful' })}
                {review.helpful_count > 0 && ` (${review.helpful_count})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
