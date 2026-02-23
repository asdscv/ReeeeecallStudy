import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/auth-store'
import { ContentNav } from '../components/content/ContentNav'
import { SEOHead } from '../components/content/SEOHead'
import { FooterSection } from '../components/landing/FooterSection'
import { OfficialBadge } from '../components/common/OfficialBadge'
import { buildListingDatasetJsonLd, buildListingBreadcrumbJsonLd, buildListingHreflangAlternates } from '../lib/marketplace-seo'
import { SEO } from '../lib/seo-config'
import type { PublicListingPreview } from '../types/database'

export function PublicListingPage() {
  const { listingId } = useParams<{ listingId: string }>()
  const { t } = useTranslation(['marketplace', 'common'])
  const { user } = useAuthStore()
  const [listing, setListing] = useState<PublicListingPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!listingId) return

    let cancelled = false

    const fetchPreview = async () => {
      setLoading(true)
      setError(false)

      const { data, error: rpcError } = await supabase.rpc('get_public_listing_preview', {
        p_listing_id: listingId,
      })

      if (cancelled) return

      if (rpcError || !data) {
        setError(true)
        setLoading(false)
        return
      }

      setListing(data as unknown as PublicListingPreview)
      setLoading(false)
    }

    fetchPreview()
    return () => { cancelled = true }
  }, [listingId])

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <ContentNav backTo="/landing" backLabel={t('marketplace:preview.backToHome')} />
        <div className="max-w-3xl mx-auto px-4 py-20">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-2/3" />
            <div className="h-4 bg-gray-200 rounded w-full" />
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="flex gap-2 mt-6">
              <div className="h-6 w-16 bg-gray-200 rounded-full" />
              <div className="h-6 w-16 bg-gray-200 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen bg-white">
        <SEOHead
          title={t('marketplace:preview.notFound')}
          description=""
          noIndex
        />
        <ContentNav backTo="/landing" backLabel={t('marketplace:preview.backToHome')} />
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <p className="text-6xl mb-4">404</p>
          <p className="text-gray-500 text-lg mb-2">{t('marketplace:preview.notFound')}</p>
          <p className="text-gray-400 text-sm">{t('marketplace:preview.notFoundDescription')}</p>
        </div>
        <FooterSection />
      </div>
    )
  }

  const seoTitle = t('marketplace:preview.title', { title: listing.title })
  const seoDescription = t('marketplace:preview.description', {
    title: listing.title,
    cardCount: listing.card_count,
  })

  return (
    <div className="min-h-screen bg-white">
      <SEOHead
        title={seoTitle}
        description={seoDescription}
        ogType="website"
        canonicalUrl={`${SEO.SITE_URL}/d/${listing.id}`}
        jsonLd={[
          buildListingDatasetJsonLd(listing),
          buildListingBreadcrumbJsonLd(listing),
        ]}
        hreflangAlternates={buildListingHreflangAlternates(listing.id)}
        keywords={listing.tags}
      />
      <ContentNav backTo="/landing" backLabel={t('marketplace:preview.backToHome')} />

      <main className="max-w-3xl mx-auto px-4 py-10 sm:py-16">
        {/* Listing info */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3" data-testid="listing-title">
            {listing.title}
          </h1>

          {listing.description && (
            <p className="text-gray-600 text-base sm:text-lg mb-4" data-testid="listing-description">
              {listing.description}
            </p>
          )}

          {/* Tags */}
          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {listing.tags.map((tag) => (
                <span key={tag} className="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
            <span>{t('marketplace:preview.cardCount', { count: listing.card_count })}</span>
            <span>{t('marketplace:preview.userCount', { count: listing.acquire_count })}</span>
            <span>{t(`marketplace:categories.${listing.category}`, listing.category)}</span>
          </div>

          {/* Owner */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>{t('marketplace:preview.by', { name: listing.owner_name || 'Unknown' })}</span>
            {listing.owner_is_official && <OfficialBadge />}
          </div>
        </div>

        {/* Sample cards */}
        {listing.sample_fields.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-medium text-gray-700">{t('marketplace:preview.sampleCards')}</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {listing.sample_fields.map((sample, i) => {
                const values = Object.values(sample.field_values).map((v) =>
                  typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v,
                )
                return (
                  <div key={i} className="px-4 py-3 relative">
                    <span className="text-xs text-gray-400 mr-2">#{i + 1}</span>
                    <span className="text-sm text-gray-700">
                      {values[0] || '-'}
                    </span>
                    {values.length > 1 && (
                      <span className="text-sm text-gray-400 ml-3 blur-sm select-none" aria-hidden="true">
                        {values.slice(1).join(' / ')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="px-4 py-3 bg-gray-50 text-center">
              <p className="text-xs text-gray-400">{t('marketplace:preview.blurredNotice')}</p>
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200/50 p-6 sm:p-8 text-center" data-testid="cta-section">
          {user ? (
            <>
              <p className="text-gray-600 mb-4">{t('marketplace:preview.viewInMarket')}</p>
              <Link
                to={`/marketplace/${listing.id}`}
                className="inline-block px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition no-underline"
                data-testid="cta-marketplace"
              >
                {t('marketplace:detail.getDeck')}
              </Link>
            </>
          ) : (
            <>
              <p className="text-gray-600 mb-4">{t('marketplace:preview.blurredNotice')}</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  to={`/auth/login?redirect=${encodeURIComponent(`/marketplace/${listing.id}`)}`}
                  className="inline-block px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition no-underline"
                  data-testid="cta-login"
                >
                  {t('marketplace:preview.ctaLogin')}
                </Link>
                <Link
                  to={`/auth/login?redirect=${encodeURIComponent(`/marketplace/${listing.id}`)}`}
                  className="inline-block px-6 py-3 border border-blue-300 text-blue-600 text-sm font-semibold rounded-lg hover:bg-blue-50 transition no-underline"
                  data-testid="cta-signup"
                >
                  {t('marketplace:preview.ctaSignup')}
                </Link>
              </div>
            </>
          )}
        </div>
      </main>

      <FooterSection />
    </div>
  )
}
