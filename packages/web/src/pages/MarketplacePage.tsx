import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMarketplaceStore } from '../stores/marketplace-store'
import { useOfficialStore } from '@reeeeecall/shared/stores/official-store'
import { ListingCard } from '../components/marketplace/ListingCard'
import { SearchFilters } from '../components/marketplace/SearchFilters'
import { GuideHelpLink } from '../components/common/GuideHelpLink'
import { OfficialBadge } from '../components/common/OfficialBadge'
import { extractPopularTags, getTrendingListingIds, countActiveFilters } from '../lib/marketplace'
import type { MarketplaceListing } from '../types/database'
import type { MarketplaceListingData } from '../lib/marketplace'

const PAGE_SIZE = 12

export function MarketplacePage() {
  const { t } = useTranslation(['marketplace', 'common'])
  const navigate = useNavigate()
  const { listings, loading, filters, fetchListings, setFilters, resetFilters, getFilteredListings } = useMarketplaceStore()
  const { officialListings, fetchOfficialListings } = useOfficialStore()
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    fetchListings()
    fetchOfficialListings()
  }, [fetchListings, fetchOfficialListings])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [filters])

  const filteredListings = getFilteredListings()
  const popularTags = useMemo(() => extractPopularTags(listings as MarketplaceListingData[]), [listings])
  const trendingIds = useMemo(() => getTrendingListingIds(listings as MarketplaceListingData[]), [listings])

  const totalPages = Math.max(1, Math.ceil(filteredListings.length / PAGE_SIZE))
  const safePage = Math.max(1, Math.min(currentPage, totalPages))
  const startIdx = (safePage - 1) * PAGE_SIZE
  const pageListings = filteredListings.slice(startIdx, startIdx + PAGE_SIZE)

  const handleListingClick = (listing: MarketplaceListing) => {
    navigate(`/marketplace/${listing.id}`)
  }

  const hasActiveFilters = !!(filters.query || filters.category || countActiveFilters(filters) > 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t('marketplace:title')}</h1>
        <GuideHelpLink section="marketplace" />
      </div>

      <div className="mb-4">
        <SearchFilters
          filters={filters}
          popularTags={popularTags}
          onFilterChange={setFilters}
          onReset={resetFilters}
        />
      </div>

      {/* Official Decks Featured Section */}
      {officialListings.length > 0 && (
        <div className="mb-6" data-testid="official-decks-section">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            {'\u2B50'} {t('marketplace:officialDecks', { defaultValue: 'Official Decks' })}
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {officialListings.map((listing) => (
              <div
                key={listing.id}
                onClick={() => handleListingClick(listing as MarketplaceListing)}
                className="min-w-[220px] max-w-[260px] bg-card rounded-xl border border-border p-3 hover:border-brand/30 hover:shadow-md transition cursor-pointer shrink-0"
                data-testid={`official-listing-${listing.id}`}
              >
                <h3 className="text-sm font-semibold text-foreground line-clamp-1 mb-1">
                  {listing.title}
                </h3>
                {listing.owner_display_name && (
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-xs text-muted-foreground truncate">{listing.owner_display_name}</span>
                    <OfficialBadge
                      badgeType={(listing as any).badge_type || 'verified'}
                      badgeColor={(listing as any).badge_color}
                      size="sm"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-content-tertiary">
                  <span>{listing.card_count} cards</span>
                  <span>{listing.acquire_count} users</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="text-4xl animate-pulse">{'\uD83C\uDFEA'}</div>
        </div>
      ) : filteredListings.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 sm:p-12 text-center">
          <div className="text-4xl sm:text-5xl mb-4">{'\uD83C\uDFEA'}</div>
          <p className="text-muted-foreground text-sm sm:text-base">
            {hasActiveFilters
              ? t('marketplace:noResults')
              : t('marketplace:noListings')}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {pageListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onClick={handleListingClick}
                isTrending={trendingIds.has(listing.id)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 sm:px-4 py-3 mt-4 sm:mt-6 bg-card rounded-xl border border-border">
              <span className="text-xs sm:text-sm text-muted-foreground">
                {t('common:pagination.rangeOf', { start: startIdx + 1, end: Math.min(startIdx + PAGE_SIZE, filteredListings.length), total: filteredListings.length })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                  disabled={safePage <= 1}
                  className="p-2.5 rounded hover:bg-accent disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let page: number
                  if (totalPages <= 5) {
                    page = i + 1
                  } else if (safePage <= 3) {
                    page = i + 1
                  } else if (safePage >= totalPages - 2) {
                    page = totalPages - 4 + i
                  } else {
                    page = safePage - 2 + i
                  }
                  return (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`w-10 h-10 text-sm rounded cursor-pointer ${
                        safePage === page
                          ? 'bg-brand text-white'
                          : 'hover:bg-accent text-foreground'
                      }`}
                    >
                      {page}
                    </button>
                  )
                })}
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                  disabled={safePage >= totalPages}
                  className="p-2.5 rounded hover:bg-accent disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
