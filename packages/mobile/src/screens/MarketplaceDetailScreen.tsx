import { useState, useEffect, useCallback, useRef } from 'react'
import { View, Text, FlatList, Alert, StyleSheet, TouchableOpacity, TextInput, Modal } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { Screen, Button, Badge, ListCard } from '../components/ui'
import { OfficialBadge } from '../components/ui/OfficialBadge'
import { useMarketplaceStore } from '@reeeeecall/shared/stores/marketplace-store'
import { useReviewsStore } from '@reeeeecall/shared/stores/reviews-store'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import { getMobileSupabase } from '../adapters'
import type { MarketplaceStackParamList } from '../navigation/types'
import type { MarketplaceReview, ReviewSortBy } from '@reeeeecall/shared/types/database'

type ReportCategory = 'inappropriate' | 'copyright' | 'spam' | 'misleading' | 'other'

const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'inappropriate', label: 'Inappropriate Content' },
  { value: 'copyright', label: 'Copyright Violation' },
  { value: 'spam', label: 'Spam' },
  { value: 'misleading', label: 'Misleading' },
  { value: 'other', label: 'Other' },
]

type Route = RouteProp<MarketplaceStackParamList, 'MarketplaceDetail'>

function renderStars(rating: number, max = 5): string {
  const filled = Math.round(rating)
  return Array.from({ length: max }, (_, i) => (i < filled ? '\u2605' : '\u2606')).join('')
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ─── Star selector for review form ───────────────────────────
function StarSelector({ rating, onChange }: { rating: number; onChange: (r: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity key={star} onPress={() => onChange(star)}>
          <Text style={{ fontSize: 28, color: star <= rating ? '#FBBF24' : '#D1D5DB' }}>
            {'\u2605'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

// ─── Review card component ───────────────────────────────────
function ReviewItem({
  review,
  isHelpful,
  isOwnReview,
  onMarkHelpful,
  theme,
}: {
  review: MarketplaceReview
  isHelpful: boolean
  isOwnReview: boolean
  onMarkHelpful: (id: string) => void
  theme: ReturnType<typeof useTheme>
}) {
  return (
    <View style={reviewStyles.card}>
      <View style={reviewStyles.reviewHeader}>
        <Text style={[theme.typography.label, { color: theme.colors.text }]}>
          {review.user_display_name || 'Anonymous'}
        </Text>
        <Text style={{ color: '#FBBF24', fontSize: 14 }}>
          {renderStars(review.rating)}
        </Text>
        {review.is_edited && (
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            (edited)
          </Text>
        )}
      </View>
      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
        {formatDate(review.created_at)}
      </Text>
      {review.title && (
        <Text style={[theme.typography.label, { color: theme.colors.text, marginTop: 4 }]}>
          {review.title}
        </Text>
      )}
      {review.body && (
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginTop: 2 }]}>
          {review.body}
        </Text>
      )}
      <TouchableOpacity
        onPress={() => onMarkHelpful(review.id)}
        disabled={isHelpful || isOwnReview}
        style={[
          reviewStyles.helpfulButton,
          {
            backgroundColor: isHelpful ? '#EFF6FF' : theme.colors.surface,
            borderColor: isHelpful ? '#BFDBFE' : theme.colors.border,
            opacity: isOwnReview ? 0.5 : 1,
          },
        ]}
      >
        <Text style={{ fontSize: 12, color: isHelpful ? '#2563EB' : theme.colors.textSecondary }}>
          {'\u{1F44D}'} Helpful{review.helpful_count > 0 ? ` (${review.helpful_count})` : ''}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

export function MarketplaceDetailScreen() {
  const theme = useTheme()
  const { t } = useTranslation('marketplace')
  const navigation = useNavigation()
  const route = useRoute<Route>()
  const { listingId } = route.params

  const { listings, acquireDeck } = useMarketplaceStore()
  const listing = listings.find((l) => l.id === listingId)

  const {
    reviews,
    stats,
    userReview,
    userHelpfuls,
    loading: reviewsLoading,
    submitting,
    hasMore,
    sortBy,
    fetchReviews,
    fetchStats,
    fetchUserReview,
    submitReview,
    deleteReview,
    markHelpful,
    setSortBy,
    loadMore,
    reset: resetReviews,
  } = useReviewsStore()

  const [previewCards, setPreviewCards] = useState<Array<{ id: string; field_values: Record<string, string> }>>([])
  const [acquiring, setAcquiring] = useState(false)
  const [hasAcquired, setHasAcquired] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewBody, setReviewBody] = useState('')
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportCategory, setReportCategory] = useState<ReportCategory>('inappropriate')
  const [reportDescription, setReportDescription] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Fetch data
  useEffect(() => {
    if (!listing) return
    const supabase = getMobileSupabase()

    // Preview cards
    supabase
      .from('cards')
      .select('id, field_values')
      .eq('deck_id', listing.deck_id)
      .limit(10)
      .then(({ data }) => {
        if (data) setPreviewCards(data)
      })

    // Check acquisition + user
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setCurrentUserId(user.id)
      supabase
        .from('deck_shares')
        .select('id')
        .eq('deck_id', listing.deck_id)
        .eq('recipient_id', user.id)
        .eq('status', 'active')
        .limit(1)
        .then(({ data }) => {
          setHasAcquired((data ?? []).length > 0)
        })
    })

    // Fetch reviews
    resetReviews()
    fetchStats(listingId)
    fetchReviews(listingId)
    fetchUserReview(listingId)

    return () => resetReviews()
  }, [listing, listingId])

  // Track marketplace view (fire once per listing)
  const viewTrackedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!listingId || viewTrackedRef.current === listingId) return
    viewTrackedRef.current = listingId

    const supabase = getMobileSupabase()
    const sessionId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    supabase
      .rpc('record_marketplace_view', {
        p_listing_id: listingId,
        p_session_id: sessionId,
        p_referrer: 'mobile-app',
      } as Record<string, unknown>)
      .then(() => {}, () => {}) // fire and forget
  }, [listingId])

  // Pre-fill form when editing
  useEffect(() => {
    if (userReview) {
      setReviewRating(userReview.rating)
      setReviewTitle(userReview.title ?? '')
      setReviewBody(userReview.body ?? '')
    }
  }, [userReview])

  const handleAcquire = async () => {
    setAcquiring(true)
    try {
      await acquireDeck(listingId)
      setHasAcquired(true)
      Alert.alert('Success', 'Deck added to your collection!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ])
    } catch (e) {
      Alert.alert('Error', 'Failed to download deck')
    } finally {
      setAcquiring(false)
    }
  }

  const handleSubmitReview = async () => {
    if (reviewRating === 0) {
      Alert.alert('Error', 'Please select a rating')
      return
    }
    const success = await submitReview(
      listingId,
      reviewRating,
      reviewTitle.trim() || undefined,
      reviewBody.trim() || undefined,
    )
    if (success) {
      setShowReviewModal(false)
    }
  }

  const handleDeleteReview = () => {
    if (!userReview) return
    Alert.alert('Delete Review', 'Are you sure you want to delete your review?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteReview(userReview.id)
          setShowReviewModal(false)
          setReviewRating(0)
          setReviewTitle('')
          setReviewBody('')
        },
      },
    ])
  }

  const handleReport = async () => {
    setReportSubmitting(true)
    try {
      const supabase = getMobileSupabase()
      const { error } = await supabase.rpc('submit_report', {
        p_listing_id: listingId,
        p_category: reportCategory,
        p_description: reportDescription.trim() || null,
      })

      if (error) {
        if (error.message?.includes('duplicate') || error.code === '23505') {
          Alert.alert('Already Reported', 'You have already reported this listing.')
        } else {
          Alert.alert('Error', error.message || 'Failed to submit report')
        }
      } else {
        Alert.alert('Thank you', 'Your report has been submitted. We will review this content promptly.')
        setShowReportModal(false)
        setReportDescription('')
        setReportCategory('inappropriate')
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to submit report')
    } finally {
      setReportSubmitting(false)
    }
  }

  if (!listing) {
    return (
      <Screen testID="marketplace-detail-screen">
        <View style={styles.center}>
          <Text style={[theme.typography.h3, { color: theme.colors.textSecondary }]}>Not found</Text>
          <Button title="Go Back" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    )
  }

  const isOwner = currentUserId === listing.owner_id
  const canReview = !!currentUserId && !isOwner && hasAcquired

  const SORT_OPTIONS: { value: ReviewSortBy; label: string }[] = [
    { value: 'newest', label: 'Newest' },
    { value: 'highest', label: 'Highest' },
    { value: 'lowest', label: 'Lowest' },
    { value: 'most_helpful', label: 'Helpful' },
  ]

  // Combine preview cards and reviews into sections
  type SectionItem =
    | { type: 'header' }
    | { type: 'preview'; data: { id: string; field_values: Record<string, string> } }
    | { type: 'reviews_header' }
    | { type: 'rating_summary' }
    | { type: 'review_sort' }
    | { type: 'review'; data: MarketplaceReview }
    | { type: 'load_more' }

  const sections: SectionItem[] = [{ type: 'header' }]

  // Preview cards
  if (previewCards.length > 0) {
    previewCards.forEach((c) => sections.push({ type: 'preview', data: c }))
  }

  // Reviews
  sections.push({ type: 'reviews_header' })
  if (stats && stats.review_count > 0) {
    sections.push({ type: 'rating_summary' })
    sections.push({ type: 'review_sort' })
    reviews.forEach((r) => sections.push({ type: 'review', data: r }))
    if (hasMore) {
      sections.push({ type: 'load_more' })
    }
  }

  return (
    <Screen safeArea padding={false} testID="marketplace-detail-screen">
      <FlatList
        data={sections}
        keyExtractor={(item, index) => {
          if (item.type === 'preview') return `preview-${item.data.id}`
          if (item.type === 'review') return `review-${item.data.id}`
          return `${item.type}-${index}`
        }}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          switch (item.type) {
            case 'header':
              return (
                <View style={styles.header}>
                  <Button title={t('detail.back', { defaultValue: '\u2190 Back' })} variant="ghost" size="sm" fullWidth={false} onPress={() => navigation.goBack()} />
                  <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{listing.title}</Text>

                  {/* Publisher info + verified badge */}
                  {(listing as any).owner_display_name && (
                    <View style={styles.publisherRow}>
                      <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                        by {(listing as any).owner_display_name}
                      </Text>
                      {(listing as any).owner_is_official && (
                        <OfficialBadge
                          badgeType={(listing as any).badge_type || 'verified'}
                          badgeColor={(listing as any).badge_color}
                          size="md"
                        />
                      )}
                    </View>
                  )}

                  {listing.description && (
                    <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>{listing.description}</Text>
                  )}
                  <View style={styles.metaRow}>
                    <Badge label={`${listing.card_count ?? 0} cards`} variant="neutral" />
                    <Badge label={`${(listing as any).view_count ?? 0} views`} variant="neutral" />
                    <Badge label={`${listing.acquire_count ?? 0} users`} variant="primary" />
                    {(listing as any).category && <Badge label={(listing as any).category} variant="neutral" />}
                    {listing.share_mode && <Badge label={listing.share_mode} variant="success" />}
                  </View>
                  {(listing as any).review_count > 0 && (
                    <Text style={[theme.typography.bodySmall, { color: '#FBBF24' }]}>
                      {renderStars((listing as any).avg_rating ?? 0)} {((listing as any).avg_rating ?? 0).toFixed(1)} ({(listing as any).review_count} reviews)
                    </Text>
                  )}
                  {listing.tags && listing.tags.length > 0 && (
                    <View style={styles.tagRow}>
                      {listing.tags.map((tag: string) => (
                        <Text key={tag} style={[theme.typography.caption, styles.tag, { color: theme.colors.textSecondary, backgroundColor: theme.colors.surface }]}>#{tag}</Text>
                      ))}
                    </View>
                  )}
                  <Button testID="marketplace-acquire-button" title={acquiring ? t('detail.downloading') : t('detail.getDeck')} onPress={handleAcquire} loading={acquiring} />
                  <Button testID="marketplace-report-button" title={t('detail.reportContent', { defaultValue: 'Report' })} variant="ghost" size="sm" onPress={() => setShowReportModal(true)} />
                  {previewCards.length > 0 && (
                    <Text style={[theme.typography.h3, { color: theme.colors.text, marginTop: 16 }]}>Preview Cards</Text>
                  )}
                </View>
              )

            case 'preview': {
              const values = Object.values(item.data.field_values)
              return (
                <ListCard testID={`preview-card-${item.data.id}`}>
                  <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>{values[0] ?? ''}</Text>
                  {values[1] && (
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={1}>{values[1]}</Text>
                  )}
                </ListCard>
              )
            }

            case 'reviews_header':
              return (
                <View style={reviewStyles.sectionHeader}>
                  <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Ratings & Reviews</Text>
                  {canReview && (
                    <Button
                      title={userReview ? 'Edit Review' : 'Write Review'}
                      variant="secondary"
                      size="sm"
                      onPress={() => setShowReviewModal(true)}
                    />
                  )}
                  {!canReview && !isOwner && currentUserId && !hasAcquired && (
                    <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                      Acquire this deck to leave a review
                    </Text>
                  )}
                  {stats && stats.review_count === 0 && (
                    <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                      No reviews yet
                    </Text>
                  )}
                </View>
              )

            case 'rating_summary':
              if (!stats) return null
              return (
                <View style={[reviewStyles.summaryCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <View style={reviewStyles.summaryLeft}>
                    <Text style={[{ fontSize: 36, fontWeight: '700', color: theme.colors.text }]}>
                      {stats.avg_rating.toFixed(1)}
                    </Text>
                    <Text style={{ color: '#FBBF24', fontSize: 18 }}>{renderStars(stats.avg_rating)}</Text>
                    <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                      {stats.review_count} review{stats.review_count !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={reviewStyles.summaryRight}>
                    {[5, 4, 3, 2, 1].map((star) => {
                      const count = stats[`rating_${star}` as keyof typeof stats] as number
                      const pct = stats.review_count > 0 ? (count / stats.review_count) * 100 : 0
                      return (
                        <View key={star} style={reviewStyles.barRow}>
                          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, width: 16, textAlign: 'right' }]}>{star}</Text>
                          <View style={[reviewStyles.barTrack, { backgroundColor: theme.colors.border }]}>
                            <View style={[reviewStyles.barFill, { width: `${pct}%` }]} />
                          </View>
                        </View>
                      )
                    })}
                  </View>
                </View>
              )

            case 'review_sort':
              return (
                <View style={reviewStyles.sortRow}>
                  {SORT_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => {
                        setSortBy(opt.value)
                        fetchReviews(listingId)
                      }}
                      style={[
                        reviewStyles.sortChip,
                        {
                          backgroundColor: sortBy === opt.value ? theme.colors.primary : theme.colors.surface,
                          borderColor: sortBy === opt.value ? theme.colors.primary : theme.colors.border,
                        },
                      ]}
                    >
                      <Text style={{ fontSize: 12, color: sortBy === opt.value ? '#FFF' : theme.colors.text }}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )

            case 'review':
              return (
                <ReviewItem
                  review={item.data}
                  isHelpful={userHelpfuls.has(item.data.id)}
                  isOwnReview={item.data.user_id === currentUserId}
                  onMarkHelpful={markHelpful}
                  theme={theme}
                />
              )

            case 'load_more':
              return (
                <Button
                  title={reviewsLoading ? 'Loading...' : 'Load more reviews'}
                  variant="ghost"
                  size="sm"
                  onPress={() => loadMore(listingId)}
                  loading={reviewsLoading}
                />
              )

            default:
              return null
          }
        }}
      />

      {/* Report Modal */}
      <Modal
        visible={showReportModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowReportModal(false)}
      >
        <View style={[reportStyles.modalContainer, { backgroundColor: theme.colors.background }]}>
          <View style={reportStyles.modalHeader}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>Report Content</Text>
            <TouchableOpacity onPress={() => setShowReportModal(false)}>
              <Text style={[theme.typography.body, { color: theme.colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <View style={reportStyles.modalBody}>
            <Text style={[theme.typography.label, { color: theme.colors.text, marginBottom: 8 }]}>Reason</Text>
            {REPORT_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                onPress={() => setReportCategory(cat.value)}
                style={[
                  reportStyles.categoryOption,
                  {
                    borderColor: reportCategory === cat.value ? theme.colors.primary : theme.colors.border,
                    backgroundColor: reportCategory === cat.value ? theme.colors.primaryLight : 'transparent',
                  },
                ]}
                testID={`report-cat-${cat.value}`}
              >
                <View style={[
                  reportStyles.radio,
                  { borderColor: reportCategory === cat.value ? theme.colors.primary : theme.colors.textTertiary },
                ]}>
                  {reportCategory === cat.value && (
                    <View style={[reportStyles.radioInner, { backgroundColor: theme.colors.primary }]} />
                  )}
                </View>
                <Text style={[theme.typography.body, { color: theme.colors.text }]}>{cat.label}</Text>
              </TouchableOpacity>
            ))}

            <Text style={[theme.typography.label, { color: theme.colors.text, marginTop: 16, marginBottom: 8 }]}>Details (optional)</Text>
            <TextInput
              value={reportDescription}
              onChangeText={setReportDescription}
              placeholder="Describe the issue..."
              placeholderTextColor={theme.colors.textTertiary}
              multiline
              numberOfLines={3}
              style={[
                reportStyles.textInput,
                { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
              ]}
              testID="report-description-input"
            />

            <View style={{ marginTop: 20 }}>
              <Button
                title={reportSubmitting ? 'Submitting...' : 'Submit Report'}
                onPress={handleReport}
                loading={reportSubmitting}
                testID="report-submit-button"
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Write/Edit Review Modal */}
      <Modal
        visible={showReviewModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowReviewModal(false)}
      >
        <View style={[reviewStyles.modalContainer, { backgroundColor: theme.colors.background }]}>
          <View style={reviewStyles.modalHeader}>
            <Text style={[theme.typography.h3, { color: theme.colors.text }]}>
              {userReview ? 'Edit Review' : 'Write a Review'}
            </Text>
            <TouchableOpacity onPress={() => setShowReviewModal(false)}>
              <Text style={[theme.typography.body, { color: theme.colors.primary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={reviewStyles.modalBody}>
            <Text style={[theme.typography.label, { color: theme.colors.text, marginBottom: 8 }]}>Your Rating</Text>
            <StarSelector rating={reviewRating} onChange={setReviewRating} />

            <Text style={[theme.typography.label, { color: theme.colors.text, marginTop: 20, marginBottom: 8 }]}>Title (optional)</Text>
            <TextInput
              value={reviewTitle}
              onChangeText={setReviewTitle}
              placeholder="Summarize your experience"
              placeholderTextColor={theme.colors.textSecondary}
              maxLength={100}
              style={[reviewStyles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
            />

            <Text style={[theme.typography.label, { color: theme.colors.text, marginTop: 16, marginBottom: 8 }]}>Review (optional)</Text>
            <TextInput
              value={reviewBody}
              onChangeText={setReviewBody}
              placeholder="What did you like or dislike?"
              placeholderTextColor={theme.colors.textSecondary}
              maxLength={2000}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              style={[reviewStyles.input, reviewStyles.textArea, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}
            />

            <View style={{ marginTop: 24, gap: 12 }}>
              <Button
                title={submitting ? 'Submitting...' : userReview ? 'Update Review' : 'Submit Review'}
                onPress={handleSubmitReview}
                loading={submitting}
              />
              {userReview && (
                <Button
                  title="Delete Review"
                  variant="ghost"
                  onPress={handleDeleteReview}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 24, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { gap: 12, paddingTop: 8, paddingBottom: 8 },
  publisherRow: { flexDirection: 'row', alignItems: 'center', gap: 8 } as const,
  metaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
})

const reportStyles = StyleSheet.create({
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  modalBody: { padding: 20 },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: 14,
  },
})

const reviewStyles = StyleSheet.create({
  sectionHeader: { gap: 8, marginTop: 24, marginBottom: 8 },
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 16, flexDirection: 'row', gap: 16 },
  summaryLeft: { alignItems: 'center', justifyContent: 'center' },
  summaryRight: { flex: 1, gap: 4, justifyContent: 'center' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#FBBF24', borderRadius: 3 },
  sortRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  sortChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  card: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  helpfulButton: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, borderWidth: 1, alignSelf: 'flex-start' },
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  modalBody: { padding: 20 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  textArea: { minHeight: 100 },
})
