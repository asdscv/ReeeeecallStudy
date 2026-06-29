import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useMarketplaceStore } from '../stores/marketplace-store'
import { useAuthStore } from '../stores/auth-store'
import { useSharingStore } from '../stores/sharing-store'
import { confirm } from '../stores/confirm-store'
import { ReportModal } from '../components/marketplace/ReportModal'
import { ReviewsSection } from '../components/marketplace/ReviewsSection'
import { StarRatingInline } from '../components/marketplace/StarRating'
import { getAnalyticsSessionId } from '../lib/analytics-session'
import { VerifiedBadge } from '../components/marketplace/ListingCard'
import type {
  MarketplaceListing,
  Card,
  CardTemplate,
  PublicListingPreview,
} from '../types/database'

export function MarketplaceDetailPage() {
  const { t } = useTranslation(['marketplace', 'common'])
  const { listingId } = useParams<{ listingId: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { acquireDeck, error } = useMarketplaceStore()

  const [listing, setListing] = useState<MarketplaceListing | null>(null)
  const [previewCards, setPreviewCards] = useState<Card[]>([])
  const [previewSampleFields, setPreviewSampleFields] = useState<
    PublicListingPreview['sample_fields']
  >([])
  const [template, setTemplate] = useState<CardTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [acquiring, setAcquiring] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [hasAcquired, setHasAcquired] = useState(false)
  const [shareId, setShareId] = useState<string | null>(null)
  const [unsubscribing, setUnsubscribing] = useState(false)
  const [unsubscribeError, setUnsubscribeError] = useState<string | null>(null)

  useEffect(() => {
    if (!listingId) return

    const fetchData = async () => {
      setLoading(true)

      // Try fetching with owner profile join
      let typedListing: MarketplaceListing | null = null
      const { data: listingData } = await supabase
        .from('marketplace_listings')
        .select('*, profiles!marketplace_listings_owner_id_fkey(display_name, is_official)')
        .eq('id', listingId)
        .single()

      if (listingData) {
        const profile = (listingData as Record<string, unknown>).profiles as
          | { display_name: string | null; is_official: boolean }
          | null
        typedListing = {
          ...listingData,
          profiles: undefined,
          owner_display_name: profile?.display_name ?? null,
          owner_is_official: profile?.is_official ?? false,
        } as MarketplaceListing
      } else {
        // Fallback without join
        const { data: fallbackData } = await supabase
          .from('marketplace_listings')
          .select('*')
          .eq('id', listingId)
          .single()
        typedListing = fallbackData as MarketplaceListing | null
      }

      if (!typedListing) {
        navigate('/marketplace', { replace: true })
        return
      }

      setListing(typedListing)

      // Card preview — try public RPC first (works for everyone via SECURITY
      // DEFINER), then fall back to direct `cards` query (only succeeds for the
      // owner or an already-subscribed user, per RLS).
      const { data: previewRpc } = await supabase.rpc(
        'get_public_listing_preview',
        { p_listing_id: listingId },
      )
      const previewTyped = previewRpc as unknown as PublicListingPreview | null
      const previewFields = previewTyped?.sample_fields ?? []
      setPreviewSampleFields(previewFields)

      if (previewFields.length === 0) {
        const { data: cards } = await supabase
          .from('cards')
          .select('*')
          .eq('deck_id', typedListing.deck_id)
          .order('sort_position', { ascending: true })
          .limit(10)
        setPreviewCards((cards ?? []) as Card[])
      } else {
        setPreviewCards([])
      }

      // Fetch template
      const { data: deck } = await supabase
        .from('decks')
        .select('default_template_id')
        .eq('id', typedListing.deck_id)
        .single()

      if (deck && (deck as { default_template_id: string | null }).default_template_id) {
        const { data: tmpl } = await supabase
          .from('card_templates')
          .select('*')
          .eq('id', (deck as { default_template_id: string }).default_template_id)
          .single()
        setTemplate(tmpl as CardTemplate | null)
      }

      // Check if user has an active subscribe-mode share for this deck and
      // capture its id so we can offer "Unsubscribe".
      if (user) {
        const { data: shareData } = await supabase
          .from('deck_shares')
          .select('id')
          .eq('deck_id', typedListing.deck_id)
          .eq('recipient_id', user.id)
          .eq('status', 'active')
          .limit(1)
        const firstShare = (shareData ?? [])[0] as { id: string } | undefined
        setHasAcquired(!!firstShare)
        setShareId(firstShare?.id ?? null)
      } else {
        setHasAcquired(false)
        setShareId(null)
      }

      setLoading(false)
    }

    fetchData()
  }, [listingId, navigate, user])

  // Track marketplace view (fire once per listing visit)
  const viewTrackedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!listingId || viewTrackedRef.current === listingId) return
    viewTrackedRef.current = listingId

    const sessionId = getAnalyticsSessionId()
    supabase
      .rpc('record_marketplace_view', {
        p_listing_id: listingId,
        p_session_id: sessionId,
        p_referrer: document.referrer || null,
      } as Record<string, unknown>)
      .then(() => {}, () => {}) // fire and forget
  }, [listingId])

  const handleAcquire = async () => {
    if (!listingId || hasAcquired || acquiring) return
    setAcquiring(true)
    try {
      const result = await acquireDeck(listingId)
      if (!result) return
      setHasAcquired(true)
      if (result.wasNew) {
        const { useDeckStore } = await import('../stores/deck-store')
        await useDeckStore.getState().fetchDecks({ force: true })
      }
      navigate(`/decks/${result.deckId}`)
    } finally {
      setAcquiring(false)
    }
  }

  const handleUnsubscribe = async () => {
    if (!shareId || unsubscribing) return
    const confirmMsg = t('marketplace:detail.unsubscribeConfirm', {
      defaultValue:
        'Unsubscribe from this deck? Your personal study progress for it will remain in your account.',
    })
    if (!(await confirm({ title: t('marketplace:detail.unsubscribe', { defaultValue: 'Unsubscribe' }), message: confirmMsg, danger: true }))) return
    setUnsubscribing(true)
    setUnsubscribeError(null)
    try {
      await useSharingStore.getState().unsubscribe(shareId)
      const storeError = useSharingStore.getState().error
      if (storeError) {
        setUnsubscribeError(storeError)
        return
      }
      setHasAcquired(false)
      setShareId(null)
      // Drop the now-unshared deck from the user's local deck cache so it
      // disappears from /decks immediately.
      const { useDeckStore } = await import('../stores/deck-store')
      await useDeckStore.getState().fetchDecks({ force: true })
    } finally {
      setUnsubscribing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-4xl animate-pulse">🏪</div>
      </div>
    )
  }

  if (!listing) return null

  const isOwner = user?.id === listing.owner_id
  const displayFields = template?.fields ?? []

  return (
    <div>
      <button
        onClick={() => navigate('/marketplace')}
        className="text-sm text-muted-foreground hover:text-foreground mb-4 cursor-pointer"
      >
        {t('marketplace:detail.back')}
      </button>

      <div className="bg-card rounded-xl border border-border p-4 sm:p-6 mb-4">
        <div className="flex items-start justify-between mb-3">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{listing.title}</h1>
          <span className="px-3 py-1 text-sm bg-brand/10 text-brand rounded-full shrink-0 ml-3">
            {t(`marketplace:shareModes.${listing.share_mode}`, listing.share_mode)}
          </span>
        </div>

        {/* Publisher info with verified badge */}
        {listing.owner_display_name && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-sm text-muted-foreground">
              {t('marketplace:detail.publishedBy', { defaultValue: 'by' })} {listing.owner_display_name}
            </span>
            {listing.owner_is_official && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand/10 text-brand rounded-full text-xs font-medium">
                <VerifiedBadge className="w-3.5 h-3.5" />
                {t('marketplace:verifiedPublisher', { defaultValue: 'Verified Publisher' })}
              </span>
            )}
          </div>
        )}

        {listing.description && (
          <p className="text-sm sm:text-base text-muted-foreground mb-4">{listing.description}</p>
        )}

        {listing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {listing.tags.map((tag) => (
              <span key={tag} className="px-2.5 py-1 text-xs bg-accent text-muted-foreground rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap text-sm text-muted-foreground mb-4">
          <span>{t('marketplace:detail.cardCount', { count: listing.card_count })}</span>
          <span className="inline-flex items-center gap-1">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            {listing.view_count ?? 0}
          </span>
          <span>{t('marketplace:detail.userCount', { count: listing.acquire_count })}</span>
          <span>{t('marketplace:categories.' + listing.category, listing.category)}</span>
          {(listing.review_count ?? 0) > 0 && (
            <StarRatingInline rating={listing.avg_rating ?? 0} count={listing.review_count ?? 0} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-1">
        {!isOwner && (
          <button
            onClick={handleAcquire}
            disabled={acquiring || hasAcquired}
            className="px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-hover transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {hasAcquired
              ? t('marketplace:detail.alreadyAcquired', { defaultValue: 'Already in your collection' })
              : acquiring
                ? t('marketplace:detail.importing')
                : t('marketplace:detail.getDeck')}
          </button>
        )}

        {!isOwner && hasAcquired && shareId && (
          <button
            onClick={handleUnsubscribe}
            disabled={unsubscribing}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-destructive transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {unsubscribing
              ? t('marketplace:detail.unsubscribing', { defaultValue: 'Unsubscribing...' })
              : t('marketplace:detail.unsubscribe', { defaultValue: 'Unsubscribe' })}
          </button>
        )}

        {!isOwner && (
          <button
            onClick={() => setShowReportModal(true)}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-destructive transition cursor-pointer"
          >
            {t('marketplace:detail.reportContent', { defaultValue: 'Report' })}
          </button>
        )}
        </div>

        {error && <p className="text-sm text-destructive mt-2">{t(error)}</p>}
        {unsubscribeError && (
          <p className="text-sm text-destructive mt-2">
            {t('marketplace:detail.unsubscribeError', { defaultValue: 'Failed to unsubscribe. Please try again.' })}
            {' '}
            <span className="opacity-75">({unsubscribeError})</span>
          </p>
        )}
      </div>

      {/* Card preview */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">{t('marketplace:detail.cardPreview')}</h2>
        </div>

        {previewSampleFields.length === 0 && previewCards.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">{t('marketplace:detail.noCards')}</div>
        ) : (
          <div className="divide-y divide-border">
            {/* RPC-sourced samples (public, works for non-subscribers too) */}
            {previewSampleFields.map((sample, i) => {
              const fv = sample.field_values
              const front = typeof fv.front === 'string' ? fv.front : ''
              const back = typeof fv.back === 'string' ? fv.back : ''
              const exampleFront =
                typeof fv.example_front === 'string' ? fv.example_front : ''
              const exampleBack =
                typeof fv.example_back === 'string' ? fv.example_back : ''
              const alt = typeof fv.alt === 'string' ? fv.alt : ''
              const situation = typeof fv.situation === 'string' ? fv.situation : ''
              const note = typeof fv.note === 'string' ? fv.note : ''
              return (
                <div key={`s-${i}`} className="px-4 py-3 space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-content-tertiary">#{i + 1}</span>
                    <span className="text-base font-medium text-foreground">{front || '-'}</span>
                    <span className="text-sm text-muted-foreground">— {back || '-'}</span>
                  </div>
                  {(exampleFront || exampleBack) && (
                    <div className="text-xs text-muted-foreground pl-6 space-y-0.5">
                      {exampleFront && <div>{exampleFront}</div>}
                      {exampleBack && <div className="text-content-tertiary">{exampleBack}</div>}
                    </div>
                  )}
                  {(alt || situation || note) && (
                    <div className="text-xs text-muted-foreground pl-6 space-y-0.5">
                      {alt && <div>{alt}</div>}
                      {situation && <div className="text-content-tertiary">{situation}</div>}
                      {note && <div className="text-content-tertiary italic">{note}</div>}
                    </div>
                  )}
                </div>
              )
            })}
            {/* Owner/subscriber fallback rendering — template-driven (preserves
                pre-existing behaviour for users who already have access). */}
            {previewSampleFields.length === 0 &&
              previewCards.map((card, i) => (
                <div key={card.id} className="px-4 py-3">
                  <span className="text-xs text-content-tertiary mr-2">#{i + 1}</span>
                  {displayFields.slice(0, 3).map((field) => (
                    <span key={field.key} className="text-sm text-foreground mr-4">
                      <span className="text-xs text-content-tertiary">{field.name}: </span>
                      {card.field_values[field.key] || '-'}
                    </span>
                  ))}
                  {displayFields.length === 0 && (
                    <span className="text-sm text-foreground">
                      {Object.values(card.field_values).slice(0, 2).join(' / ') || '-'}
                    </span>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Reviews Section */}
      {listingId && (
        <div className="mt-4">
          <ReviewsSection
            listingId={listingId}
            isOwner={isOwner}
            hasAcquired={hasAcquired}
          />
        </div>
      )}

      {/* Report Modal */}
      {listingId && (
        <ReportModal
          open={showReportModal}
          onClose={() => setShowReportModal(false)}
          listingId={listingId}
        />
      )}
    </div>
  )
}
