import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { StarRating } from './StarRating'
import type { MarketplaceReview } from '../../types/database'

interface ReviewFormProps {
  existingReview?: MarketplaceReview | null
  submitting: boolean
  onSubmit: (rating: number, title?: string, body?: string) => void
  onDelete?: () => void
  onCancel?: () => void
}

export function ReviewForm({
  existingReview,
  submitting,
  onSubmit,
  onDelete,
  onCancel,
}: ReviewFormProps) {
  const { t } = useTranslation('marketplace')
  const [rating, setRating] = useState(existingReview?.rating ?? 0)
  const [title, setTitle] = useState(existingReview?.title ?? '')
  const [body, setBody] = useState(existingReview?.body ?? '')

  useEffect(() => {
    if (existingReview) {
      setRating(existingReview.rating)
      setTitle(existingReview.title ?? '')
      setBody(existingReview.body ?? '')
    }
  }, [existingReview])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (rating === 0) return
    onSubmit(rating, title.trim() || undefined, body.trim() || undefined)
  }

  const isEditing = !!existingReview

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          {t('reviews.yourRating', { defaultValue: 'Your Rating' })}
        </label>
        <StarRating rating={rating} size="lg" interactive onChange={setRating} />
        {rating === 0 && (
          <p className="text-xs text-destructive mt-1">
            {t('reviews.ratingRequired', { defaultValue: 'Please select a rating' })}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="review-title" className="block text-sm font-medium text-foreground mb-1">
          {t('reviews.titleLabel', { defaultValue: 'Title (optional)' })}
        </label>
        <input
          id="review-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('reviews.titlePlaceholder', { defaultValue: 'Summarize your experience' })}
          maxLength={100}
          className="w-full px-3 py-2 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-sm"
        />
      </div>

      <div>
        <label htmlFor="review-body" className="block text-sm font-medium text-foreground mb-1">
          {t('reviews.bodyLabel', { defaultValue: 'Review (optional)' })}
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('reviews.bodyPlaceholder', { defaultValue: 'What did you like or dislike about this deck?' })}
          rows={4}
          maxLength={2000}
          className="w-full px-3 py-2 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-sm resize-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || rating === 0}
          className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand transition disabled:opacity-50 cursor-pointer"
        >
          {submitting
            ? t('reviews.submitting', { defaultValue: 'Submitting...' })
            : isEditing
              ? t('reviews.updateReview', { defaultValue: 'Update Review' })
              : t('reviews.submitReview', { defaultValue: 'Submit Review' })}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2 text-muted-foreground hover:text-foreground text-sm cursor-pointer"
          >
            {t('common:cancel', { defaultValue: 'Cancel' })}
          </button>
        )}

        {isEditing && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="px-5 py-2 text-destructive hover:text-destructive text-sm ml-auto cursor-pointer"
          >
            {t('reviews.deleteReview', { defaultValue: 'Delete Review' })}
          </button>
        )}
      </div>
    </form>
  )
}
