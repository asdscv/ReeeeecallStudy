import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useReviewsStore } from '../../stores/reviews-store'
import { useAuthStore } from '../../stores/auth-store'
import { RatingDistribution } from './RatingDistribution'
import { ReviewForm } from './ReviewForm'
import { ReviewCard } from './ReviewCard'
import type { ReviewSortBy } from '../../types/database'

interface ReviewsSectionProps {
  listingId: string
  isOwner: boolean
  hasAcquired: boolean
}

const SORT_OPTIONS: { value: ReviewSortBy; labelKey: string }[] = [
  { value: 'newest', labelKey: 'reviews.sortNewest' },
  { value: 'highest', labelKey: 'reviews.sortHighest' },
  { value: 'lowest', labelKey: 'reviews.sortLowest' },
  { value: 'most_helpful', labelKey: 'reviews.sortHelpful' },
]

export function ReviewsSection({ listingId, isOwner, hasAcquired }: ReviewsSectionProps) {
  const { t } = useTranslation('marketplace')
  const { user } = useAuthStore()
  const {
    reviews,
    stats,
    userReview,
    userHelpfuls,
    loading,
    submitting,
    error,
    sortBy,
    hasMore,
    fetchReviews,
    fetchStats,
    fetchUserReview,
    submitReview,
    deleteReview,
    markHelpful,
    setSortBy,
    loadMore,
    reset,
  } = useReviewsStore()

  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    reset()
    fetchStats(listingId)
    fetchReviews(listingId)
    if (user) {
      fetchUserReview(listingId)
    }

    return () => reset()
  }, [listingId, user, fetchStats, fetchReviews, fetchUserReview, reset])

  const handleSortChange = useCallback((newSort: ReviewSortBy) => {
    setSortBy(newSort)
    fetchReviews(listingId)
  }, [listingId, setSortBy, fetchReviews])

  const handleSubmit = useCallback(async (rating: number, title?: string, body?: string) => {
    const success = await submitReview(listingId, rating, title, body)
    if (success) {
      setShowForm(false)
    }
  }, [listingId, submitReview])

  const handleDelete = useCallback(async () => {
    if (!userReview) return
    const confirmed = window.confirm(t('reviews.deleteConfirm', { defaultValue: 'Delete your review? This cannot be undone.' }))
    if (!confirmed) return
    await deleteReview(userReview.id)
    setShowForm(false)
  }, [userReview, deleteReview, t])

  const canWriteReview = !!user && !isOwner && hasAcquired

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-foreground">
          {t('reviews.title', { defaultValue: 'Ratings & Reviews' })}
        </h2>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Rating distribution */}
        {stats && stats.review_count > 0 && (
          <RatingDistribution stats={stats} />
        )}

        {stats && stats.review_count === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('reviews.noReviews', { defaultValue: 'No reviews yet. Be the first to review!' })}
          </p>
        )}

        {/* Write review section */}
        {canWriteReview && (
          <div className="border-t border-border pt-4">
            {!showForm && !userReview && (
              <button
                onClick={() => setShowForm(true)}
                className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand transition cursor-pointer"
              >
                {t('reviews.writeReview', { defaultValue: 'Write a Review' })}
              </button>
            )}

            {(showForm || userReview) && (
              <ReviewForm
                existingReview={userReview}
                submitting={submitting}
                onSubmit={handleSubmit}
                onDelete={userReview ? handleDelete : undefined}
                onCancel={() => setShowForm(false)}
              />
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Sort controls + Review list */}
        {stats && stats.review_count > 0 && (
          <>
            <div className="flex items-center gap-2 border-t border-border pt-4">
              <span className="text-xs text-muted-foreground">
                {t('reviews.sortLabel', { defaultValue: 'Sort by:' })}
              </span>
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleSortChange(opt.value)}
                  className={`px-3 py-1 text-xs rounded-full border transition cursor-pointer ${
                    sortBy === opt.value
                      ? 'bg-brand/10 border-brand/30 text-brand font-medium'
                      : 'bg-card border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t(opt.labelKey, { defaultValue: opt.value })}
                </button>
              ))}
            </div>

            <div className="divide-y divide-border">
              {reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  isHelpful={userHelpfuls.has(review.id)}
                  isOwnReview={review.user_id === user?.id}
                  onMarkHelpful={markHelpful}
                />
              ))}
            </div>

            {loading && (
              <div className="text-center py-4">
                <span className="text-sm text-content-tertiary">
                  {t('reviews.loading', { defaultValue: 'Loading...' })}
                </span>
              </div>
            )}

            {hasMore && !loading && (
              <button
                onClick={() => loadMore(listingId)}
                className="w-full py-2 text-sm text-brand hover:text-brand font-medium cursor-pointer"
              >
                {t('reviews.loadMore', { defaultValue: 'Load more reviews' })}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
